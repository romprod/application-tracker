import type { Migration } from "../migrations.js";

export const applicationFieldProvenanceMigration: Migration = {
  name: "application_field_provenance",
  version: 37,
  sql: `
    ALTER TABLE applications ADD COLUMN salary_minimum_amount REAL
      CHECK (salary_minimum_amount IS NULL OR salary_minimum_amount >= 0);
    ALTER TABLE applications ADD COLUMN salary_maximum_amount REAL
      CHECK (salary_maximum_amount IS NULL OR salary_maximum_amount >= 0);
    ALTER TABLE applications ADD COLUMN salary_currency TEXT
      CHECK (salary_currency IS NULL OR (
        length(salary_currency) = 3 AND
        salary_currency NOT GLOB '*[^A-Z]*'
      ));
    ALTER TABLE applications ADD COLUMN salary_period TEXT
      CHECK (salary_period IS NULL OR salary_period IN (
        'hourly', 'daily', 'weekly', 'monthly', 'annual'
      ));
    ALTER TABLE applications ADD COLUMN salary_disclosed INTEGER
      CHECK (salary_disclosed IS NULL OR salary_disclosed IN (0, 1));
    ALTER TABLE applications ADD COLUMN salary_negotiable INTEGER
      CHECK (salary_negotiable IS NULL OR salary_negotiable IN (0, 1));
    ALTER TABLE applications ADD COLUMN work_arrangement_text TEXT
      CHECK (
        work_arrangement_text IS NULL OR
        length(trim(work_arrangement_text)) BETWEEN 1 AND 500
      );
    ALTER TABLE applications ADD COLUMN office_days_per_week INTEGER
      CHECK (office_days_per_week IS NULL OR office_days_per_week BETWEEN 0 AND 7);
    ALTER TABLE applications ADD COLUMN remote_days_per_week INTEGER
      CHECK (remote_days_per_week IS NULL OR remote_days_per_week BETWEEN 0 AND 7);

    CREATE UNIQUE INDEX application_job_postings_by_application_id
      ON application_job_postings (workspace_id, application_id, id);
    CREATE TABLE application_field_provenance (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      field_name TEXT NOT NULL CHECK (field_name IN (
        'agency', 'appliedOn', 'companyName', 'location', 'roleTitle',
        'salary', 'sourceUrl', 'workArrangement'
      )),
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      source_type TEXT NOT NULL CHECK (source_type IN (
        'email_evidence', 'document', 'job_posting', 'imported'
      )),
      source_email_evidence_id TEXT,
      source_document_id TEXT,
      source_job_posting_id TEXT,
      observed_at TEXT NOT NULL CHECK (length(trim(observed_at)) > 0),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      field_state TEXT NOT NULL CHECK (field_state IN (
        'conflicting', 'disclosed', 'inferred', 'not_applicable',
        'not_disclosed'
      )),
      idempotency_key TEXT CHECK (
        idempotency_key IS NULL OR
        length(trim(idempotency_key)) BETWEEN 1 AND 200
      ),
      verified_at TEXT,
      verified_by_user_id TEXT,
      created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
      CHECK (
        (source_type = 'email_evidence' AND
          source_email_evidence_id IS NOT NULL AND
          source_document_id IS NULL AND source_job_posting_id IS NULL) OR
        (source_type = 'document' AND source_document_id IS NOT NULL AND
          source_email_evidence_id IS NULL AND source_job_posting_id IS NULL) OR
        (source_type = 'job_posting' AND source_job_posting_id IS NOT NULL AND
          source_email_evidence_id IS NULL AND source_document_id IS NULL) OR
        (source_type = 'imported' AND source_email_evidence_id IS NULL AND
          source_document_id IS NULL AND source_job_posting_id IS NULL)
      ),
      CHECK (
        (verified_at IS NULL AND verified_by_user_id IS NULL) OR
        (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL)
      ),
      UNIQUE (workspace_id, application_id, id),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, application_id, source_email_evidence_id)
        REFERENCES application_email_evidence(workspace_id, application_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, application_id, source_job_posting_id)
        REFERENCES application_job_postings(workspace_id, application_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, source_document_id)
        REFERENCES documents(workspace_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, verified_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_field_provenance_by_application_field
      ON application_field_provenance (
        workspace_id, application_id, field_name, observed_at DESC, id DESC
      );
    CREATE UNIQUE INDEX application_field_provenance_by_idempotency
      ON application_field_provenance (workspace_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE TRIGGER application_field_provenance_validate_document_insert
    BEFORE INSERT ON application_field_provenance
    WHEN NEW.source_document_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM application_documents
        WHERE workspace_id = NEW.workspace_id
          AND application_id = NEW.application_id
          AND document_id = NEW.source_document_id
      ) THEN RAISE(ABORT, 'invalid application provenance document') END;
    END;

    CREATE TRIGGER application_field_provenance_reject_update
    BEFORE UPDATE ON application_field_provenance
    WHEN NOT (
      OLD.id IS NEW.id AND OLD.workspace_id IS NEW.workspace_id AND
      OLD.application_id IS NEW.application_id AND
      OLD.field_name IS NEW.field_name AND OLD.value_json IS NEW.value_json AND
      OLD.source_type IS NEW.source_type AND
      OLD.source_email_evidence_id IS NEW.source_email_evidence_id AND
      OLD.source_document_id IS NEW.source_document_id AND
      OLD.source_job_posting_id IS NEW.source_job_posting_id AND
      OLD.observed_at IS NEW.observed_at AND OLD.confidence IS NEW.confidence AND
      OLD.field_state IS NEW.field_state AND
      OLD.idempotency_key IS NEW.idempotency_key AND
      OLD.created_at IS NEW.created_at AND OLD.verified_at IS NULL AND
      OLD.verified_by_user_id IS NULL AND NEW.verified_at IS NOT NULL AND
      NEW.verified_by_user_id IS NOT NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'application field provenance is immutable');
    END;

    CREATE TRIGGER application_field_provenance_reject_delete
    BEFORE DELETE ON application_field_provenance
    BEGIN
      SELECT RAISE(ABORT, 'application field provenance is immutable');
    END;

    DROP TRIGGER mcp_audit_events_reject_update;
    DROP TRIGGER mcp_audit_events_reject_delete;
    DROP INDEX mcp_audit_events_by_workspace_time;
    ALTER TABLE mcp_audit_events RENAME TO mcp_audit_events_version_thirty_six;

    CREATE TABLE mcp_audit_events (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('local_stdio', 'remote_http')),
      action TEXT NOT NULL CHECK (action IN (
        'get_tracker_context', 'get_connector_schema_status',
        'get_job_search_summary', 'list_applications', 'get_application',
        'list_application_events', 'list_unlinked_applications',
        'get_application_data_quality', 'audit_duplicate_applications',
        'find_duplicate_applications', 'merge_applications',
        'match_job_application_email', 'link_email_evidence',
        'reconcile_application_from_evidence', 'sync_outlook_email_evidence',
        'reconcile_outlook_graph_connection', 'search_outlook_job_digests',
        'process_outlook_job_digest', 'extract_job_links', 'resolve_job_links',
        'inspect_job_posting', 'get_reference_data',
        'get_document_import_capabilities', 'list_documents',
        'export_document_chunk', 'create_application', 'update_application',
        'bulk_update_applications', 'add_application_event',
        'add_application_activity', 'record_application_field_provenance',
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
    FROM mcp_audit_events_version_thirty_six;
    DROP TABLE mcp_audit_events_version_thirty_six;
    CREATE INDEX mcp_audit_events_by_workspace_time
      ON mcp_audit_events (workspace_id, occurred_at DESC, id DESC);
    CREATE TRIGGER mcp_audit_events_reject_update BEFORE UPDATE ON mcp_audit_events
    BEGIN SELECT RAISE(ABORT, 'MCP audit events are immutable'); END;
    CREATE TRIGGER mcp_audit_events_reject_delete BEFORE DELETE ON mcp_audit_events
    BEGIN SELECT RAISE(ABORT, 'MCP audit events are immutable'); END;
  `,
};
