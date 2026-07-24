import { describe, expect, it } from "vitest";

import { ApplicationConflictError } from "../../application/applications.js";
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
});
