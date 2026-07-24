import type { Migration } from "../migrations.js";

export const applicationMergesMigration: Migration = {
  name: "application_merges",
  version: 26,
  sql: `
    CREATE TABLE application_merges (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      source_application_id TEXT NOT NULL,
      target_application_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      source_updated_at TEXT NOT NULL CHECK (length(trim(source_updated_at)) > 0),
      target_updated_at TEXT NOT NULL CHECK (length(trim(target_updated_at)) > 0),
      resolutions_json TEXT NOT NULL CHECK (json_valid(resolutions_json)),
      merged_at TEXT NOT NULL CHECK (length(trim(merged_at)) > 0),
      CHECK (source_application_id <> target_application_id),
      UNIQUE (workspace_id, source_application_id),
      UNIQUE (workspace_id, id),
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

    CREATE INDEX application_merges_by_target
      ON application_merges (
        workspace_id,
        target_application_id,
        merged_at,
        id
      );

    CREATE TRIGGER application_merges_reject_update
    BEFORE UPDATE ON application_merges
    BEGIN
      SELECT RAISE(ABORT, 'application merges are immutable');
    END;

    CREATE TRIGGER application_merges_reject_delete
    BEFORE DELETE ON application_merges
    BEGIN
      SELECT RAISE(ABORT, 'application merges are immutable');
    END;

    DROP TRIGGER mcp_audit_events_reject_update;
    DROP TRIGGER mcp_audit_events_reject_delete;
    DROP INDEX mcp_audit_events_by_workspace_time;
    ALTER TABLE mcp_audit_events RENAME TO mcp_audit_events_version_twenty_five;

    CREATE TABLE mcp_audit_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      transport TEXT NOT NULL
        CHECK (transport IN ('local_stdio', 'remote_http')),
      action TEXT NOT NULL
        CHECK (action IN (
          'get_tracker_context',
          'get_connector_schema_status',
          'get_job_search_summary',
          'list_applications',
          'get_application',
          'audit_duplicate_applications',
          'merge_applications',
          'match_job_application_email',
          'extract_job_links',
          'get_reference_data',
          'get_document_import_capabilities',
          'list_documents',
          'export_document_chunk',
          'create_application',
          'update_application',
          'bulk_update_applications',
          'upsert_application_from_email',
          'delete_application',
          'begin_document_import',
          'append_document_chunk',
          'complete_document_import',
          'cancel_document_import'
        )),
      target_type TEXT NOT NULL
        CHECK (target_type IN (
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
    FROM mcp_audit_events_version_twenty_five;

    DROP TABLE mcp_audit_events_version_twenty_five;

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
