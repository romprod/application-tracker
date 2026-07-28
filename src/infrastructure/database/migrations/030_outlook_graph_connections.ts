import type { Migration } from "../migrations.js";

export const outlookGraphConnectionsMigration: Migration = {
  name: "outlook_graph_connections",
  version: 30,
  sql: `
    CREATE TABLE outlook_graph_connections (
      workspace_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL CHECK (length(tenant_id) = 36),
      client_id TEXT NOT NULL CHECK (length(client_id) = 36),
      client_secret_encrypted TEXT NOT NULL
        CHECK (length(client_secret_encrypted) BETWEEN 32 AND 8192),
      mailbox TEXT NOT NULL CHECK (length(mailbox) BETWEEN 3 AND 254),
      folder_path TEXT NOT NULL CHECK (length(folder_path) BETWEEN 3 AND 649),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      verified_at TEXT NOT NULL,
      last_tested_at TEXT NOT NULL,
      last_error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by_user_id TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, updated_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX outlook_graph_connections_by_state
      ON outlook_graph_connections
        (workspace_id, enabled);
  `,
};
