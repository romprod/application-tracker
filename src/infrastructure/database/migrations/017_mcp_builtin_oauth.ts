import type { Migration } from "../migrations.js";

export const mcpBuiltInOAuthMigration: Migration = {
  name: "mcp_builtin_oauth",
  version: 17,
  sql: `
    CREATE TABLE mcp_oauth_clients (
      id TEXT PRIMARY KEY CHECK (
        length(id) = 29
        AND substr(id, 1, 5) = 'atoc_'
        AND substr(id, 6) NOT GLOB '*[^A-Za-z0-9_-]*'
      ),
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
      redirect_uris_json TEXT NOT NULL CHECK (
        length(redirect_uris_json) BETWEEN 4 AND 8192
      ),
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    ) STRICT;

    CREATE INDEX mcp_oauth_clients_by_created_at
      ON mcp_oauth_clients (created_at DESC, id DESC);

    CREATE TABLE mcp_oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY CHECK (
        length(code_hash) = 64
        AND code_hash NOT GLOB '*[^0-9a-f]*'
      ),
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL CHECK (length(redirect_uri) BETWEEN 8 AND 2048),
      code_challenge TEXT NOT NULL CHECK (length(code_challenge) BETWEEN 43 AND 128),
      resource TEXT NOT NULL CHECK (length(resource) BETWEEN 8 AND 2048),
      scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 512),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX mcp_oauth_codes_by_expiry
      ON mcp_oauth_authorization_codes (expires_at, used_at);

    CREATE TABLE mcp_oauth_tokens (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      token_hash TEXT NOT NULL UNIQUE CHECK (
        length(token_hash) = 64
        AND token_hash NOT GLOB '*[^0-9a-f]*'
      ),
      token_kind TEXT NOT NULL CHECK (token_kind IN ('access', 'refresh')),
      family_id TEXT NOT NULL CHECK (length(family_id) BETWEEN 8 AND 64),
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      resource TEXT NOT NULL CHECK (length(resource) BETWEEN 8 AND 2048),
      scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 512),
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX mcp_oauth_tokens_by_expiry
      ON mcp_oauth_tokens (expires_at, revoked_at);

    CREATE INDEX mcp_oauth_tokens_by_family
      ON mcp_oauth_tokens (family_id, token_kind, revoked_at);
  `,
};
