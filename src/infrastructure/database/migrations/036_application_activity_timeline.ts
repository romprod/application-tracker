import type { Migration } from "../migrations.js";

export const applicationActivityTimelineMigration: Migration = {
  name: "application_activity_timeline",
  version: 36,
  sql: `
    CREATE UNIQUE INDEX application_email_evidence_by_application_id
      ON application_email_evidence (workspace_id, application_id, id);

    DROP TRIGGER application_events_reject_update;
    DROP TRIGGER application_events_reject_delete;
    DROP INDEX application_events_by_application_time;
    DROP INDEX application_events_by_source_email;
    ALTER TABLE application_events RENAME TO application_events_version_thirty_five;

    CREATE TABLE application_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'application_created',
        'status_changed',
        'recruiter_contact',
        'recruiter_screen',
        'interview_scheduled',
        'interview_completed',
        'follow_up_sent',
        'salary_discussion',
        'offer',
        'rejection',
        'withdrawal',
        'role_closed',
        'note',
        'other'
      )),
      from_status TEXT
        CHECK (from_status IS NULL OR length(trim(from_status)) BETWEEN 1 AND 80),
      to_status TEXT
        CHECK (to_status IS NULL OR length(trim(to_status)) BETWEEN 1 AND 80),
      occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
      processed_at TEXT NOT NULL CHECK (length(trim(processed_at)) > 0),
      summary TEXT
        CHECK (summary IS NULL OR length(trim(summary)) BETWEEN 1 AND 1000),
      source_email_evidence_id TEXT,
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
      idempotency_key TEXT
        CHECK (
          idempotency_key IS NULL OR
          length(trim(idempotency_key)) BETWEEN 1 AND 200
        ),
      supersedes_event_id TEXT,
      correction_reason TEXT
        CHECK (
          correction_reason IS NULL OR
          length(trim(correction_reason)) BETWEEN 1 AND 500
        ),
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      CHECK (
        (event_type = 'application_created' AND from_status IS NULL AND
          to_status IS NOT NULL AND summary IS NULL) OR
        (event_type = 'status_changed' AND from_status IS NOT NULL AND
          to_status IS NOT NULL AND from_status <> to_status AND
          summary IS NULL) OR
        (event_type NOT IN ('application_created', 'status_changed') AND
          from_status IS NULL AND to_status IS NULL AND summary IS NOT NULL)
      ),
      CHECK (
        status_override_reason IS NULL OR event_type = 'status_changed'
      ),
      CHECK (
        source_email_evidence_id IS NULL OR
        event_type NOT IN ('application_created', 'status_changed')
      ),
      CHECK (
        idempotency_key IS NULL OR
        event_type NOT IN ('application_created', 'status_changed')
      ),
      CHECK (
        (supersedes_event_id IS NULL AND correction_reason IS NULL) OR
        (supersedes_event_id IS NOT NULL AND correction_reason IS NOT NULL AND
          event_type NOT IN ('application_created', 'status_changed'))
      ),
      UNIQUE (workspace_id, application_id, sequence),
      UNIQUE (workspace_id, application_id, id),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (
        workspace_id,
        application_id,
        source_email_evidence_id
      ) REFERENCES application_email_evidence(
        workspace_id,
        application_id,
        id
      )
        ON DELETE RESTRICT,
      FOREIGN KEY (
        workspace_id,
        application_id,
        supersedes_event_id
      ) REFERENCES application_events(
        workspace_id,
        application_id,
        id
      )
        ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO application_events (
      id, workspace_id, application_id, actor_user_id, event_type,
      from_status, to_status, occurred_at, processed_at, summary,
      source_email_evidence_id, source_email_message_id,
      status_override_reason, idempotency_key, supersedes_event_id,
      correction_reason, sequence
    )
    SELECT
      id, workspace_id, application_id, actor_user_id, event_type,
      from_status, to_status, occurred_at, processed_at, NULL, NULL,
      source_email_message_id, status_override_reason, NULL, NULL, NULL, rowid
    FROM application_events_version_thirty_five
    ORDER BY rowid;

    DROP TABLE application_events_version_thirty_five;

    CREATE INDEX application_events_by_application_time
      ON application_events (
        workspace_id,
        application_id,
        occurred_at DESC,
        sequence DESC
      );

    CREATE UNIQUE INDEX application_events_by_source_email
      ON application_events (workspace_id, source_email_message_id)
      WHERE source_email_message_id IS NOT NULL
        AND event_type = 'status_changed';

    CREATE UNIQUE INDEX application_events_by_idempotency_key
      ON application_events (workspace_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE UNIQUE INDEX application_events_by_superseded_event
      ON application_events (workspace_id, supersedes_event_id)
      WHERE supersedes_event_id IS NOT NULL;

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

    DROP TRIGGER mcp_audit_events_reject_update;
    DROP TRIGGER mcp_audit_events_reject_delete;
    DROP INDEX mcp_audit_events_by_workspace_time;
    ALTER TABLE mcp_audit_events RENAME TO mcp_audit_events_version_thirty_five;

    CREATE TABLE mcp_audit_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      transport TEXT NOT NULL
        CHECK (transport IN ('local_stdio', 'remote_http')),
      action TEXT NOT NULL CHECK (action IN (
        'get_tracker_context',
        'get_connector_schema_status',
        'get_job_search_summary',
        'list_applications',
        'get_application',
        'list_application_events',
        'list_unlinked_applications',
        'get_application_data_quality',
        'audit_duplicate_applications',
        'find_duplicate_applications',
        'merge_applications',
        'match_job_application_email',
        'link_email_evidence',
        'reconcile_application_from_evidence',
        'sync_outlook_email_evidence',
        'reconcile_outlook_graph_connection',
        'search_outlook_job_digests',
        'process_outlook_job_digest',
        'extract_job_links',
        'resolve_job_links',
        'inspect_job_posting',
        'get_reference_data',
        'get_document_import_capabilities',
        'list_documents',
        'export_document_chunk',
        'create_application',
        'update_application',
        'bulk_update_applications',
        'add_application_event',
        'add_application_activity',
        'upsert_application_from_email',
        'delete_application',
        'begin_document_import',
        'append_document_chunk',
        'complete_document_import',
        'cancel_document_import'
      )),
      target_type TEXT NOT NULL CHECK (target_type IN (
        'workspace',
        'job_search',
        'job_email',
        'application_collection',
        'application',
        'reference_data',
        'document_transfer',
        'document_collection',
        'document'
      )),
      result TEXT NOT NULL
        CHECK (result IN ('success', 'denied', 'not_found', 'error')),
      occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO mcp_audit_events (
      id, workspace_id, actor_user_id, transport, action, target_type, result,
      occurred_at
    )
    SELECT
      id, workspace_id, actor_user_id, transport, action, target_type, result,
      occurred_at
    FROM mcp_audit_events_version_thirty_five;

    DROP TABLE mcp_audit_events_version_thirty_five;

    CREATE INDEX mcp_audit_events_by_workspace_time
      ON mcp_audit_events (workspace_id, occurred_at DESC, id DESC);

    CREATE TRIGGER mcp_audit_events_reject_update
    BEFORE UPDATE ON mcp_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'MCP audit events are immutable');
    END;

    CREATE TRIGGER mcp_audit_events_reject_delete
    BEFORE DELETE ON mcp_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'MCP audit events are immutable');
    END;
  `,
};
