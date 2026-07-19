import { describe, expect, it } from "vitest";

import { openApplicationDatabase } from "./connection.js";
import { SqliteRemoteMcpActorRepository } from "./mcp_oauth_actor_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

describe("SqliteRemoteMcpActorRepository", () => {
  it("resolves only an exact external identity with an active membership", () => {
    const database = openApplicationDatabase(":memory:");
    const setup = new SqliteSetupRepository(database);
    const created = setup.createInitialAdministrator({
      completedAt: "2026-01-01T00:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    database
      .prepare(
        `INSERT INTO external_identities
           (id, user_id, issuer, subject, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "identity-1",
        created.administrator.id,
        "https://identity.example/application/o/mcp/",
        "subject-123",
        "2026-01-01T00:00:00.000Z",
      );
    const repository = new SqliteRemoteMcpActorRepository(database);
    const binding = {
      issuer: "https://identity.example/application/o/mcp/",
      subject: "subject-123",
      workspaceSlug: "default",
    };

    try {
      expect(repository.findActiveActor(binding)).toEqual({
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
        repository.findActiveActor({ ...binding, subject: "subject-124" }),
      ).toBeUndefined();
      expect(
        repository.findActiveActor({
          ...binding,
          issuer: "https://other.example/application/o/mcp/",
        }),
      ).toBeUndefined();
      expect(
        repository.findActiveActor({
          ...binding,
          workspaceSlug: "other-workspace",
        }),
      ).toBeUndefined();

      database
        .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(created.administrator.id);
      expect(repository.findActiveActor(binding)).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
