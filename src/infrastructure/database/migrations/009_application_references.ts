import type { Migration } from "../migrations.js";

export const applicationReferencesMigration: Migration = {
  name: "application_references",
  version: 9,
  sql: `
    CREATE UNIQUE INDEX reference_values_by_workspace_id
      ON reference_values (workspace_id, id);

    ALTER TABLE applications RENAME COLUMN status TO legacy_status;

    ALTER TABLE applications ADD COLUMN status_reference_id TEXT
      REFERENCES reference_values(id) ON DELETE RESTRICT;
    ALTER TABLE applications ADD COLUMN source_reference_id TEXT
      REFERENCES reference_values(id) ON DELETE RESTRICT;
    ALTER TABLE applications ADD COLUMN role_type_reference_id TEXT
      REFERENCES reference_values(id) ON DELETE RESTRICT;

    INSERT INTO reference_values (
      id, workspace_id, category, label, sort_order, is_active, is_terminal,
      created_at, updated_at
    )
    SELECT
      lower(hex(randomblob(16))), legacy.workspace_id, 'status',
      CASE legacy.legacy_status
        WHEN 'prospect' THEN 'Prospect'
        WHEN 'applied' THEN 'Applied'
        WHEN 'interview' THEN 'Interview'
        WHEN 'offer' THEN 'Offer'
        ELSE 'Closed'
      END,
      CASE legacy.legacy_status
        WHEN 'prospect' THEN 10
        WHEN 'applied' THEN 20
        WHEN 'interview' THEN 30
        WHEN 'offer' THEN 40
        ELSE 50
      END,
      1,
      CASE WHEN legacy.legacy_status = 'closed' THEN 1 ELSE 0 END,
      workspaces.created_at,
      workspaces.created_at
    FROM (
      SELECT DISTINCT workspace_id, legacy_status FROM applications
    ) AS legacy
    JOIN workspaces ON workspaces.id = legacy.workspace_id
    WHERE NOT EXISTS (
      SELECT 1 FROM reference_values
      WHERE reference_values.workspace_id = legacy.workspace_id
        AND reference_values.category = 'status'
        AND (
          lower(reference_values.label) = legacy.legacy_status OR
          reference_values.sort_order = CASE legacy.legacy_status
            WHEN 'prospect' THEN 10
            WHEN 'applied' THEN 20
            WHEN 'interview' THEN 30
            WHEN 'offer' THEN 40
            ELSE 50
          END
        )
    );

    UPDATE applications
    SET status_reference_id = (
      SELECT reference_values.id
      FROM reference_values
      WHERE reference_values.workspace_id = applications.workspace_id
        AND reference_values.category = 'status'
        AND (
          lower(reference_values.label) = applications.legacy_status OR
          reference_values.sort_order = CASE applications.legacy_status
            WHEN 'prospect' THEN 10
            WHEN 'applied' THEN 20
            WHEN 'interview' THEN 30
            WHEN 'offer' THEN 40
            ELSE 50
          END
        )
      ORDER BY CASE WHEN reference_values.sort_order =
        CASE applications.legacy_status
          WHEN 'prospect' THEN 10
          WHEN 'applied' THEN 20
          WHEN 'interview' THEN 30
          WHEN 'offer' THEN 40
          ELSE 50
        END THEN 0 ELSE 1 END
      LIMIT 1
    );

    CREATE TRIGGER applications_validate_references_insert
    BEFORE INSERT ON applications
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.status_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'status'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid application status reference') END;
      SELECT CASE WHEN NEW.source_reference_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.source_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'source'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid application source reference') END;
      SELECT CASE WHEN NEW.role_type_reference_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.role_type_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'role_type'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid application role type reference') END;
    END;

    CREATE TRIGGER applications_validate_status_reference_update
    BEFORE UPDATE OF workspace_id, status_reference_id ON applications
    WHEN NEW.workspace_id IS NOT OLD.workspace_id OR
      NEW.status_reference_id IS NOT OLD.status_reference_id
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.status_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'status'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid application status reference') END;
    END;

    CREATE TRIGGER applications_validate_source_reference_update
    BEFORE UPDATE OF workspace_id, source_reference_id ON applications
    WHEN NEW.workspace_id IS NOT OLD.workspace_id OR
      NEW.source_reference_id IS NOT OLD.source_reference_id
    BEGIN
      SELECT CASE WHEN NEW.source_reference_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.source_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'source'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid application source reference') END;
    END;

    CREATE TRIGGER applications_validate_role_type_reference_update
    BEFORE UPDATE OF workspace_id, role_type_reference_id ON applications
    WHEN NEW.workspace_id IS NOT OLD.workspace_id OR
      NEW.role_type_reference_id IS NOT OLD.role_type_reference_id
    BEGIN
      SELECT CASE WHEN NEW.role_type_reference_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.role_type_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'role_type'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid application role type reference') END;
    END;

    DROP INDEX applications_by_workspace_next_action_due;
    CREATE INDEX applications_by_workspace_next_action_due
      ON applications (workspace_id, next_action_due, id)
      WHERE next_action IS NOT NULL AND deleted_at IS NULL;

    DROP TRIGGER application_events_reject_update;
    DROP TRIGGER application_events_reject_delete;
    DROP INDEX application_events_by_application_time;
    ALTER TABLE application_events RENAME TO application_events_version_eight;

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

    INSERT INTO application_events (
      id, workspace_id, application_id, actor_user_id, event_type,
      from_status, to_status, occurred_at
    )
    SELECT
      id, workspace_id, application_id, actor_user_id, event_type,
      CASE from_status
        WHEN 'prospect' THEN 'Prospect'
        WHEN 'applied' THEN 'Applied'
        WHEN 'interview' THEN 'Interview'
        WHEN 'offer' THEN 'Offer'
        WHEN 'closed' THEN 'Closed'
        ELSE from_status
      END,
      CASE to_status
        WHEN 'prospect' THEN 'Prospect'
        WHEN 'applied' THEN 'Applied'
        WHEN 'interview' THEN 'Interview'
        WHEN 'offer' THEN 'Offer'
        WHEN 'closed' THEN 'Closed'
        ELSE to_status
      END,
      occurred_at
    FROM application_events_version_eight;

    DROP TABLE application_events_version_eight;

    CREATE INDEX application_events_by_application_time
      ON application_events (
        workspace_id,
        application_id,
        occurred_at DESC,
        id DESC
      );

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
