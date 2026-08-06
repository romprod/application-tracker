import type { Migration } from "../migrations.js";

export const outlookJobDigestReviewMigration: Migration = {
  name: "outlook_job_digest_review",
  version: 40,
  sql: `
    CREATE TABLE outlook_job_digest_review_checkpoints (
      workspace_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      connection_updated_at TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
      last_completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by_user_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, connection_id),
      FOREIGN KEY (workspace_id, connection_id)
        REFERENCES outlook_graph_connections(workspace_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, updated_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE outlook_job_digest_review_messages (
      workspace_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      message_id TEXT NOT NULL CHECK (length(message_id) BETWEEN 1 AND 998),
      received_at TEXT NOT NULL,
      classification TEXT NOT NULL CHECK (classification IN (
        'account_or_security', 'application_acknowledgement',
        'interview_or_assessment', 'irrelevant', 'marketing_or_digest',
        'offer', 'recruiter_conversation', 'status_or_rejection'
      )),
      posting_count INTEGER NOT NULL CHECK (posting_count BETWEEN 0 AND 20),
      reviewed_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, connection_id, message_id),
      FOREIGN KEY (workspace_id, connection_id)
        REFERENCES outlook_job_digest_review_checkpoints(workspace_id, connection_id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX outlook_job_digest_review_messages_by_time
      ON outlook_job_digest_review_messages
        (workspace_id, connection_id, received_at DESC, message_id);

    CREATE TABLE outlook_job_digest_review_postings (
      workspace_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      occurrence_index INTEGER NOT NULL CHECK (occurrence_index BETWEEN 0 AND 19),
      posting_identity TEXT NOT NULL CHECK (length(posting_identity) = 64),
      provider TEXT NOT NULL CHECK (provider IN (
        'linkedin', 'cv_library', 'indeed', 'totaljobs', 'michael_page',
        'hackajob', 'cord', 'talent', 'generic'
      )),
      external_posting_id TEXT,
      canonical_url TEXT NOT NULL CHECK (length(canonical_url) BETWEEN 9 AND 2048),
      outcome TEXT NOT NULL CHECK (outcome IN (
        'unprocessed', 'already_tracked', 'ambiguous', 'conflict',
        'expired', 'unavailable'
      )),
      unavailable_reason TEXT CHECK (
        unavailable_reason IS NULL OR
        length(unavailable_reason) BETWEEN 1 AND 80
      ),
      retry_eligible INTEGER NOT NULL CHECK (retry_eligible IN (0, 1)),
      retry_after TEXT,
      reviewed_at TEXT NOT NULL,
      PRIMARY KEY (
        workspace_id, connection_id, message_id, occurrence_index
      ),
      UNIQUE (
        workspace_id, connection_id, message_id, posting_identity
      ),
      FOREIGN KEY (workspace_id, connection_id, message_id)
        REFERENCES outlook_job_digest_review_messages(
          workspace_id, connection_id, message_id
        )
        ON DELETE CASCADE,
      CHECK (
        (outcome IN ('expired', 'unavailable') AND unavailable_reason IS NOT NULL)
        OR
        (outcome NOT IN ('expired', 'unavailable') AND unavailable_reason IS NULL)
      ),
      CHECK (retry_eligible = 0 OR outcome = 'unavailable')
    ) STRICT;

    CREATE INDEX outlook_job_digest_review_postings_by_identity
      ON outlook_job_digest_review_postings
        (workspace_id, connection_id, posting_identity, reviewed_at DESC);

    CREATE INDEX outlook_job_digest_review_postings_retryable
      ON outlook_job_digest_review_postings
        (workspace_id, connection_id, retry_after, reviewed_at)
      WHERE retry_eligible = 1;

    DROP TRIGGER mcp_audit_events_reject_update;
    DROP TRIGGER mcp_audit_events_reject_delete;
    DROP INDEX mcp_audit_events_by_workspace_time;
    ALTER TABLE mcp_audit_events RENAME TO mcp_audit_events_version_thirty_nine;

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
        'review_new_outlook_job_digests',
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
    FROM mcp_audit_events_version_thirty_nine;
    DROP TABLE mcp_audit_events_version_thirty_nine;
    CREATE INDEX mcp_audit_events_by_workspace_time
      ON mcp_audit_events (workspace_id, occurred_at DESC, id DESC);
    CREATE TRIGGER mcp_audit_events_reject_update BEFORE UPDATE ON mcp_audit_events
    BEGIN SELECT RAISE(ABORT, 'MCP audit events are immutable'); END;
    CREATE TRIGGER mcp_audit_events_reject_delete BEFORE DELETE ON mcp_audit_events
    BEGIN SELECT RAISE(ABORT, 'MCP audit events are immutable'); END;
  `,
};
