import type { Migration } from "../migrations.js";

export const mcpClientsMigration: Migration = {
  name: "mcp_clients",
  version: 15,
  sql: `
    CREATE TABLE mcp_clients (
      id TEXT PRIMARY KEY CHECK (
        length(id) = 30
        AND substr(id, 1, 6) = 'atmcp_'
        AND substr(id, 7) NOT GLOB '*[^A-Za-z0-9_-]*'
      ),
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
      token_hash TEXT NOT NULL UNIQUE CHECK (
        length(token_hash) = 64
        AND token_hash NOT GLOB '*[^0-9a-f]*'
      ),
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      rotated_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      revoked_by_user_id TEXT,
      CHECK (
        (revoked_at IS NULL AND revoked_by_user_id IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
      ),
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, created_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, revoked_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX mcp_clients_by_workspace
      ON mcp_clients (workspace_id, revoked_at, created_at, id);
  `,
};
