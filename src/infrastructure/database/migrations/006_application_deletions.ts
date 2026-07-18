import type { Migration } from "../migrations.js";

export const applicationDeletionsMigration: Migration = {
  name: "application_deletions",
  version: 6,
  sql: `
    ALTER TABLE applications ADD COLUMN deleted_at TEXT
      CHECK (deleted_at IS NULL OR length(trim(deleted_at)) > 0);

    CREATE TABLE application_deletions (
      application_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL CHECK (length(trim(deleted_at)) > 0),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_deletions_by_workspace_time
      ON application_deletions (
        workspace_id,
        deleted_at DESC,
        application_id
      );

    CREATE INDEX applications_active_by_workspace_updated
      ON applications (workspace_id, updated_at DESC, id DESC)
      WHERE deleted_at IS NULL;

    DROP INDEX applications_by_workspace_next_action_due;

    CREATE INDEX applications_by_workspace_next_action_due
      ON applications (workspace_id, next_action_due, id)
      WHERE next_action IS NOT NULL AND status <> 'closed'
        AND deleted_at IS NULL;
  `,
};
