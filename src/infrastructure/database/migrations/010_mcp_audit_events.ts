import type { Migration } from "../migrations.js";

export const mcpAuditEventsMigration: Migration = {
  name: "mcp_audit_events",
  version: 10,
  sql: `
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
          'get_reference_data'
        )),
      target_type TEXT NOT NULL
        CHECK (target_type IN (
          'workspace',
          'job_search',
          'application_collection',
          'application',
          'reference_data'
        )),
      result TEXT NOT NULL
        CHECK (result IN ('success', 'denied', 'not_found', 'error')),
      occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) STRICT;

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
