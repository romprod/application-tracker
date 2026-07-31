import type { Migration } from "../migrations.js";

export const applicationRecoveryMigration: Migration = {
  name: "application_recovery",
  version: 39,
  sql: `
    ALTER TABLE application_merges ADD COLUMN recovery_snapshot_json TEXT
      CHECK (
        recovery_snapshot_json IS NULL OR json_valid(recovery_snapshot_json)
      );

    ALTER TABLE application_deletions
      RENAME TO application_deletions_version_thirty_eight;
    DROP INDEX application_deletions_by_workspace_time;

    CREATE TABLE application_deletions (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      application_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
      deleted_at TEXT NOT NULL CHECK (length(trim(deleted_at)) > 0),
      merge_id TEXT,
      recovery_snapshot_json TEXT NOT NULL
        CHECK (json_valid(recovery_snapshot_json)),
      UNIQUE (workspace_id, id),
      UNIQUE (workspace_id, application_id, deleted_at),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, merge_id)
        REFERENCES application_merges(workspace_id, id)
        ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO application_deletions
      (id, application_id, workspace_id, actor_user_id, reason, deleted_at,
       merge_id, recovery_snapshot_json)
    SELECT
      legacy.application_id,
      legacy.application_id,
      legacy.workspace_id,
      legacy.actor_user_id,
      'Deletion reason was not recorded by the earlier schema.',
      legacy.deleted_at,
      NULL,
      json_object(
        'version', 1,
        'applicationUpdatedAt', applications.updated_at,
        'documentIds', json(COALESCE((
          SELECT json_group_array(document_id)
          FROM application_documents
          WHERE workspace_id = legacy.workspace_id
            AND application_id = legacy.application_id
        ), '[]')),
        'emailEvidence', json(COALESCE((
          SELECT json_group_array(json_object('id', id, 'updatedAt', updated_at))
          FROM application_email_evidence
          WHERE workspace_id = legacy.workspace_id
            AND application_id = legacy.application_id
        ), '[]')),
        'jobPostings', json(COALESCE((
          SELECT json_group_array(json_object('id', id, 'updatedAt', updated_at))
          FROM application_job_postings
          WHERE workspace_id = legacy.workspace_id
            AND application_id = legacy.application_id
        ), '[]')),
        'outlookGraphConnectionId', (
          SELECT connection_id
          FROM application_outlook_graph_connections
          WHERE workspace_id = legacy.workspace_id
            AND application_id = legacy.application_id
        )
      )
    FROM application_deletions_version_thirty_eight AS legacy
    JOIN applications
      ON applications.workspace_id = legacy.workspace_id
     AND applications.id = legacy.application_id;

    INSERT INTO application_deletions
      (id, application_id, workspace_id, actor_user_id, reason, deleted_at,
       merge_id, recovery_snapshot_json)
    SELECT
      merges.id,
      merges.source_application_id,
      merges.workspace_id,
      merges.actor_user_id,
      'Merged into another application.',
      merges.merged_at,
      merges.id,
      json_object(
        'version', 1,
        'applicationUpdatedAt', applications.updated_at,
        'documentIds', json(COALESCE((
          SELECT json_group_array(document_id)
          FROM application_documents
          WHERE workspace_id = merges.workspace_id
            AND application_id = merges.source_application_id
        ), '[]')),
        'emailEvidence', json('[]'),
        'jobPostings', json('[]'),
        'outlookGraphConnectionId', NULL
      )
    FROM application_merges AS merges
    JOIN applications
      ON applications.workspace_id = merges.workspace_id
     AND applications.id = merges.source_application_id
    WHERE NOT EXISTS (
      SELECT 1 FROM application_deletions AS deletions
      WHERE deletions.workspace_id = merges.workspace_id
        AND deletions.application_id = merges.source_application_id
        AND deletions.deleted_at = merges.merged_at
    );

    DROP TABLE application_deletions_version_thirty_eight;

    CREATE INDEX application_deletions_by_workspace_time
      ON application_deletions (
        workspace_id, deleted_at DESC, application_id, id
      );
    CREATE INDEX application_deletions_by_merge
      ON application_deletions (workspace_id, merge_id)
      WHERE merge_id IS NOT NULL;
    CREATE TRIGGER application_deletions_reject_update
    BEFORE UPDATE ON application_deletions
    BEGIN
      SELECT RAISE(ABORT, 'application deletions are immutable');
    END;
    CREATE TRIGGER application_deletions_reject_delete
    BEFORE DELETE ON application_deletions
    BEGIN
      SELECT RAISE(ABORT, 'application deletions are immutable');
    END;

    CREATE TABLE application_merge_recoveries (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      merge_id TEXT NOT NULL,
      deletion_id TEXT NOT NULL,
      source_application_id TEXT NOT NULL,
      target_application_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      expected_source_updated_at TEXT NOT NULL,
      expected_target_updated_at TEXT NOT NULL,
      recovered_at TEXT NOT NULL CHECK (length(trim(recovered_at)) > 0),
      UNIQUE (workspace_id, id),
      UNIQUE (workspace_id, merge_id),
      FOREIGN KEY (workspace_id, merge_id)
        REFERENCES application_merges(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, deletion_id)
        REFERENCES application_deletions(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, source_application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, target_application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_merge_recoveries_by_workspace_time
      ON application_merge_recoveries (
        workspace_id, recovered_at DESC, id DESC
      );
    CREATE TRIGGER application_merge_recoveries_reject_update
    BEFORE UPDATE ON application_merge_recoveries
    BEGIN
      SELECT RAISE(ABORT, 'application merge recoveries are immutable');
    END;
    CREATE TRIGGER application_merge_recoveries_reject_delete
    BEFORE DELETE ON application_merge_recoveries
    BEGIN
      SELECT RAISE(ABORT, 'application merge recoveries are immutable');
    END;

    CREATE TABLE application_restorations (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      deletion_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      recovery_type TEXT NOT NULL CHECK (recovery_type IN ('manual', 'merge')),
      merge_recovery_id TEXT,
      restored_at TEXT NOT NULL CHECK (length(trim(restored_at)) > 0),
      UNIQUE (workspace_id, id),
      UNIQUE (workspace_id, deletion_id),
      UNIQUE (workspace_id, merge_recovery_id),
      FOREIGN KEY (workspace_id, deletion_id)
        REFERENCES application_deletions(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, actor_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, merge_recovery_id)
        REFERENCES application_merge_recoveries(workspace_id, id)
        ON DELETE RESTRICT,
      CHECK (
        (recovery_type = 'manual' AND merge_recovery_id IS NULL) OR
        (recovery_type = 'merge' AND merge_recovery_id IS NOT NULL)
      )
    ) STRICT;

    CREATE INDEX application_restorations_by_workspace_time
      ON application_restorations (
        workspace_id, restored_at DESC, id DESC
      );
    CREATE TRIGGER application_restorations_reject_update
    BEFORE UPDATE ON application_restorations
    BEGIN
      SELECT RAISE(ABORT, 'application restorations are immutable');
    END;
    CREATE TRIGGER application_restorations_reject_delete
    BEFORE DELETE ON application_restorations
    BEGIN
      SELECT RAISE(ABORT, 'application restorations are immutable');
    END;

    DROP TRIGGER mcp_audit_events_reject_update;
    DROP TRIGGER mcp_audit_events_reject_delete;
    DROP INDEX mcp_audit_events_by_workspace_time;
    ALTER TABLE mcp_audit_events RENAME TO mcp_audit_events_version_thirty_eight;

    CREATE TABLE mcp_audit_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('local_stdio', 'remote_http')),
      action TEXT NOT NULL CHECK (action IN (
        'get_tracker_context', 'get_connector_schema_status',
        'get_job_search_summary', 'query_application_attention',
        'list_applications', 'list_deleted_applications', 'get_application',
        'list_application_events', 'list_unlinked_applications',
        'get_application_data_quality', 'audit_duplicate_applications',
        'find_duplicate_applications', 'merge_applications',
        'recover_application_merge', 'preview_application_restore',
        'restore_application', 'match_job_application_email',
        'link_email_evidence', 'reconcile_application_from_evidence',
        'sync_outlook_email_evidence', 'reconcile_outlook_graph_connection',
        'search_outlook_job_digests', 'process_outlook_job_digest',
        'extract_job_links', 'resolve_job_links', 'inspect_job_posting',
        'get_reference_data', 'get_document_import_capabilities',
        'list_documents', 'export_document_chunk', 'create_application',
        'update_application', 'bulk_update_applications',
        'add_application_event', 'add_application_activity',
        'record_application_field_provenance',
        'verify_application_field_provenance', 'upsert_application_from_email',
        'delete_application', 'begin_document_import', 'append_document_chunk',
        'complete_document_import', 'cancel_document_import'
      )),
      target_type TEXT NOT NULL CHECK (target_type IN (
        'workspace', 'job_search', 'job_email', 'application_collection',
        'application', 'reference_data', 'document_transfer',
        'document_collection', 'document'
      )),
      result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'not_found', 'error')),
      occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO mcp_audit_events
      (id, workspace_id, actor_user_id, transport, action, target_type, result, occurred_at)
    SELECT id, workspace_id, actor_user_id, transport, action, target_type, result, occurred_at
    FROM mcp_audit_events_version_thirty_eight;
    DROP TABLE mcp_audit_events_version_thirty_eight;
    CREATE INDEX mcp_audit_events_by_workspace_time
      ON mcp_audit_events (workspace_id, occurred_at DESC, id DESC);
    CREATE TRIGGER mcp_audit_events_reject_update BEFORE UPDATE ON mcp_audit_events
    BEGIN SELECT RAISE(ABORT, 'MCP audit events are immutable'); END;
    CREATE TRIGGER mcp_audit_events_reject_delete BEFORE DELETE ON mcp_audit_events
    BEGIN SELECT RAISE(ABORT, 'MCP audit events are immutable'); END;
  `,
};
