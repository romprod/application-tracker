import type { Migration } from "../migrations.js";

export const installationStateMigration: Migration = {
  name: "installation_state",
  version: 2,
  sql: `
    CREATE TABLE installation_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      setup_completed_at TEXT,
      initial_admin_user_id TEXT UNIQUE,
      FOREIGN KEY (initial_admin_user_id) REFERENCES users(id)
    ) STRICT;

    INSERT INTO installation_state (id, setup_completed_at, initial_admin_user_id)
    VALUES (1, NULL, NULL);
  `,
};
