import type { Migration } from "../migrations.js";

export const multipleOutlookGraphConnectionsMigration: Migration = {
  name: "multiple_outlook_graph_connections",
  version: 31,
  sql: `
    ALTER TABLE outlook_graph_connections
      RENAME TO outlook_graph_connections_legacy;

    DROP INDEX outlook_graph_connections_by_state;

    CREATE TABLE outlook_graph_connections (
      id TEXT PRIMARY KEY CHECK (length(id) = 36),
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE
        CHECK (length(trim(name)) BETWEEN 1 AND 80),
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
      UNIQUE (workspace_id, id),
      UNIQUE (workspace_id, name),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, updated_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO outlook_graph_connections
      (id, workspace_id, name, tenant_id, client_id,
       client_secret_encrypted, mailbox, folder_path, enabled, verified_at,
       last_tested_at, last_error_code, created_at, updated_at,
       updated_by_user_id)
    SELECT
      lower(
        hex(randomblob(4)) || '-' ||
        hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)), 2) || '-' ||
        substr('89ab', abs(random()) % 4 + 1, 1) ||
        substr(hex(randomblob(2)), 2) || '-' ||
        hex(randomblob(6))
      ),
      workspace_id,
      substr(mailbox, 1, 80),
      tenant_id,
      client_id,
      client_secret_encrypted,
      mailbox,
      folder_path,
      enabled,
      verified_at,
      last_tested_at,
      last_error_code,
      created_at,
      updated_at,
      updated_by_user_id
    FROM outlook_graph_connections_legacy;

    DROP TABLE outlook_graph_connections_legacy;

    CREATE INDEX outlook_graph_connections_by_state
      ON outlook_graph_connections
        (workspace_id, enabled DESC, name COLLATE NOCASE, id);

    CREATE TABLE application_outlook_graph_connections (
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      assigned_by_user_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, application_id),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, connection_id)
        REFERENCES outlook_graph_connections(workspace_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, assigned_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_outlook_graph_connections_by_connection
      ON application_outlook_graph_connections
        (workspace_id, connection_id, application_id);
  `,
};
