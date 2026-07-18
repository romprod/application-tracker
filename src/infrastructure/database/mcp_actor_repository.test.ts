import { describe, expect, it } from "vitest";

import { openApplicationDatabase } from "./connection.js";
import { SqliteMcpActorRepository } from "./mcp_actor_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

describe("SqliteMcpActorRepository", () => {
  it("resolves only an active user in the explicitly selected workspace", () => {
    const database = openApplicationDatabase(":memory:");
    const setup = new SqliteSetupRepository(database);
    const created = setup.createInitialAdministrator({
      completedAt: "2026-01-01T00:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    const repository = new SqliteMcpActorRepository(database);

    try {
      expect(
        repository.findActiveActor({
          username: "alex",
          workspaceSlug: "default",
        }),
      ).toEqual({
        authenticated: true,
        user: {
          displayName: "Alex Example",
          role: "admin",
          username: "alex",
        },
        userId: created.administrator.id,
        workspace: { name: "Applications" },
        workspaceId: created.workspace.id,
      });
      expect(
        repository.findActiveActor({
          username: "alex",
          workspaceSlug: "another-workspace",
        }),
      ).toBeUndefined();

      database
        .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(created.administrator.id);
      expect(
        repository.findActiveActor({
          username: "alex",
          workspaceSlug: "default",
        }),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
