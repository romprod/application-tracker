import { describe, expect, it } from "vitest";

import {
  ApplicationActivityCorrectionError,
  ApplicationActivityEvidenceError,
  ApplicationActivityIdempotencyConflictError,
  ApplicationConflictError,
  ApplicationFieldProvenanceIdempotencyConflictError,
  ApplicationFieldProvenanceSourceError,
  InvalidOutlookGraphConnectionAssignmentError,
} from "../../application/applications.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteApplicationsRepository } from "./applications_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

const createdAt = "2026-07-18T12:00:00.000Z";

function createRepository() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: createdAt,
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  return {
    database,
    repository: new SqliteApplicationsRepository(database),
    setup,
  };
}

function referenceId(
  database: ReturnType<typeof openApplicationDatabase>,
  workspaceId: string,
  category: "role_type" | "source" | "status",
  label: string,
): string {
  const id = database
    .prepare(
      `SELECT id FROM reference_values
       WHERE workspace_id = ? AND category = ? AND label = ?`,
    )
    .pluck()
    .get(workspaceId, category, label);
  if (typeof id !== "string") throw new Error("Missing test reference value");
  return id;
}

function insertGraphConnection(
  database: ReturnType<typeof openApplicationDatabase>,
  workspaceId: string,
  userId: string,
  id: string,
  name: string,
): void {
  database
    .prepare(
      `INSERT INTO outlook_graph_connections
         (id, workspace_id, name, tenant_id, client_id,
          client_secret_encrypted, mailbox, folder_path, enabled, verified_at,
          last_tested_at, last_error_code, created_at, updated_at,
          updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      name,
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "v2.encrypted-client-secret-material",
      `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
      "Inbox\\Jobs",
      createdAt,
      createdAt,
      createdAt,
      createdAt,
      userId,
    );
}

describe("SqliteApplicationsRepository", () => {
  it("creates and lists application fields without internal scope data", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        agency: "Example Recruitment",
        appliedOn: "2026-07-18",
        companyName: "Example Studio",
        contacts: [
          {
            email: "morgan@example.com",
            name: "Morgan Recruiter",
            phone: "+44 20 7946 0958",
            role: "Recruiter",
          },
        ],
        createdAt,
        createdByUserId: setup.administrator.id,
        location: "Remote",
        nextAction: "Send the portfolio follow-up.",
        nextActionDue: "2026-07-21",
        notes: "Referred by a former colleague.",
        rating: 4,
        links: [
          {
            label: "Hiring portal",
            url: "https://careers.example.com/application",
          },
        ],
        roleTypeId: referenceId(
          database,
          setup.workspace.id,
          "role_type",
          "Full-time",
        ),
        roleTitle: "Product Designer",
        salary: "£70,000–£80,000",
        sourceId: referenceId(
          database,
          setup.workspace.id,
          "source",
          "Referral",
        ),
        sourceUrl: "https://jobs.example.com/product-designer",
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Applied",
        ),
        workspaceId: setup.workspace.id,
        workArrangement: "hybrid",
      });

      expect(created).toMatchObject({
        agency: "Example Recruitment",
        appliedOn: "2026-07-18",
        companyName: "Example Studio",
        contacts: [
          {
            email: "morgan@example.com",
            name: "Morgan Recruiter",
            phone: "+44 20 7946 0958",
            role: "Recruiter",
          },
        ],
        links: [
          {
            label: "Hiring portal",
            url: "https://careers.example.com/application",
          },
        ],
        location: "Remote",
        nextAction: "Send the portfolio follow-up.",
        nextActionDue: "2026-07-21",
        rating: 4,
        roleType: "Full-time",
        salary: "£70,000–£80,000",
        source: "Referral",
        status: "Applied",
        workArrangement: "hybrid",
      });
      expect(created).not.toHaveProperty("workspaceId");
      expect(created).not.toHaveProperty("createdByUserId");
      expect(repository.listApplications(setup.workspace.id)).toEqual([
        created,
      ]);
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toEqual([
        expect.objectContaining({
          actorDisplayName: "Alex Example",
          fromStatus: null,
          occurredAt: createdAt,
          toStatus: "Applied",
          type: "application_created",
        }),
      ]);
    } finally {
      database.close();
    }
  });

  it("assigns, changes, clears, and validates a Graph origin transactionally", () => {
    const { database, repository, setup } = createRepository();
    const firstConnectionId = "11111111-1111-4111-8111-111111111111";
    const secondConnectionId = "22222222-2222-4222-8222-222222222222";
    try {
      insertGraphConnection(
        database,
        setup.workspace.id,
        setup.administrator.id,
        firstConnectionId,
        "Work tenant",
      );
      insertGraphConnection(
        database,
        setup.workspace.id,
        setup.administrator.id,
        secondConnectionId,
        "Consulting tenant",
      );
      const application = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        outlookGraphConnectionId: firstConnectionId,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });
      expect(application).toMatchObject({
        outlookGraphConnectionId: firstConnectionId,
        outlookGraphConnectionName: "Work tenant",
      });

      const changed = repository.updateApplication({
        actorUserId: setup.administrator.id,
        applicationId: application.id,
        expectedUpdatedAt: application.updatedAt,
        outlookGraphConnectionId: secondConnectionId,
        updatedAt: "2026-07-18T12:01:00.000Z",
        workspaceId: setup.workspace.id,
      });
      expect(changed).toMatchObject({
        outlookGraphConnectionId: secondConnectionId,
        outlookGraphConnectionName: "Consulting tenant",
      });

      const cleared = repository.updateApplication({
        actorUserId: setup.administrator.id,
        applicationId: application.id,
        expectedUpdatedAt: changed!.updatedAt,
        outlookGraphConnectionId: null,
        updatedAt: "2026-07-18T12:02:00.000Z",
        workspaceId: setup.workspace.id,
      });
      expect(cleared).toMatchObject({
        outlookGraphConnectionId: null,
        outlookGraphConnectionName: null,
      });

      expect(() =>
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: application.id,
          expectedUpdatedAt: cleared!.updatedAt,
          outlookGraphConnectionId: "33333333-3333-4333-8333-333333333333",
          updatedAt: "2026-07-18T12:03:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toThrow(InvalidOutlookGraphConnectionAssignmentError);
      expect(
        repository
          .listApplications(setup.workspace.id)
          .find(({ id }) => id === application.id),
      ).toMatchObject({
        outlookGraphConnectionId: null,
        outlookGraphConnectionName: null,
        updatedAt: "2026-07-18T12:02:00.000Z",
      });
    } finally {
      database.close();
    }
  });

  it("uses parameters for control text and keeps workspace records isolated", () => {
    const { database, repository, setup } = createRepository();
    const injection = "Example'); DROP TABLE applications; --";

    try {
      const first = repository.createApplication({
        appliedOn: null,
        companyName: injection,
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: injection,
        nextActionDue: null,
        notes: null,
        roleTitle: "Security Engineer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run("workspace-00002", "Other Workspace", "other", createdAt);

      expect(() =>
        repository.createApplication({
          appliedOn: null,
          companyName: "Cross-scope attempt",
          createdAt,
          createdByUserId: setup.administrator.id,
          location: null,
          nextAction: null,
          nextActionDue: null,
          notes: null,
          roleTitle: "Invalid record",
          sourceUrl: null,
          statusId: referenceId(
            database,
            setup.workspace.id,
            "status",
            "Prospect",
          ),
          workspaceId: "workspace-00002",
        }),
      ).toThrow();

      expect(repository.listApplications(setup.workspace.id)).toEqual([first]);
      expect(repository.listApplications("workspace-00002")).toEqual([]);
      expect(
        database.prepare("SELECT count(*) FROM applications").pluck().get(),
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("uses the active workspace and update index for the ledger query", () => {
    const { database, setup } = createRepository();

    try {
      const plan = database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id FROM applications
           WHERE workspace_id = ? AND deleted_at IS NULL
           ORDER BY updated_at DESC, id DESC`,
        )
        .all(setup.workspace.id) as { detail: string }[];
      expect(plan.map((row) => row.detail).join(" ")).toContain(
        "applications_active_by_workspace_updated",
      );
    } finally {
      database.close();
    }
  });

  it("hydrates more applications than SQLite permits in one parameter list", () => {
    const { database, repository, setup } = createRepository();
    const statusId = referenceId(
      database,
      setup.workspace.id,
      "status",
      "Prospect",
    );
    const insert = database.prepare(
      `INSERT INTO applications
         (id, workspace_id, company_name, role_title, legacy_status,
          status_reference_id, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'prospect', ?, ?, ?, ?)`,
    );
    const insertMany = database.transaction(() => {
      for (let index = 0; index < 32_766; index += 1) {
        insert.run(
          `bulk-${index.toString().padStart(5, "0")}`,
          setup.workspace.id,
          `Company ${index}`,
          "Role",
          statusId,
          setup.administrator.id,
          createdAt,
          createdAt,
        );
      }
    });

    try {
      insertMany.immediate();
      const applications = repository.listApplications(setup.workspace.id);
      expect(applications).toHaveLength(32_766);
      expect(
        applications.every(
          ({ contacts, links }) => contacts.length === 0 && links.length === 0,
        ),
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("enforces next-action storage constraints below the domain boundary", () => {
    const { database, repository, setup } = createRepository();
    const record = {
      appliedOn: null,
      companyName: "Example Studio",
      createdAt,
      createdByUserId: setup.administrator.id,
      location: null,
      notes: null,
      roleTitle: "Product Designer",
      sourceUrl: null,
      statusId: referenceId(database, setup.workspace.id, "status", "Prospect"),
      workspaceId: setup.workspace.id,
    };

    try {
      expect(() =>
        repository.createApplication({
          ...record,
          nextAction: "x".repeat(501),
          nextActionDue: null,
        }),
      ).toThrow();
      expect(() =>
        repository.createApplication({
          ...record,
          nextAction: "Follow up",
          nextActionDue: "21/07/2026",
        }),
      ).toThrow();
      expect(
        database.prepare("SELECT count(*) FROM applications").pluck().get(),
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("updates fields and records only real status transitions", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: "Remote",
        nextAction: "Prepare portfolio examples.",
        nextActionDue: "2026-07-21",
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });
      const transitioned = repository.updateApplication({
        actorUserId: setup.administrator.id,
        agency: "Direct",
        applicationId: created.id,
        companyName: "Example Labs",
        contacts: [
          {
            email: null,
            name: "Taylor Hiring Manager",
            phone: null,
            role: "Hiring manager",
          },
        ],
        expectedUpdatedAt: created.updatedAt,
        links: [
          {
            label: "Interview briefing",
            url: "https://example.com/interview",
          },
        ],
        location: null,
        nextAction: "Send a thank-you note.",
        nextActionDue: "2026-07-19",
        rating: 5,
        salary: "£82,000",
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Interview",
        ),
        updatedAt: "2026-07-18T13:00:00.000Z",
        workspaceId: setup.workspace.id,
        workArrangement: "remote",
      });

      expect(transitioned).toMatchObject({
        agency: "Direct",
        companyName: "Example Labs",
        contacts: [
          {
            email: null,
            name: "Taylor Hiring Manager",
            phone: null,
            role: "Hiring manager",
          },
        ],
        links: [
          {
            label: "Interview briefing",
            url: "https://example.com/interview",
          },
        ],
        location: null,
        nextAction: "Send a thank-you note.",
        nextActionDue: "2026-07-19",
        rating: 5,
        salary: "£82,000",
        status: "Interview",
        updatedAt: "2026-07-18T13:00:00.000Z",
        workArrangement: "remote",
      });
      expect(() =>
        database
          .prepare("UPDATE applications SET agency = '' WHERE id = ?")
          .run(created.id),
      ).toThrow();
      expect(() =>
        database
          .prepare("UPDATE applications SET rating = 6 WHERE id = ?")
          .run(created.id),
      ).toThrow();
      expect(() =>
        database
          .prepare("UPDATE applications SET salary = '' WHERE id = ?")
          .run(created.id),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            "UPDATE applications SET work_arrangement = 'field' WHERE id = ?",
          )
          .run(created.id),
      ).toThrow();
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toEqual([
        expect.objectContaining({
          actorDisplayName: "Alex Example",
          fromStatus: "Prospect",
          occurredAt: "2026-07-18T13:00:00.000Z",
          toStatus: "Interview",
          type: "status_changed",
        }),
        expect.objectContaining({
          fromStatus: null,
          occurredAt: createdAt,
          toStatus: "Prospect",
          type: "application_created",
        }),
      ]);
      if (!transitioned) throw new Error("Expected the update to succeed");

      repository.updateApplication({
        actorUserId: setup.administrator.id,
        applicationId: created.id,
        expectedUpdatedAt: transitioned.updatedAt,
        notes: "Updated without changing stage.",
        nextAction: null,
        nextActionDue: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Interview",
        ),
        updatedAt: "2026-07-18T14:00:00.000Z",
        workspaceId: setup.workspace.id,
      });
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toHaveLength(2);
      expect(repository.listApplications(setup.workspace.id)[0]).toMatchObject({
        contacts: [
          {
            email: null,
            name: "Taylor Hiring Manager",
            phone: null,
            role: "Hiring manager",
          },
        ],
        links: [
          {
            label: "Interview briefing",
            url: "https://example.com/interview",
          },
        ],
        nextAction: null,
        nextActionDue: null,
      });
    } finally {
      database.close();
    }
  });

  it("rejects stale updates without changing fields, relations, or history", () => {
    const { database, repository, setup } = createRepository();
    const prospectId = referenceId(
      database,
      setup.workspace.id,
      "status",
      "Prospect",
    );
    const interviewId = referenceId(
      database,
      setup.workspace.id,
      "status",
      "Interview",
    );

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        contacts: [
          {
            email: "original@example.com",
            name: "Original Contact",
            phone: null,
            role: "Recruiter",
          },
        ],
        createdAt,
        createdByUserId: setup.administrator.id,
        links: [{ label: "Original", url: "https://example.com/original" }],
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: prospectId,
        workspaceId: setup.workspace.id,
      });
      const latest = repository.updateApplication({
        actorUserId: setup.administrator.id,
        applicationId: created.id,
        companyName: "First editor wins",
        expectedUpdatedAt: created.updatedAt,
        statusId: interviewId,
        updatedAt: "2026-07-18T13:00:00.000Z",
        workspaceId: setup.workspace.id,
      });

      expect(() =>
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          expectedUpdatedAt: created.updatedAt,
          companyName: "Stale overwrite",
          contacts: [
            {
              email: "stale@example.com",
              name: "Stale Contact",
              phone: null,
              role: null,
            },
          ],
          expectedUpdatedAt: created.updatedAt,
          links: [{ label: "Stale", url: "https://example.com/stale" }],
          statusId: prospectId,
          updatedAt: "2026-07-18T14:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toThrowError(ApplicationConflictError);
      expect(repository.listApplications(setup.workspace.id)[0]).toEqual(
        latest,
      );
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("keeps inactive historical selections while rejecting new use", () => {
    const { database, repository, setup } = createRepository();
    const statusId = referenceId(
      database,
      setup.workspace.id,
      "status",
      "Applied",
    );

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId,
        workspaceId: setup.workspace.id,
      });
      database
        .prepare(
          `UPDATE reference_values SET is_active = 0
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(setup.workspace.id, statusId);

      expect(
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          expectedUpdatedAt: created.updatedAt,
          notes: "The historical status remains selected.",
          updatedAt: "2026-07-18T13:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toMatchObject({
        notes: "The historical status remains selected.",
        status: "Applied",
        statusId,
      });

      expect(() =>
        repository.createApplication({
          appliedOn: null,
          companyName: "Another Studio",
          createdAt: "2026-07-18T14:00:00.000Z",
          createdByUserId: setup.administrator.id,
          location: null,
          nextAction: null,
          nextActionDue: null,
          notes: null,
          roleTitle: "Engineer",
          sourceUrl: null,
          statusId,
          workspaceId: setup.workspace.id,
        }),
      ).toThrow("Invalid application reference value");
    } finally {
      database.close();
    }
  });

  it("rolls back an invalid relation replacement atomically", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        contacts: [
          {
            email: "morgan@example.com",
            name: "Morgan Recruiter",
            phone: null,
            role: null,
          },
        ],
        createdAt,
        createdByUserId: setup.administrator.id,
        links: [],
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });

      expect(() =>
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          companyName: "Should roll back",
          contacts: [
            {
              email: "invalid-email",
              name: "Invalid contact",
              phone: null,
              role: null,
            },
          ],
          expectedUpdatedAt: created.updatedAt,
          updatedAt: "2026-07-18T13:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toThrow();
      expect(repository.listApplications(setup.workspace.id)[0]).toMatchObject({
        companyName: "Example Studio",
        contacts: [
          {
            email: "morgan@example.com",
            name: "Morgan Recruiter",
          },
        ],
        updatedAt: createdAt,
      });
    } finally {
      database.close();
    }
  });

  it("keeps updates and history inside the requested workspace", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });

      expect(
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          companyName: "Cross-scope attempt",
          expectedUpdatedAt: created.updatedAt,
          updatedAt: "2026-07-18T13:00:00.000Z",
          workspaceId: "workspace-00002",
        }),
      ).toBeUndefined();
      expect(
        repository.deleteApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          deletedAt: "2026-07-18T13:00:00.000Z",
          workspaceId: "workspace-00002",
        }),
      ).toBe(false);
      expect(
        repository.listApplicationEvents("workspace-00002", created.id),
      ).toBeUndefined();
      expect(repository.listApplications(setup.workspace.id)[0]).toMatchObject({
        companyName: "Example Studio",
      });
    } finally {
      database.close();
    }
  });

  it("soft deletes an application while preserving history and audit data", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });

      expect(
        repository.deleteApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          deletedAt: "2026-07-18T15:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toBe(true);
      expect(repository.listApplications(setup.workspace.id)).toEqual([]);
      expect(
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          companyName: "Hidden update",
          expectedUpdatedAt: created.updatedAt,
          updatedAt: "2026-07-18T16:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toBeUndefined();
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toBeUndefined();
      expect(
        database
          .prepare(
            `SELECT actor_user_id AS actorUserId, deleted_at AS deletedAt,
                    workspace_id AS workspaceId
             FROM application_deletions WHERE application_id = ?`,
          )
          .get(created.id),
      ).toEqual({
        actorUserId: setup.administrator.id,
        deletedAt: "2026-07-18T15:00:00.000Z",
        workspaceId: setup.workspace.id,
      });
      expect(
        database
          .prepare(
            "SELECT count(*) FROM application_events WHERE application_id = ?",
          )
          .pluck()
          .get(created.id),
      ).toBe(1);
      expect(
        repository.deleteApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          deletedAt: "2026-07-18T17:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toBe(false);
    } finally {
      database.close();
    }
  });

  it("rolls back deletion when its audit actor is invalid", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });

      expect(() =>
        repository.deleteApplication({
          actorUserId: "missing-user",
          applicationId: created.id,
          deletedAt: "2026-07-18T15:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toThrow();
      expect(repository.listApplications(setup.workspace.id)).toEqual([
        created,
      ]);
      expect(
        database
          .prepare("SELECT count(*) FROM application_deletions")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("prevents application history from being changed or removed", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });
      const eventId = database
        .prepare("SELECT id FROM application_events WHERE application_id = ?")
        .pluck()
        .get(created.id);

      expect(() =>
        database
          .prepare("UPDATE application_events SET to_status = ? WHERE id = ?")
          .run("closed", eventId),
      ).toThrow("application events are immutable");
      expect(() =>
        database
          .prepare("DELETE FROM application_events WHERE id = ?")
          .run(eventId),
      ).toThrow("application events are immutable");
    } finally {
      database.close();
    }
  });

  it("appends, retries, paginates, and corrects general activity without changing status", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Product Designer",
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workspaceId: setup.workspace.id,
      });
      const input = {
        actorUserId: setup.administrator.id,
        applicationId: created.id,
        correctionReason: null,
        idempotencyKey: "email:recruiter-screen:1",
        occurredAt: createdAt,
        processedAt: "2026-07-18T13:00:00.000Z",
        sourceEmailEvidenceId: null,
        sourceEmailMessageId: "<screen@example.com>",
        summary: "Completed a recruiter screen",
        supersedesEventId: null,
        type: "recruiter_screen" as const,
        workspaceId: setup.workspace.id,
      };

      const activity = repository.addApplicationActivity(input);
      expect(activity).toMatchObject({
        actorDisplayName: "Alex Example",
        occurredAt: createdAt,
        processedAt: "2026-07-18T13:00:00.000Z",
        summary: "Completed a recruiter screen",
        toStatus: null,
        type: "recruiter_screen",
      });
      expect(repository.addApplicationActivity(input)).toEqual(activity);
      expect(repository.listApplications(setup.workspace.id)[0]).toEqual(
        created,
      );
      expect(
        repository.listApplicationEventsPage(setup.workspace.id, created.id, {
          limit: 1,
          offset: 0,
        }),
      ).toMatchObject({
        events: [activity],
        limit: 1,
        nextOffset: 1,
        offset: 0,
        returned: 1,
        total: 2,
      });

      const correction = repository.addApplicationActivity({
        ...input,
        correctionReason: "Corrected the activity wording",
        idempotencyKey: "email:recruiter-screen:1:correction",
        processedAt: "2026-07-18T13:05:00.000Z",
        summary: "Recruiter screen scheduled",
        supersedesEventId: activity?.id ?? null,
        type: "interview_scheduled",
      });
      expect(correction).toMatchObject({
        correctionReason: "Corrected the activity wording",
        supersedesEventId: activity?.id,
        type: "interview_scheduled",
      });
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toEqual(expect.arrayContaining([activity, correction]));
      expect(() =>
        repository.addApplicationActivity({
          ...input,
          correctionReason: "Second replacement",
          idempotencyKey: "second-correction",
          supersedesEventId: activity?.id ?? null,
        }),
      ).toThrow(
        new ApplicationActivityCorrectionError("correction_already_exists"),
      );

      repository.addApplicationActivity({
        ...input,
        idempotencyKey: "later-general-activity",
        occurredAt: "2026-07-18T16:00:00.000Z",
        processedAt: "2026-07-18T16:05:00.000Z",
        sourceEmailMessageId: null,
        summary: "Recorded a later general note",
        type: "note",
      });
      expect(
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          expectedUpdatedAt: created.updatedAt,
          statusEvent: {
            effectiveAt: "2026-07-18T15:00:00.000Z",
            overrideReason: null,
            sourceEmailMessageId: "<status-after-activity@example.com>",
          },
          statusId: referenceId(
            database,
            setup.workspace.id,
            "status",
            "Applied",
          ),
          updatedAt: "2026-07-18T17:00:00.000Z",
          workspaceId: setup.workspace.id,
        }),
      ).toMatchObject({ status: "Applied" });
    } finally {
      database.close();
    }
  });

  it("rejects mismatched idempotency, evidence, and correction targets", () => {
    const { database, repository, setup } = createRepository();
    try {
      const create = (companyName: string) =>
        repository.createApplication({
          appliedOn: null,
          companyName,
          createdAt,
          createdByUserId: setup.administrator.id,
          location: null,
          nextAction: null,
          nextActionDue: null,
          notes: null,
          roleTitle: "Engineer",
          sourceUrl: null,
          statusId: referenceId(
            database,
            setup.workspace.id,
            "status",
            "Prospect",
          ),
          workspaceId: setup.workspace.id,
        });
      const first = create("First Ltd");
      const second = create("Second Ltd");
      const common = {
        actorUserId: setup.administrator.id,
        applicationId: first.id,
        correctionReason: null,
        idempotencyKey: "activity-key",
        occurredAt: createdAt,
        processedAt: createdAt,
        sourceEmailEvidenceId: null,
        sourceEmailMessageId: null,
        summary: "Recruiter made contact",
        supersedesEventId: null,
        type: "recruiter_contact" as const,
        workspaceId: setup.workspace.id,
      };
      repository.addApplicationActivity(common);
      expect(() =>
        repository.addApplicationActivity({
          ...common,
          summary: "Different payload",
        }),
      ).toThrow(ApplicationActivityIdempotencyConflictError);
      expect(() =>
        repository.addApplicationActivity({
          ...common,
          idempotencyKey: "invalid-evidence",
          sourceEmailEvidenceId: "11111111-1111-4111-8111-111111111111",
        }),
      ).toThrow(ApplicationActivityEvidenceError);
      const firstActivity = repository.listApplicationEvents(
        setup.workspace.id,
        first.id,
      )?.[0];
      expect(() =>
        repository.addApplicationActivity({
          ...common,
          applicationId: second.id,
          correctionReason: "Wrong application",
          idempotencyKey: "wrong-correction",
          supersedesEventId: firstActivity?.id ?? null,
        }),
      ).toThrow(
        new ApplicationActivityCorrectionError("invalid_correction_target"),
      );
    } finally {
      database.close();
    }
  });

  it("creates, reads, updates, and clears normalized salary and work-arrangement details", () => {
    const { database, repository, setup } = createRepository();
    try {
      const application = repository.createApplication({
        appliedOn: null,
        companyName: "Structured Ltd",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: "London",
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTitle: "Engineer",
        salary: "£70,000 to £80,000 plus bonus",
        salaryDetails: {
          currency: "GBP",
          disclosed: true,
          maximum: 80_000,
          minimum: 70_000,
          negotiable: false,
          period: "annual",
        },
        sourceUrl: null,
        statusId: referenceId(
          database,
          setup.workspace.id,
          "status",
          "Prospect",
        ),
        workArrangement: "hybrid",
        workArrangementDetails: {
          officeDaysPerWeek: 2,
          originalText: "Two days in the London office",
          remoteDaysPerWeek: 3,
        },
        workspaceId: setup.workspace.id,
      });
      expect(application).toMatchObject({
        salary: "£70,000 to £80,000 plus bonus",
        salaryDetails: {
          currency: "GBP",
          disclosed: true,
          maximum: 80_000,
          minimum: 70_000,
          negotiable: false,
          period: "annual",
        },
        workArrangement: "hybrid",
        workArrangementDetails: {
          officeDaysPerWeek: 2,
          originalText: "Two days in the London office",
          remoteDaysPerWeek: 3,
        },
      });

      const updated = repository.updateApplication({
        actorUserId: setup.administrator.id,
        applicationId: application.id,
        expectedUpdatedAt: application.updatedAt,
        salaryDetails: null,
        updatedAt: "2026-07-18T12:01:00.000Z",
        workArrangement: "remote",
        workArrangementDetails: {
          officeDaysPerWeek: 0,
          originalText: "Fully remote",
          remoteDaysPerWeek: 5,
        },
        workspaceId: setup.workspace.id,
      });
      expect(updated).toMatchObject({
        salary: "£70,000 to £80,000 plus bonus",
        salaryDetails: null,
        workArrangement: "remote",
        workArrangementDetails: {
          officeDaysPerWeek: 0,
          originalText: "Fully remote",
          remoteDaysPerWeek: 5,
        },
      });
      expect(() =>
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: application.id,
          expectedUpdatedAt: updated!.updatedAt,
          updatedAt: "2026-07-18T12:02:00.000Z",
          workArrangementDetails: { officeDaysPerWeek: 1 },
          workspaceId: setup.workspace.id,
        }),
      ).toThrow(RangeError);
    } finally {
      database.close();
    }
  });

  it("retains immutable provenance with precedence, conflicts, staleness, verification, and exact retry", () => {
    const { database, repository, setup } = createRepository();
    try {
      const create = (companyName: string) =>
        repository.createApplication({
          appliedOn: null,
          companyName,
          createdAt,
          createdByUserId: setup.administrator.id,
          location: null,
          nextAction: null,
          nextActionDue: null,
          notes: null,
          roleTitle: "Engineer",
          salary: "Original wording remains authoritative",
          sourceUrl: null,
          statusId: referenceId(
            database,
            setup.workspace.id,
            "status",
            "Prospect",
          ),
          workspaceId: setup.workspace.id,
        });
      const application = create("Evidence Ltd");
      const other = create("Other Ltd");
      const jobPostingId = "posting-0001";
      database
        .prepare(
          `INSERT INTO application_job_postings
             (id, workspace_id, application_id, provider, external_posting_id,
              canonical_url, created_at, updated_at)
           VALUES (?, ?, ?, 'indeed', ?, NULL, ?, ?)`,
        )
        .run(
          jobPostingId,
          setup.workspace.id,
          application.id,
          "indeed-123",
          createdAt,
          createdAt,
        );

      const imported = repository.recordApplicationFieldProvenance({
        applicationId: application.id,
        confidence: 0.9,
        createdAt,
        field: "salary",
        fieldState: "disclosed",
        idempotencyKey: "salary-import-1",
        observedAt: "2026-07-20T12:00:00.000Z",
        source: { type: "imported" },
        value: "£55,000",
        workspaceId: setup.workspace.id,
      });
      const posting = repository.recordApplicationFieldProvenance({
        applicationId: application.id,
        confidence: 0.95,
        createdAt,
        field: "salary",
        fieldState: "disclosed",
        idempotencyKey: "salary-posting-1",
        observedAt: "2026-07-19T12:00:00.000Z",
        source: { jobPostingId, type: "job_posting" },
        value: "£60,000",
        workspaceId: setup.workspace.id,
      });
      repository.recordApplicationFieldProvenance({
        applicationId: application.id,
        confidence: 0.7,
        createdAt,
        field: "salary",
        fieldState: "disclosed",
        observedAt: "2026-07-18T12:00:00.000Z",
        source: { type: "imported" },
        value: "£50,000",
        workspaceId: setup.workspace.id,
      });
      const assessment = repository.listApplicationFieldProvenance(
        setup.workspace.id,
        application.id,
      )?.[0];
      expect(assessment).toMatchObject({
        conflicting: 1,
        selected: { id: posting?.id, relationship: "selected" },
        stale: 1,
      });
      expect(repository.listApplications(setup.workspace.id)[0]?.salary).toBe(
        "Original wording remains authoritative",
      );

      const retried = repository.recordApplicationFieldProvenance({
        applicationId: application.id,
        confidence: 0.9,
        createdAt: "2026-07-21T12:00:00.000Z",
        field: "salary",
        fieldState: "disclosed",
        idempotencyKey: "salary-import-1",
        observedAt: "2026-07-20T12:00:00.000Z",
        source: { type: "imported" },
        value: "£55,000",
        workspaceId: setup.workspace.id,
      });
      expect(retried?.id).toBe(imported?.id);
      expect(() =>
        repository.recordApplicationFieldProvenance({
          applicationId: application.id,
          confidence: 0.8,
          createdAt,
          field: "salary",
          fieldState: "disclosed",
          idempotencyKey: "salary-import-1",
          observedAt: "2026-07-20T12:00:00.000Z",
          source: { type: "imported" },
          value: "different",
          workspaceId: setup.workspace.id,
        }),
      ).toThrow(ApplicationFieldProvenanceIdempotencyConflictError);
      expect(() =>
        repository.recordApplicationFieldProvenance({
          applicationId: other.id,
          confidence: 1,
          createdAt,
          field: "salary",
          fieldState: "disclosed",
          observedAt: createdAt,
          source: { jobPostingId, type: "job_posting" },
          value: "£60,000",
          workspaceId: setup.workspace.id,
        }),
      ).toThrow(ApplicationFieldProvenanceSourceError);

      const verified = repository.verifyApplicationFieldProvenance({
        applicationId: application.id,
        provenanceId: imported!.id,
        verifiedAt: "2026-07-22T12:00:00.000Z",
        verifiedByUserId: setup.administrator.id,
        workspaceId: setup.workspace.id,
      });
      expect(verified).toMatchObject({
        relationship: "selected",
        verifiedAt: "2026-07-22T12:00:00.000Z",
        verifiedByDisplayName: "Alex Example",
      });
      expect(() =>
        database
          .prepare(
            `UPDATE application_field_provenance SET confidence = 0
             WHERE id = ?`,
          )
          .run(imported!.id),
      ).toThrow(/immutable/);
      expect(() =>
        database
          .prepare(`DELETE FROM application_field_provenance WHERE id = ?`)
          .run(imported!.id),
      ).toThrow(/immutable/);
      expect(
        repository.listApplicationFieldProvenance(
          "wrong-workspace",
          application.id,
        ),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
