import type { Migration } from "../migrations.js";

export const applicationHistoryMigration: Migration = {
  name: "application_history",
  version: 4,
  sql: `
    CREATE UNIQUE INDEX applications_by_workspace_id
      ON applications (workspace_id, id);

    CREATE TABLE application_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('application_created', 'status_changed')),
      from_status TEXT
        CHECK (
          from_status IS NULL OR
          from_status IN ('prospect', 'applied', 'interview', 'offer', 'closed')
        ),
      to_status TEXT NOT NULL
        CHECK (to_status IN ('prospect', 'applied', 'interview', 'offer', 'closed')),
      occurred_at TEXT NOT NULL,
      CHECK (
        (event_type = 'application_created' AND from_status IS NULL) OR
        (event_type = 'status_changed' AND from_status IS NOT NULL AND
          from_status <> to_status)
      ),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_events_by_application_time
      ON application_events (
        workspace_id,
        application_id,
        occurred_at DESC,
        id DESC
      );

    INSERT INTO application_events (
      id,
      workspace_id,
      application_id,
      actor_user_id,
      event_type,
      from_status,
      to_status,
      occurred_at
    )
    SELECT
      id,
      workspace_id,
      id,
      created_by_user_id,
      'application_created',
      NULL,
      status,
      created_at
    FROM applications;

    CREATE TRIGGER application_events_reject_update
    BEFORE UPDATE ON application_events
    BEGIN
      SELECT RAISE(ABORT, 'application events are immutable');
    END;

    CREATE TRIGGER application_events_reject_delete
    BEFORE DELETE ON application_events
    BEGIN
      SELECT RAISE(ABORT, 'application events are immutable');
    END;
  `,
};
