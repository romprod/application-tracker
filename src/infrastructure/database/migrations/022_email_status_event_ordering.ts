import type { Migration } from "../migrations.js";

export const emailStatusEventOrderingMigration: Migration = {
  name: "email_status_event_ordering",
  version: 22,
  sql: `
    DROP TRIGGER application_events_reject_update;
    DROP TRIGGER application_events_reject_delete;
    DROP INDEX application_events_by_application_time;
    ALTER TABLE application_events RENAME TO application_events_version_twenty_one;

    CREATE TABLE application_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('application_created', 'status_changed')),
      from_status TEXT
        CHECK (from_status IS NULL OR length(trim(from_status)) BETWEEN 1 AND 80),
      to_status TEXT NOT NULL
        CHECK (length(trim(to_status)) BETWEEN 1 AND 80),
      occurred_at TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      source_email_message_id TEXT
        CHECK (
          source_email_message_id IS NULL OR
          length(trim(source_email_message_id)) BETWEEN 1 AND 998
        ),
      status_override_reason TEXT
        CHECK (
          status_override_reason IS NULL OR
          length(trim(status_override_reason)) BETWEEN 1 AND 500
        ),
      CHECK (
        (event_type = 'application_created' AND from_status IS NULL) OR
        (event_type = 'status_changed' AND from_status IS NOT NULL AND
          from_status <> to_status)
      ),
      CHECK (
        (source_email_message_id IS NULL AND status_override_reason IS NULL) OR
        event_type = 'status_changed'
      ),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO application_events (
      id, workspace_id, application_id, actor_user_id, event_type,
      from_status, to_status, occurred_at, processed_at,
      source_email_message_id, status_override_reason
    )
    SELECT
      id, workspace_id, application_id, actor_user_id, event_type,
      from_status, to_status, occurred_at, occurred_at, NULL, NULL
    FROM application_events_version_twenty_one;

    DROP TABLE application_events_version_twenty_one;

    CREATE INDEX application_events_by_application_time
      ON application_events (
        workspace_id,
        application_id,
        occurred_at DESC,
        id DESC
      );

    CREATE UNIQUE INDEX application_events_by_source_email
      ON application_events (workspace_id, source_email_message_id)
      WHERE source_email_message_id IS NOT NULL;

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
