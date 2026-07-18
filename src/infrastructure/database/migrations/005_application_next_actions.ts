import type { Migration } from "../migrations.js";

export const applicationNextActionsMigration: Migration = {
  name: "application_next_actions",
  version: 5,
  sql: `
    ALTER TABLE applications ADD COLUMN next_action TEXT
      CHECK (
        next_action IS NULL OR
        length(trim(next_action)) BETWEEN 1 AND 500
      );

    ALTER TABLE applications ADD COLUMN next_action_due TEXT
      CHECK (
        next_action_due IS NULL OR (
          length(next_action_due) = 10 AND
          next_action_due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        )
      );

    CREATE INDEX applications_by_workspace_next_action_due
      ON applications (workspace_id, next_action_due, id)
      WHERE next_action IS NOT NULL AND status <> 'closed';
  `,
};
