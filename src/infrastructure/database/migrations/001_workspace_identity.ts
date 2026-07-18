import type { Migration } from "../migrations.js";

export const workspaceIdentityMigration: Migration = {
  name: "workspace_identity",
  version: 1,
  sql: `
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      slug TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(slug) BETWEEN 1 AND 80),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE users (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      username TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(trim(username)) BETWEEN 3 AND 64),
      display_name TEXT NOT NULL
        CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE local_credentials (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL CHECK (length(password_hash) >= 32),
      password_version INTEGER NOT NULL DEFAULT 1
        CHECK (password_version > 0),
      password_changed_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE workspace_memberships (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX workspace_memberships_by_user
      ON workspace_memberships (user_id, workspace_id);

    CREATE TABLE external_identities (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      user_id TEXT NOT NULL,
      issuer TEXT NOT NULL CHECK (length(trim(issuer)) > 0),
      subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      UNIQUE (issuer, subject),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX external_identities_by_user
      ON external_identities (user_id);

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      idle_expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      revoked_at TEXT,
      CHECK (idle_expires_at > created_at),
      CHECK (absolute_expires_at > created_at),
      FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX sessions_by_user
      ON sessions (user_id, revoked_at, absolute_expires_at);

    CREATE INDEX sessions_by_expiry
      ON sessions (absolute_expires_at, idle_expires_at)
      WHERE revoked_at IS NULL;
  `,
};
