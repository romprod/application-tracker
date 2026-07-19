import type { Migration } from "../migrations.js";

export const mcpWorkspaceSettingsMigration: Migration = {
  name: "mcp_workspace_settings",
  version: 13,
  sql: `
    CREATE TABLE mcp_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      access_mode TEXT NOT NULL DEFAULT 'read_only'
        CHECK (access_mode IN ('read_only', 'read_write')),
      updated_by_user_id TEXT,
      updated_at TEXT,
      CHECK (
        (updated_by_user_id IS NULL AND updated_at IS NULL) OR
        (updated_by_user_id IS NOT NULL AND updated_at IS NOT NULL)
      ),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, updated_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;
  `,
};
