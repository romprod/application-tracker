import type { Migration } from "../migrations.js";

export const mcpConnectionAccessMigration: Migration = {
  name: "mcp_connection_access",
  version: 18,
  sql: `
    ALTER TABLE mcp_clients
      ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'read_only'
        CHECK (access_mode IN ('read_only', 'read_write'));

    ALTER TABLE mcp_oauth_authorization_codes
      ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'read_only'
        CHECK (access_mode IN ('read_only', 'read_write'));

    ALTER TABLE mcp_oauth_tokens
      ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'read_only'
        CHECK (access_mode IN ('read_only', 'read_write'));

    UPDATE mcp_clients
    SET access_mode = coalesce(
      (SELECT settings.access_mode
       FROM mcp_workspace_settings AS settings
       WHERE settings.workspace_id = mcp_clients.workspace_id),
      'read_only'
    );

    UPDATE mcp_oauth_authorization_codes
    SET access_mode = coalesce(
      (SELECT settings.access_mode
       FROM mcp_workspace_settings AS settings
       WHERE settings.workspace_id = mcp_oauth_authorization_codes.workspace_id),
      'read_only'
    );

    UPDATE mcp_oauth_tokens
    SET access_mode = coalesce(
      (SELECT settings.access_mode
       FROM mcp_workspace_settings AS settings
       WHERE settings.workspace_id = mcp_oauth_tokens.workspace_id),
      'read_only'
    );
  `,
};
