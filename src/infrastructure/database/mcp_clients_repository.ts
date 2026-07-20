import type Database from "better-sqlite3";

import type { AuthenticatedActor } from "../../application/auth.js";
import {
  McpClientActorUnavailableError,
  McpClientNotFoundError,
  type CreateMcpClientRecord,
  type McpClient,
  type McpClientActor,
  type McpClientCredentialRecord,
  type McpClientsRepository,
} from "../../application/mcp_clients.js";

interface McpClientRow {
  accessMode: McpClient["accessMode"];
  actorDisplayName: string;
  actorId: string;
  actorUsername: string;
  clientId: string;
  createdAt: string;
  lastUsedAt: string | null;
  name: string;
  rotatedAt: string | null;
  state: McpClient["state"];
}

interface McpClientCredentialRow {
  accessMode: McpClient["accessMode"];
  actorDisplayName: string;
  actorRole: "admin" | "member";
  actorUsername: string;
  actorUserId: string;
  clientId: string;
  tokenHash: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
}

function client(row: McpClientRow): McpClient {
  return {
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
    rotatedAt: row.rotatedAt,
    state: row.state,
  };
}

const clientSelect = `
  SELECT
    mcp_clients.id AS clientId,
    mcp_clients.access_mode AS accessMode,
    mcp_clients.name,
    mcp_clients.created_at AS createdAt,
    mcp_clients.rotated_at AS rotatedAt,
    mcp_clients.last_used_at AS lastUsedAt,
    users.id AS actorId,
    users.username AS actorUsername,
    users.display_name AS actorDisplayName,
    CASE
      WHEN mcp_clients.revoked_at IS NOT NULL THEN 'revoked'
      WHEN users.status != 'active' THEN 'unavailable'
      ELSE 'active'
    END AS state
  FROM mcp_clients
  JOIN users ON users.id = mcp_clients.actor_user_id
`;

export class SqliteMcpClientsRepository implements McpClientsRepository {
  public constructor(private readonly database: Database.Database) {}

  public countActive(workspaceId: string): number {
    const row = this.database
      .prepare(
        `SELECT count(*) AS count
         FROM mcp_clients
         WHERE workspace_id = ? AND revoked_at IS NULL`,
      )
      .get(workspaceId) as { count: number };
    return row.count;
  }

  public create(input: CreateMcpClientRecord): McpClient {
    const create = this.database.transaction(() => {
      const actor = this.database
        .prepare(
          `SELECT 1
           FROM workspace_memberships
           JOIN users ON users.id = workspace_memberships.user_id
           WHERE workspace_memberships.workspace_id = ?
             AND workspace_memberships.user_id = ?
             AND users.status = 'active'`,
        )
        .get(input.workspaceId, input.actorUserId);
      if (!actor) throw new McpClientActorUnavailableError();
      this.database
        .prepare(
          `INSERT INTO mcp_clients
             (id, workspace_id, actor_user_id, name, access_mode, token_hash,
              created_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.clientId,
          input.workspaceId,
          input.actorUserId,
          input.name,
          input.accessMode,
          input.tokenHash,
          input.createdByUserId,
          input.createdAt,
        );
      return this.findClient(input.workspaceId, input.clientId);
    });
    return create.immediate();
  }

  public delete(input: { clientId: string; workspaceId: string }): void {
    const remove = this.database.transaction(() => {
      const record = this.database
        .prepare(
          `SELECT 1
           FROM mcp_clients
           WHERE id = ? AND workspace_id = ?`,
        )
        .get(input.clientId, input.workspaceId);
      if (!record) throw new McpClientNotFoundError();

      const result = this.database
        .prepare(
          `DELETE FROM mcp_clients
           WHERE id = ? AND workspace_id = ?`,
        )
        .run(input.clientId, input.workspaceId);
      if (result.changes !== 1) throw new McpClientNotFoundError();
    });
    remove.immediate();
  }

  public findCredential(
    clientId: string,
  ): McpClientCredentialRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT
           mcp_clients.id AS clientId,
           mcp_clients.access_mode AS accessMode,
           mcp_clients.token_hash AS tokenHash,
           users.id AS actorUserId,
           users.username AS actorUsername,
           users.display_name AS actorDisplayName,
           workspace_memberships.role AS actorRole,
           workspaces.id AS workspaceId,
           workspaces.name AS workspaceName,
           workspaces.slug AS workspaceSlug
         FROM mcp_clients
         JOIN users ON users.id = mcp_clients.actor_user_id
         JOIN workspace_memberships
           ON workspace_memberships.workspace_id = mcp_clients.workspace_id
          AND workspace_memberships.user_id = users.id
         JOIN workspaces ON workspaces.id = mcp_clients.workspace_id
         WHERE mcp_clients.id = ?
           AND mcp_clients.revoked_at IS NULL
           AND users.status = 'active'`,
      )
      .get(clientId) as McpClientCredentialRow | undefined;
    if (!row) return undefined;
    const actor: AuthenticatedActor = {
      authenticated: true,
      user: {
        displayName: row.actorDisplayName,
        role: row.actorRole,
        username: row.actorUsername,
      },
      userId: row.actorUserId,
      workspace: { name: row.workspaceName },
      workspaceId: row.workspaceId,
    };
    return {
      accessMode: row.accessMode,
      actor,
      clientId: row.clientId,
      tokenHash: row.tokenHash,
      workspaceSlug: row.workspaceSlug,
    };
  }

  public listActors(workspaceId: string): McpClientActor[] {
    return this.database
      .prepare(
        `SELECT
           users.id,
           users.username,
           users.display_name AS displayName
         FROM workspace_memberships
         JOIN users ON users.id = workspace_memberships.user_id
         WHERE workspace_memberships.workspace_id = ?
           AND users.status = 'active'
         ORDER BY users.display_name COLLATE NOCASE, users.username COLLATE NOCASE`,
      )
      .all(workspaceId) as McpClientActor[];
  }

  public listClients(workspaceId: string): McpClient[] {
    const rows = this.database
      .prepare(
        `${clientSelect}
         WHERE mcp_clients.workspace_id = ?
         ORDER BY mcp_clients.created_at DESC, mcp_clients.id DESC`,
      )
      .all(workspaceId) as McpClientRow[];
    return rows.map(client);
  }

  public markUsed(clientId: string, usedAt: string): void {
    this.database
      .prepare(
        `UPDATE mcp_clients SET last_used_at = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(usedAt, clientId);
  }

  public revoke(input: {
    clientId: string;
    revokedAt: string;
    revokedByUserId: string;
    workspaceId: string;
  }): McpClient {
    const result = this.database
      .prepare(
        `UPDATE mcp_clients
         SET revoked_at = ?, revoked_by_user_id = ?
         WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
      )
      .run(
        input.revokedAt,
        input.revokedByUserId,
        input.clientId,
        input.workspaceId,
      );
    if (result.changes !== 1) throw new McpClientNotFoundError();
    return this.findClient(input.workspaceId, input.clientId);
  }

  public rotate(input: {
    clientId: string;
    rotatedAt: string;
    tokenHash: string;
    workspaceId: string;
  }): McpClient {
    const result = this.database
      .prepare(
        `UPDATE mcp_clients
         SET token_hash = ?,
             rotated_at = ?,
             last_used_at = NULL,
             revoked_at = NULL,
             revoked_by_user_id = NULL
         WHERE id = ? AND workspace_id = ?`,
      )
      .run(input.tokenHash, input.rotatedAt, input.clientId, input.workspaceId);
    if (result.changes !== 1) throw new McpClientNotFoundError();
    return this.findClient(input.workspaceId, input.clientId);
  }

  public updateAccessMode(input: {
    accessMode: McpClient["accessMode"];
    clientId: string;
    workspaceId: string;
  }): McpClient {
    const result = this.database
      .prepare(
        `UPDATE mcp_clients
         SET access_mode = ?
         WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
      )
      .run(input.accessMode, input.clientId, input.workspaceId);
    if (result.changes !== 1) throw new McpClientNotFoundError();
    return this.findClient(input.workspaceId, input.clientId);
  }

  private findClient(workspaceId: string, clientId: string): McpClient {
    const row = this.database
      .prepare(
        `${clientSelect}
         WHERE mcp_clients.workspace_id = ? AND mcp_clients.id = ?`,
      )
      .get(workspaceId, clientId) as McpClientRow | undefined;
    if (!row) throw new McpClientNotFoundError();
    return client(row);
  }
}
