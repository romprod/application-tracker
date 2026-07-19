import type Database from "better-sqlite3";

import type {
  McpAccessMode,
  McpAccessRepository,
} from "../../application/mcp_access.js";

interface StoredMcpWorkspaceSettings {
  accessMode: McpAccessMode;
}

export class SqliteMcpAccessRepository implements McpAccessRepository {
  public constructor(private readonly database: Database.Database) {}

  public getAccessMode(workspaceId: string): McpAccessMode {
    const stored = this.database
      .prepare(
        `SELECT access_mode AS accessMode
         FROM mcp_workspace_settings
         WHERE workspace_id = ?`,
      )
      .get(workspaceId) as StoredMcpWorkspaceSettings | undefined;
    return stored?.accessMode ?? "read_only";
  }

  public setAccessMode(input: {
    accessMode: McpAccessMode;
    updatedAt: string;
    updatedByUserId: string;
    workspaceId: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO mcp_workspace_settings
           (workspace_id, access_mode, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (workspace_id) DO UPDATE SET
           access_mode = excluded.access_mode,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.workspaceId,
        input.accessMode,
        input.updatedByUserId,
        input.updatedAt,
      );
  }
}
