import { describe, expect, it } from "vitest";

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

describe("SqliteApplicationsRepository", () => {
  it("creates and lists application fields without internal scope data", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createApplication({
        appliedOn: "2026-07-18",
        companyName: "Example Studio",
        createdAt,
        createdByUserId: setup.administrator.id,
        location: "Remote",
        nextAction: "Send the portfolio follow-up.",
        nextActionDue: "2026-07-21",
        notes: "Referred by a former colleague.",
        roleTitle: "Product Designer",
        sourceUrl: "https://jobs.example.com/product-designer",
        status: "applied",
        workspaceId: setup.workspace.id,
      });

      expect(created).toMatchObject({
        appliedOn: "2026-07-18",
        companyName: "Example Studio",
        location: "Remote",
        nextAction: "Send the portfolio follow-up.",
        nextActionDue: "2026-07-21",
        status: "applied",
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
          toStatus: "applied",
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
        status: "prospect",
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
          status: "prospect",
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
      status: "prospect" as const,
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
        status: "prospect",
        workspaceId: setup.workspace.id,
      });
      const transitioned = repository.updateApplication({
        actorUserId: setup.administrator.id,
        applicationId: created.id,
        companyName: "Example Labs",
        location: null,
        nextAction: "Send a thank-you note.",
        nextActionDue: "2026-07-19",
        status: "interview",
        updatedAt: "2026-07-18T13:00:00.000Z",
        workspaceId: setup.workspace.id,
      });

      expect(transitioned).toMatchObject({
        companyName: "Example Labs",
        location: null,
        nextAction: "Send a thank-you note.",
        nextActionDue: "2026-07-19",
        status: "interview",
        updatedAt: "2026-07-18T13:00:00.000Z",
      });
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toEqual([
        expect.objectContaining({
          actorDisplayName: "Alex Example",
          fromStatus: "prospect",
          occurredAt: "2026-07-18T13:00:00.000Z",
          toStatus: "interview",
          type: "status_changed",
        }),
        expect.objectContaining({
          fromStatus: null,
          occurredAt: createdAt,
          toStatus: "prospect",
          type: "application_created",
        }),
      ]);

      repository.updateApplication({
        actorUserId: setup.administrator.id,
        applicationId: created.id,
        notes: "Updated without changing stage.",
        nextAction: null,
        nextActionDue: null,
        status: "interview",
        updatedAt: "2026-07-18T14:00:00.000Z",
        workspaceId: setup.workspace.id,
      });
      expect(
        repository.listApplicationEvents(setup.workspace.id, created.id),
      ).toHaveLength(2);
      expect(repository.listApplications(setup.workspace.id)[0]).toMatchObject({
        nextAction: null,
        nextActionDue: null,
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
        status: "prospect",
        workspaceId: setup.workspace.id,
      });

      expect(
        repository.updateApplication({
          actorUserId: setup.administrator.id,
          applicationId: created.id,
          companyName: "Cross-scope attempt",
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
        status: "prospect",
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
        status: "prospect",
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
        status: "prospect",
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
