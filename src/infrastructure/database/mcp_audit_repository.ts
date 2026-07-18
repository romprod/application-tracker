import type Database from "better-sqlite3";

import type {
  McpAuditEvent,
  McpAuditRepository,
  StoredMcpAuditEvent,
} from "../../application/mcp_audit.js";

interface StoredAuditResult {
  action: McpAuditEvent["action"];
  actorDisplayName: string;
  actorUsername: string;
  occurredAt: string;
  result: McpAuditEvent["result"];
  targetType: McpAuditEvent["targetType"];
  transport: McpAuditEvent["transport"];
}

export class SqliteMcpAuditRepository implements McpAuditRepository {
  public constructor(private readonly database: Database.Database) {}

  public append(event: StoredMcpAuditEvent): void {
    this.database
      .prepare(
        `INSERT INTO mcp_audit_events
           (id, workspace_id, actor_user_id, transport, action, target_type,
            result, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.workspaceId,
        event.actorUserId,
        event.transport,
        event.action,
        event.targetType,
        event.result,
        event.occurredAt,
      );
  }

  public listRecent(workspaceId: string, limit: number): McpAuditEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("MCP audit limit must be between 1 and 100");
    }
    const stored = this.database
      .prepare(
        `SELECT events.action,
                users.display_name AS actorDisplayName,
                users.username AS actorUsername,
                events.occurred_at AS occurredAt,
                events.result,
                events.target_type AS targetType,
                events.transport
         FROM mcp_audit_events AS events
         JOIN users ON users.id = events.actor_user_id
         WHERE events.workspace_id = ?
         ORDER BY events.occurred_at DESC, events.id DESC
         LIMIT ?`,
      )
      .all(workspaceId, limit) as StoredAuditResult[];

    return stored.map((event) => ({
      action: event.action,
      actor: {
        displayName: event.actorDisplayName,
        username: event.actorUsername,
      },
      occurredAt: event.occurredAt,
      result: event.result,
      targetType: event.targetType,
      transport: event.transport,
    }));
  }
}
