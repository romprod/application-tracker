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
        status: "applied",
      });
      expect(created).not.toHaveProperty("workspaceId");
      expect(created).not.toHaveProperty("createdByUserId");
      expect(repository.listApplications(setup.workspace.id)).toEqual([
        created,
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

  it("uses the workspace and update index for the ledger query", () => {
    const { database, setup } = createRepository();

    try {
      const plan = database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id FROM applications
           WHERE workspace_id = ?
           ORDER BY updated_at DESC, id DESC`,
        )
        .all(setup.workspace.id) as { detail: string }[];
      expect(plan.map((row) => row.detail).join(" ")).toContain(
        "applications_by_workspace_updated",
      );
    } finally {
      database.close();
    }
  });
});
