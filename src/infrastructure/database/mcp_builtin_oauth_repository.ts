import type Database from "better-sqlite3";

import type {
  McpBuiltInOAuthRepository,
  McpOAuthAuthorizationCodeRecord,
  McpOAuthClient,
  McpOAuthConnection,
  McpOAuthIssuedTokenRecord,
  McpOAuthRefreshGrant,
} from "../../application/mcp_builtin_oauth.js";
import type { RemoteMcpPrincipal } from "../../application/mcp_remote_auth.js";

interface ClientRow {
  clientId: string;
  clientName: string;
  createdAt: string;
  redirectUrisJson: string;
}

interface GrantRow {
  accessMode: McpOAuthRefreshGrant["accessMode"];
  clientId: string;
  familyId: string;
  resource: string;
  scope: string;
  userId: string;
  workspaceId: string;
}

interface ConnectionRow {
  accessMode: McpOAuthConnection["accessMode"];
  actorDisplayName: string;
  actorId: string;
  actorUsername: string;
  clientId: string;
  createdAt: string;
  lastUsedAt: string;
  name: string;
  state: McpOAuthConnection["state"];
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => typeof entry === "string")
  );
}

function oauthClient(row: ClientRow): McpOAuthClient {
  const redirectUris: unknown = JSON.parse(row.redirectUrisJson) as unknown;
  if (!isStringArray(redirectUris)) {
    throw new Error("Stored OAuth redirect URIs are invalid");
  }
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    createdAt: row.createdAt,
    redirectUris,
  };
}

export class SqliteMcpBuiltInOAuthRepository implements McpBuiltInOAuthRepository {
  public constructor(private readonly database: Database.Database) {}

  public createClient(input: {
    clientId: string;
    clientName: string;
    createdAt: string;
    redirectUris: string[];
  }): McpOAuthClient {
    this.database
      .prepare(
        `INSERT INTO mcp_oauth_clients
           (id, name, redirect_uris_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.clientId,
        input.clientName,
        JSON.stringify(input.redirectUris),
        input.createdAt,
      );
    const client = this.findClient(input.clientId);
    if (!client) throw new Error("Created OAuth client is unavailable");
    return client;
  }

  public findClient(clientId: string): McpOAuthClient | undefined {
    const row = this.database
      .prepare(
        `SELECT id AS clientId,
                name AS clientName,
                redirect_uris_json AS redirectUrisJson,
                created_at AS createdAt
         FROM mcp_oauth_clients
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .get(clientId) as ClientRow | undefined;
    return row ? oauthClient(row) : undefined;
  }

  public deleteConnection(input: {
    actorUserId: string;
    clientId: string;
    workspaceId: string;
  }): boolean {
    const remove = this.database.transaction(() => {
      const exists = this.database
        .prepare(
          `SELECT 1
           FROM mcp_oauth_tokens
           WHERE client_id = ? AND user_id = ? AND workspace_id = ?
           LIMIT 1`,
        )
        .get(input.clientId, input.actorUserId, input.workspaceId);
      if (!exists) return false;

      this.database
        .prepare(
          `DELETE FROM mcp_oauth_authorization_codes
           WHERE client_id = ? AND user_id = ? AND workspace_id = ?`,
        )
        .run(input.clientId, input.actorUserId, input.workspaceId);
      this.database
        .prepare(
          `DELETE FROM mcp_oauth_tokens
           WHERE client_id = ? AND user_id = ? AND workspace_id = ?`,
        )
        .run(input.clientId, input.actorUserId, input.workspaceId);
      this.database
        .prepare(
          `DELETE FROM mcp_oauth_clients
           WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM mcp_oauth_tokens WHERE client_id = ?
             )
             AND NOT EXISTS (
               SELECT 1
               FROM mcp_oauth_authorization_codes
               WHERE client_id = ?
             )`,
        )
        .run(input.clientId, input.clientId, input.clientId);
      return true;
    });
    return remove.immediate();
  }

  public listConnections(input: {
    now: string;
    workspaceId: string;
  }): McpOAuthConnection[] {
    const rows = this.database
      .prepare(
        `SELECT tokens.access_mode AS accessMode,
                users.display_name AS actorDisplayName,
                users.id AS actorId,
                users.username AS actorUsername,
                clients.id AS clientId,
                clients.created_at AS createdAt,
                tokens.issued_at AS lastUsedAt,
                clients.name,
                CASE
                  WHEN clients.revoked_at IS NULL
                   AND tokens.revoked_at IS NULL
                   AND tokens.expires_at > ?
                  THEN 'active'
                  ELSE 'revoked'
                END AS state
         FROM mcp_oauth_tokens AS tokens
         JOIN mcp_oauth_clients AS clients ON clients.id = tokens.client_id
         JOIN users ON users.id = tokens.user_id
         WHERE tokens.workspace_id = ?
           AND tokens.token_kind = 'refresh'
           AND tokens.id = (
             SELECT candidate.id
             FROM mcp_oauth_tokens AS candidate
             WHERE candidate.client_id = tokens.client_id
               AND candidate.user_id = tokens.user_id
               AND candidate.workspace_id = tokens.workspace_id
               AND candidate.token_kind = 'refresh'
             ORDER BY candidate.issued_at DESC, candidate.id DESC
             LIMIT 1
           )
         ORDER BY tokens.issued_at DESC, clients.id DESC`,
      )
      .all(input.now, input.workspaceId) as ConnectionRow[];
    return rows.map((row) => ({
      accessMode: row.accessMode,
      actor: {
        displayName: row.actorDisplayName,
        id: row.actorId,
        username: row.actorUsername,
      },
      clientId: row.clientId,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      name: row.name,
      state: row.state,
    }));
  }

  public createAuthorizationCode(
    record: McpOAuthAuthorizationCodeRecord,
  ): void {
    this.database
      .prepare(
        `INSERT INTO mcp_oauth_authorization_codes
           (code_hash, client_id, user_id, workspace_id, redirect_uri,
            code_challenge, resource, scope, access_mode, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.codeHash,
        record.clientId,
        record.userId,
        record.workspaceId,
        record.redirectUri,
        record.codeChallenge,
        record.resource,
        record.scope,
        record.accessMode,
        record.createdAt,
        record.expiresAt,
      );
  }

  public challengeForAuthorizationCode(input: {
    clientId: string;
    codeHash: string;
    now: string;
  }): string | undefined {
    return this.database
      .prepare(
        `SELECT code_challenge
         FROM mcp_oauth_authorization_codes
         WHERE code_hash = ?
           AND client_id = ?
           AND used_at IS NULL
           AND expires_at > ?`,
      )
      .pluck()
      .get(input.codeHash, input.clientId, input.now) as string | undefined;
  }

  public consumeAuthorizationCode(input: {
    access: McpOAuthIssuedTokenRecord;
    clientId: string;
    codeHash: string;
    now: string;
    redirectUri: string;
    refresh: McpOAuthIssuedTokenRecord;
    resource: string;
  }): boolean {
    const consume = this.database.transaction(() => {
      const grant = this.database
        .prepare(
          `SELECT client_id AS clientId,
                  user_id AS userId,
                  workspace_id AS workspaceId,
                  resource,
                  scope,
                  access_mode AS accessMode
           FROM mcp_oauth_authorization_codes
           WHERE code_hash = ?
             AND client_id = ?
             AND redirect_uri = ?
             AND resource = ?
             AND used_at IS NULL
             AND expires_at > ?`,
        )
        .get(
          input.codeHash,
          input.clientId,
          input.redirectUri,
          input.resource,
          input.now,
        ) as Omit<GrantRow, "familyId"> | undefined;
      if (!grant) return false;
      const claimed = this.database
        .prepare(
          `UPDATE mcp_oauth_authorization_codes
           SET used_at = ?
           WHERE code_hash = ? AND used_at IS NULL`,
        )
        .run(input.now, input.codeHash);
      if (claimed.changes !== 1) return false;

      this.insertToken({
        ...input.access,
        accessMode: grant.accessMode,
        scope: grant.scope,
        userId: grant.userId,
        workspaceId: grant.workspaceId,
      });
      this.insertToken({
        ...input.refresh,
        accessMode: grant.accessMode,
        scope: grant.scope,
        userId: grant.userId,
        workspaceId: grant.workspaceId,
      });
      this.database
        .prepare("UPDATE mcp_oauth_clients SET last_used_at = ? WHERE id = ?")
        .run(input.now, input.clientId);
      return true;
    });
    return consume.immediate();
  }

  public findRefreshGrant(input: {
    clientId: string;
    now: string;
    refreshTokenHash: string;
  }): McpOAuthRefreshGrant | undefined {
    return this.database
      .prepare(
        `SELECT tokens.client_id AS clientId,
                tokens.family_id AS familyId,
                tokens.user_id AS userId,
                tokens.workspace_id AS workspaceId,
                tokens.resource,
                tokens.scope,
                tokens.access_mode AS accessMode
         FROM mcp_oauth_tokens AS tokens
         JOIN mcp_oauth_clients AS clients ON clients.id = tokens.client_id
         JOIN users ON users.id = tokens.user_id
         JOIN workspace_memberships
           ON workspace_memberships.workspace_id = tokens.workspace_id
          AND workspace_memberships.user_id = tokens.user_id
         WHERE tokens.token_hash = ?
           AND tokens.token_kind = 'refresh'
           AND tokens.client_id = ?
           AND tokens.revoked_at IS NULL
           AND tokens.expires_at > ?
           AND clients.revoked_at IS NULL
           AND users.status = 'active'`,
      )
      .get(input.refreshTokenHash, input.clientId, input.now) as
      McpOAuthRefreshGrant | undefined;
  }

  public consumeRefreshToken(input: {
    access: McpOAuthIssuedTokenRecord;
    clientId: string;
    now: string;
    refresh: McpOAuthIssuedTokenRecord;
    refreshTokenHash: string;
    resource: string;
  }): boolean {
    const consume = this.database.transaction(() => {
      const grant = this.findRefreshGrant({
        clientId: input.clientId,
        now: input.now,
        refreshTokenHash: input.refreshTokenHash,
      });
      if (!grant || grant.resource !== input.resource) return false;
      const claimed = this.database
        .prepare(
          `UPDATE mcp_oauth_tokens
           SET revoked_at = ?
           WHERE token_hash = ? AND token_kind = 'refresh' AND revoked_at IS NULL`,
        )
        .run(input.now, input.refreshTokenHash);
      if (claimed.changes !== 1) return false;
      this.insertToken({ ...input.access, ...grant });
      this.insertToken({ ...input.refresh, ...grant });
      return true;
    });
    return consume.immediate();
  }

  public findActiveAccessToken(input: {
    now: string;
    tokenHash: string;
  }): RemoteMcpPrincipal | undefined {
    const row = this.database
      .prepare(
        `SELECT users.id AS userId,
                users.username,
                users.display_name AS displayName,
                workspace_memberships.role,
                workspaces.id AS workspaceId,
                workspaces.name AS workspaceName,
                workspaces.slug AS workspaceSlug,
                tokens.client_id AS clientId,
                tokens.family_id AS familyId,
                tokens.access_mode AS accessMode
         FROM mcp_oauth_tokens AS tokens
         JOIN mcp_oauth_clients AS clients ON clients.id = tokens.client_id
         JOIN users ON users.id = tokens.user_id
         JOIN workspace_memberships
           ON workspace_memberships.workspace_id = tokens.workspace_id
          AND workspace_memberships.user_id = tokens.user_id
         JOIN workspaces ON workspaces.id = tokens.workspace_id
         WHERE tokens.token_hash = ?
           AND tokens.token_kind = 'access'
           AND tokens.revoked_at IS NULL
           AND tokens.expires_at > ?
           AND clients.revoked_at IS NULL
           AND users.status = 'active'`,
      )
      .get(input.tokenHash, input.now) as
      | {
          clientId: string;
          accessMode: McpOAuthRefreshGrant["accessMode"];
          displayName: string;
          familyId: string;
          role: "admin" | "member";
          userId: string;
          username: string;
          workspaceId: string;
          workspaceName: string;
          workspaceSlug: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      accessMode: row.accessMode,
      actor: {
        authenticated: true,
        user: {
          displayName: row.displayName,
          role: row.role,
          username: row.username,
        },
        userId: row.userId,
        workspace: { name: row.workspaceName },
        workspaceId: row.workspaceId,
      },
      principalId: `oauth:${row.clientId}:${row.familyId}`,
      workspaceSlug: row.workspaceSlug,
    };
  }

  public revokeToken(input: {
    clientId: string;
    revokedAt: string;
    tokenHash: string;
  }): void {
    const familyId = this.database
      .prepare(
        `SELECT family_id
         FROM mcp_oauth_tokens
         WHERE token_hash = ? AND client_id = ?`,
      )
      .pluck()
      .get(input.tokenHash, input.clientId) as string | undefined;
    if (!familyId) return;
    this.database
      .prepare(
        `UPDATE mcp_oauth_tokens
         SET revoked_at = coalesce(revoked_at, ?)
         WHERE family_id = ? AND client_id = ?`,
      )
      .run(input.revokedAt, familyId, input.clientId);
  }

  private insertToken(record: McpOAuthIssuedTokenRecord): void {
    this.database
      .prepare(
        `INSERT INTO mcp_oauth_tokens
           (id, token_hash, token_kind, family_id, client_id, user_id,
            workspace_id, resource, scope, access_mode, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.tokenHash,
        record.tokenKind,
        record.familyId,
        record.clientId,
        record.userId,
        record.workspaceId,
        record.resource,
        record.scope,
        record.accessMode,
        record.issuedAt,
        record.expiresAt,
      );
  }
}
