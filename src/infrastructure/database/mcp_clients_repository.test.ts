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
          accessMode: "read_only",
          actorUserId: beta.userId,
          name: "Wrong workspace",
        }),
      ).toThrow(McpClientActorUnavailableError);

      const issued = service.create(alpha, {
        accessMode: "read_write",
        actorUserId: alpha.userId,
        name: "Alpha client",
      });
      expect(issued.client.accessMode).toBe("read_write");
      expect(service.authorize(issued.bearerToken).accessMode).toBe(
        "read_write",
      );
      expect(
        service.updateAccessMode(alpha, issued.client.clientId, "read_only")
          .accessMode,
      ).toBe("read_only");
      expect(service.authorize(issued.bearerToken).accessMode).toBe(
        "read_only",
      );
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

  it("permanently deletes an issued client in the administrator workspace", () => {
    const database = openApplicationDatabase(":memory:");
    const alpha = seedWorkspace(database, "alpha-delete");
    const beta = seedWorkspace(database, "beta-delete");
    const service = new McpClientCredentialsService(
      new SqliteMcpClientsRepository(database),
      new CryptoMcpClientTokenManager(),
      () => new Date("2026-01-01T01:00:00.000Z"),
    );

    try {
      const issued = service.create(alpha, {
        accessMode: "read_only",
        actorUserId: alpha.userId,
        name: "Disposable client",
      });
      expect(() => service.delete(beta, issued.client.clientId)).toThrow(
        McpClientNotFoundError,
      );
      service.delete(alpha, issued.client.clientId);

      expect(service.getDirectory(alpha).clients).toEqual([]);
      expect(() => service.authorize(issued.bearerToken)).toThrow("invalid");
      expect(
        database.prepare("SELECT count(*) AS count FROM mcp_clients").get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("generates a new token in the same row after revocation", () => {
    const database = openApplicationDatabase(":memory:");
    const alpha = seedWorkspace(database, "regenerate");
    const service = new McpClientCredentialsService(
      new SqliteMcpClientsRepository(database),
      new CryptoMcpClientTokenManager(),
      () => new Date("2026-01-01T01:00:00.000Z"),
    );

    try {
      const issued = service.create(alpha, {
        accessMode: "read_only",
        actorUserId: alpha.userId,
        name: "Recoverable client",
      });
      service.revoke(alpha, issued.client.clientId);

      const regenerated = service.rotate(alpha, issued.client.clientId);

      expect(regenerated.client).toMatchObject({
        clientId: issued.client.clientId,
        state: "active",
      });
      expect(regenerated.bearerToken).not.toBe(issued.bearerToken);
      expect(() => service.authorize(issued.bearerToken)).toThrow("invalid");
      expect(service.authorize(regenerated.bearerToken)).toMatchObject({
        actor: { userId: alpha.userId },
      });
      expect(service.getDirectory(alpha).clients).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("parameterizes the permanent-delete client identifier", () => {
    const database = openApplicationDatabase(":memory:");
    const alpha = seedWorkspace(database, "delete-input");
    const service = new McpClientCredentialsService(
      new SqliteMcpClientsRepository(database),
      new CryptoMcpClientTokenManager(),
    );

    try {
      expect(() =>
        service.delete(alpha, "atmcp_invalid'; DELETE FROM mcp_clients; --"),
      ).toThrow(McpClientNotFoundError);
      expect(
        database.prepare("SELECT count(*) AS count FROM mcp_clients").get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
