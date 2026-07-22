import type { Migration } from "../migrations.js";

export const mcpEmailLinkExtractionAuditMigration: Migration = {
  name: "mcp_email_link_extraction_audit",
  version: 21,
  sql: `
    DROP TRIGGER mcp_audit_events_reject_update;
    DROP TRIGGER mcp_audit_events_reject_delete;
    DROP INDEX mcp_audit_events_by_workspace_time;
    ALTER TABLE mcp_audit_events RENAME TO mcp_audit_events_version_twenty;

    CREATE TABLE mcp_audit_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      transport TEXT NOT NULL
        CHECK (transport IN ('local_stdio', 'remote_http')),
      action TEXT NOT NULL
        CHECK (action IN (
          'get_tracker_context',
          'get_job_search_summary',
          'list_applications',
          'get_application',
          'match_job_application_email',
          'extract_job_links',
          'get_reference_data',
          'get_document_import_capabilities',
          'list_documents',
          'export_document_chunk',
          'create_application',
          'update_application',
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
    FROM mcp_audit_events_version_twenty;

    DROP TABLE mcp_audit_events_version_twenty;

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
