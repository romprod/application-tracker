import { describe, expect, it } from "vitest";

import { CryptoMcpOAuthTokenManager } from "../infrastructure/auth/mcp_oauth_token_manager.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteMcpBuiltInOAuthRepository } from "../infrastructure/database/mcp_builtin_oauth_repository.js";
import type { AuthenticatedActor } from "./auth.js";
import {
  InvalidMcpOAuthClientError,
  InvalidMcpOAuthGrantError,
  McpBuiltInOAuthService,
  McpOAuthConnectionForbiddenError,
} from "./mcp_builtin_oauth.js";

const resourceUrl = "https://tracker.example/mcp";
const requiredScope = "application-tracker:tools";
const timestamp = "2026-01-01T00:00:00.000Z";

function seedActor(
  database: ReturnType<typeof openApplicationDatabase>,
): AuthenticatedActor {
  database
    .prepare(
      `INSERT INTO workspaces (id, name, slug, created_at)
       VALUES ('workspace-oauth', 'Applications', 'default', ?)`,
    )
    .run(timestamp);
  database
    .prepare(
      `INSERT INTO users
         (id, username, display_name, status, created_at, updated_at)
       VALUES ('user-oauth', 'alex', 'Alex Example', 'active', ?, ?)`,
    )
    .run(timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO workspace_memberships
         (workspace_id, user_id, role, created_at)
       VALUES ('workspace-oauth', 'user-oauth', 'admin', ?)`,
    )
    .run(timestamp);
  return {
    authenticated: true,
    user: { displayName: "Alex Example", role: "admin", username: "alex" },
    userId: "user-oauth",
    workspace: { name: "Applications" },
    workspaceId: "workspace-oauth",
  };
}

describe("McpBuiltInOAuthService", () => {
  it("registers a public Claude client and completes code, refresh, and revocation lifecycles", () => {
    const database = openApplicationDatabase(":memory:");
    const actor = seedActor(database);
    let now = new Date(timestamp);
    const service = new McpBuiltInOAuthService(
      new SqliteMcpBuiltInOAuthRepository(database),
      new CryptoMcpOAuthTokenManager(),
      { requiredScope, resourceUrl },
      () => now,
    );

    try {
      const client = service.registerClient({
        clientName: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      });
      expect(client).toMatchObject({
        clientName: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      });
      expect(client.clientId).toMatch(/^atoc_[A-Za-z0-9_-]{24}$/);

      const authorization = service.beginAuthorization(actor, {
        accessMode: "read_write",
        clientId: client.clientId,
        codeChallenge: "c".repeat(43),
        redirectUri: client.redirectUris[0]!,
        resource: resourceUrl,
        scopes: [requiredScope],
      });
      expect(
        service.challengeForAuthorizationCode(
          client.clientId,
          authorization.code,
        ),
      ).toBe("c".repeat(43));
      expect(() =>
        service.exchangeAuthorizationCode({
          authorizationCode: authorization.code,
          clientId: client.clientId,
          redirectUri: client.redirectUris[0]!,
          resource: "https://other.example/mcp",
        }),
      ).toThrow(InvalidMcpOAuthGrantError);

      const tokens = service.exchangeAuthorizationCode({
        authorizationCode: authorization.code,
        clientId: client.clientId,
        redirectUri: client.redirectUris[0]!,
        resource: resourceUrl,
      });
      expect(tokens).toMatchObject({
        expiresIn: 900,
        scope: requiredScope,
        tokenType: "Bearer",
      });
      expect(service.authorize(tokens.accessToken)).toMatchObject({
        accessMode: "read_write",
        actor: { userId: actor.userId, workspaceId: actor.workspaceId },
        workspaceSlug: "default",
      });
      expect(() =>
        service.exchangeAuthorizationCode({
          authorizationCode: authorization.code,
          clientId: client.clientId,
          redirectUri: client.redirectUris[0]!,
          resource: resourceUrl,
        }),
      ).toThrow(InvalidMcpOAuthGrantError);

      now = new Date("2026-01-01T00:01:00.000Z");
      const refreshed = service.exchangeRefreshToken({
        clientId: client.clientId,
        refreshToken: tokens.refreshToken,
        resource: resourceUrl,
        scopes: [requiredScope],
      });
      expect(service.authorize(refreshed.accessToken).actor.userId).toBe(
        actor.userId,
      );
      expect(service.listConnections(actor)).toEqual([
        {
          accessMode: "read_write",
          actor: {
            displayName: "Alex Example",
            id: "user-oauth",
            username: "alex",
          },
          clientId: client.clientId,
          createdAt: timestamp,
          lastUsedAt: "2026-01-01T00:01:00.000Z",
          name: "Claude",
          state: "active",
        },
      ]);
      expect(() =>
        service.exchangeRefreshToken({
          clientId: client.clientId,
          refreshToken: tokens.refreshToken,
          resource: resourceUrl,
        }),
      ).toThrow(InvalidMcpOAuthGrantError);

      service.revokeToken(client.clientId, refreshed.refreshToken);
      expect(() => service.authorize(refreshed.accessToken)).toThrow(
        InvalidMcpOAuthGrantError,
      );
      expect(service.listConnections(actor)).toMatchObject([
        { clientId: client.clientId, state: "revoked" },
      ]);

      const serialized = database.serialize();
      expect(serialized.includes(Buffer.from(tokens.accessToken))).toBe(false);
      expect(serialized.includes(Buffer.from(tokens.refreshToken))).toBe(false);
    } finally {
      database.close();
    }
  });

  it("rejects untrusted redirect targets during registration", () => {
    const database = openApplicationDatabase(":memory:");
    const service = new McpBuiltInOAuthService(
      new SqliteMcpBuiltInOAuthRepository(database),
      new CryptoMcpOAuthTokenManager(),
      { requiredScope, resourceUrl },
    );

    try {
      expect(() =>
        service.registerClient({
          clientName: "Imposter",
          redirectUris: ["https://attacker.example/callback"],
        }),
      ).toThrow(InvalidMcpOAuthClientError);
    } finally {
      database.close();
    }
  });

  it("registers current and legacy ChatGPT callback URLs only on the trusted origin", () => {
    const database = openApplicationDatabase(":memory:");
    const service = new McpBuiltInOAuthService(
      new SqliteMcpBuiltInOAuthRepository(database),
      new CryptoMcpOAuthTokenManager(),
      { requiredScope, resourceUrl },
    );
    const currentCallback =
      "https://chatgpt.com/connector/oauth/7cb18f93-8cf2-4a25-b991-1d19a1326a34";

    try {
      expect(
        service.registerClient({
          clientName: "ChatGPT",
          redirectUris: [currentCallback],
        }).redirectUris,
      ).toEqual([currentCallback]);
      expect(
        service.registerClient({
          clientName: "Published ChatGPT app",
          redirectUris: [
            "https://chatgpt.com/connector_platform_oauth_redirect",
          ],
        }).redirectUris,
      ).toEqual(["https://chatgpt.com/connector_platform_oauth_redirect"]);

      for (const redirectUri of [
        "https://chatgpt.com/connector/oauth/",
        "https://chatgpt.com/connector/oauth/id/extra",
        "https://chatgpt.com/connector/oauth/id?next=https://attacker.example",
        "https://chatgpt.com.evil.example/connector/oauth/id",
      ]) {
        expect(() =>
          service.registerClient({
            clientName: "Imposter",
            redirectUris: [redirectUri],
          }),
        ).toThrow(InvalidMcpOAuthClientError);
      }
    } finally {
      database.close();
    }
  });

  it("deletes one workspace-bound OAuth connection and invalidates its tokens", () => {
    const database = openApplicationDatabase(":memory:");
    const actor = seedActor(database);
    const service = new McpBuiltInOAuthService(
      new SqliteMcpBuiltInOAuthRepository(database),
      new CryptoMcpOAuthTokenManager(),
      { requiredScope, resourceUrl },
      () => new Date(timestamp),
    );

    try {
      const client = service.registerClient({
        clientName: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      });
      const authorization = service.beginAuthorization(actor, {
        accessMode: "read_only",
        clientId: client.clientId,
        codeChallenge: "c".repeat(43),
        redirectUri: client.redirectUris[0]!,
        resource: resourceUrl,
        scopes: [requiredScope],
      });
      const tokens = service.exchangeAuthorizationCode({
        authorizationCode: authorization.code,
        clientId: client.clientId,
        redirectUri: client.redirectUris[0]!,
        resource: resourceUrl,
      });

      expect(() =>
        service.deleteConnection(
          { ...actor, user: { ...actor.user, role: "member" } },
          client.clientId,
          actor.userId,
        ),
      ).toThrow(McpOAuthConnectionForbiddenError);
      expect(service.authorize(tokens.accessToken)).toBeDefined();

      service.deleteConnection(actor, client.clientId, actor.userId);

      expect(service.listConnections(actor)).toEqual([]);
      expect(() => service.authorize(tokens.accessToken)).toThrow(
        InvalidMcpOAuthGrantError,
      );
      expect(service.getClient(client.clientId)).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("allows a native client to select an ephemeral loopback port", () => {
    const database = openApplicationDatabase(":memory:");
    const actor = seedActor(database);
    const service = new McpBuiltInOAuthService(
      new SqliteMcpBuiltInOAuthRepository(database),
      new CryptoMcpOAuthTokenManager(),
      { requiredScope, resourceUrl },
    );

    try {
      const client = service.registerClient({
        clientName: "Codex",
        redirectUris: ["http://127.0.0.1/oauth/callback"],
      });
      expect(() =>
        service.beginAuthorization(actor, {
          accessMode: "read_only",
          clientId: client.clientId,
          codeChallenge: "c".repeat(43),
          redirectUri: "http://127.0.0.1:49152/oauth/callback",
          resource: resourceUrl,
          scopes: [requiredScope],
        }),
      ).not.toThrow();
    } finally {
      database.close();
    }
  });
});
