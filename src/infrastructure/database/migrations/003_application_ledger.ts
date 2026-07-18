import type { Migration } from "../migrations.js";

export const applicationLedgerMigration: Migration = {
  name: "application_ledger",
  version: 3,
  sql: `
    CREATE TABLE applications (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      company_name TEXT NOT NULL
        CHECK (length(trim(company_name)) BETWEEN 1 AND 160),
      role_title TEXT NOT NULL
        CHECK (length(trim(role_title)) BETWEEN 1 AND 160),
      status TEXT NOT NULL DEFAULT 'prospect'
        CHECK (status IN ('prospect', 'applied', 'interview', 'offer', 'closed')),
      location TEXT
        CHECK (location IS NULL OR length(trim(location)) BETWEEN 1 AND 160),
      source_url TEXT
        CHECK (source_url IS NULL OR length(source_url) BETWEEN 1 AND 2048),
      applied_on TEXT
        CHECK (
          applied_on IS NULL OR (
            length(applied_on) = 10 AND
            applied_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          )
        ),
      notes TEXT
        CHECK (notes IS NULL OR length(trim(notes)) BETWEEN 1 AND 5000),
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (updated_at >= created_at),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, created_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX applications_by_workspace_updated
      ON applications (workspace_id, updated_at DESC, id DESC);
  `,
};
