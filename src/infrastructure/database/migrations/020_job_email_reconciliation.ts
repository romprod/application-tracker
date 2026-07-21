import type { Migration } from "../migrations.js";

export const jobEmailReconciliationMigration: Migration = {
  name: "job_email_reconciliation",
  version: 20,
  sql: `
    CREATE TABLE application_job_postings (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN (
        'linkedin',
        'cv_library',
        'indeed',
        'totaljobs',
        'michael_page',
        'hackajob',
        'cord',
        'talent',
        'generic'
      )),
      external_posting_id TEXT CHECK (
        external_posting_id IS NULL OR
        length(trim(external_posting_id)) BETWEEN 1 AND 256
      ),
      canonical_url TEXT CHECK (
        canonical_url IS NULL OR (
          length(canonical_url) BETWEEN 1 AND 2048 AND
          (lower(canonical_url) LIKE 'https://%' OR
           lower(canonical_url) LIKE 'http://%')
        )
      ),
      created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
      updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
      CHECK (external_posting_id IS NOT NULL OR canonical_url IS NOT NULL),
      CHECK (provider <> 'generic' OR external_posting_id IS NULL),
      CHECK (updated_at >= created_at),
      UNIQUE (workspace_id, provider, external_posting_id),
      UNIQUE (workspace_id, canonical_url),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_job_postings_by_application
      ON application_job_postings (
        workspace_id,
        application_id,
        created_at,
        id
      );

    CREATE TABLE application_email_evidence (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      message_id TEXT NOT NULL
        CHECK (length(trim(message_id)) BETWEEN 1 AND 998),
      web_url TEXT CHECK (
        web_url IS NULL OR (
          length(web_url) BETWEEN 1 AND 2048 AND
          (lower(web_url) LIKE 'https://%' OR lower(web_url) LIKE 'http://%')
        )
      ),
      received_at TEXT NOT NULL CHECK (length(trim(received_at)) > 0),
      created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
      updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
      CHECK (updated_at >= created_at),
      UNIQUE (workspace_id, message_id),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_email_evidence_by_application
      ON application_email_evidence (
        workspace_id,
        application_id,
        received_at DESC,
        id
      );

    DROP TRIGGER mcp_audit_events_reject_update;
    DROP TRIGGER mcp_audit_events_reject_delete;
    DROP INDEX mcp_audit_events_by_workspace_time;
    ALTER TABLE mcp_audit_events RENAME TO mcp_audit_events_version_nineteen;

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
    FROM mcp_audit_events_version_nineteen;

    DROP TABLE mcp_audit_events_version_nineteen;

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
