import { describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "../../application/auth.js";
import {
  McpClientActorUnavailableError,
  McpClientCredentialsService,
  McpClientNotFoundError,
} from "../../application/mcp_clients.js";
import { CryptoMcpClientTokenManager } from "../auth/mcp_client_token_manager.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteMcpClientsRepository } from "./mcp_clients_repository.js";

function seedWorkspace(
  database: ReturnType<typeof openApplicationDatabase>,
  suffix: string,
): AuthenticatedActor {
  const workspaceId = `workspace-${suffix}`;
  const userId = `user-${suffix}-0001`;
  const timestamp = "2026-01-01T00:00:00.000Z";
  database
    .prepare(
      `INSERT INTO workspaces (id, name, slug, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, `Workspace ${suffix}`, suffix, timestamp);
  database
    .prepare(
      `INSERT INTO users
         (id, username, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .run(userId, `user-${suffix}`, `User ${suffix}`, timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO workspace_memberships
         (workspace_id, user_id, role, created_at)
       VALUES (?, ?, 'admin', ?)`,
    )
    .run(workspaceId, userId, timestamp);
  return {
    authenticated: true,
    user: {
      displayName: `User ${suffix}`,
      role: "admin",
      username: `user-${suffix}`,
    },
    userId,
    workspace: { name: `Workspace ${suffix}` },
    workspaceId,
  };
}

describe("SqliteMcpClientsRepository", () => {
  it("enforces actor and lifecycle operations within the administrator workspace", () => {
    const database = openApplicationDatabase(":memory:");
    const alpha = seedWorkspace(database, "alpha");
    const beta = seedWorkspace(database, "beta");
    const service = new McpClientCredentialsService(
      new SqliteMcpClientsRepository(database),
      new CryptoMcpClientTokenManager(),
      () => new Date("2026-01-01T01:00:00.000Z"),
    );

    try {
      expect(() =>
        service.create(alpha, {
          actorUserId: beta.userId,
          name: "Wrong workspace",
        }),
      ).toThrow(McpClientActorUnavailableError);

      const issued = service.create(alpha, {
        actorUserId: alpha.userId,
        name: "Alpha client",
      });
      expect(() => service.rotate(beta, issued.client.clientId)).toThrow(
        McpClientNotFoundError,
      );
      expect(() => service.revoke(beta, issued.client.clientId)).toThrow(
        McpClientNotFoundError,
      );
      expect(service.getDirectory(beta).clients).toEqual([]);

      database
        .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(alpha.userId);
      expect(service.getDirectory(alpha).clients).toMatchObject([
        { clientId: issued.client.clientId, state: "unavailable" },
      ]);
      expect(() => service.authorize(issued.bearerToken)).toThrow("invalid");
    } finally {
      database.close();
    }
  });
});
