import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { LocalMcpActorProvider } from "../../application/mcp.js";
import { SqliteMcpActorRepository } from "./mcp_actor_repository.js";
import {
  applicationMigrations,
  migrateDatabase,
  type Migration,
} from "./migrations.js";
import { workspaceIdentityMigration } from "./migrations/001_workspace_identity.js";
import { SqliteSetupRepository } from "./setup_repository.js";

describe("migrateDatabase", () => {
  it("applies each migration once", () => {
    const database = new Database(":memory:");
    const migrations: readonly Migration[] = [
      {
        name: "create_example",
        sql: "CREATE TABLE example (id INTEGER PRIMARY KEY);",
        version: 1,
      },
    ];

    try {
      migrateDatabase(database, migrations);
      migrateDatabase(database, migrations);

      const applied = database
        .prepare("SELECT version, name FROM schema_migrations")
        .all();
      expect(applied).toEqual([{ name: "create_example", version: 1 }]);
    } finally {
      database.close();
    }
  });

  it("rejects edited migration history", () => {
    const database = new Database(":memory:");
    const original: readonly Migration[] = [
      {
        name: "create_example",
        sql: "CREATE TABLE example (id INTEGER PRIMARY KEY);",
        version: 1,
      },
    ];
    const edited: readonly Migration[] = [
      {
        name: "create_example",
        sql: "CREATE TABLE example (id INTEGER PRIMARY KEY, name TEXT);",
        version: 1,
      },
    ];

    try {
      migrateDatabase(database, original);
      expect(() => migrateDatabase(database, edited)).toThrow(
        "Migration drift detected for version 1",
      );
    } finally {
      database.close();
    }
  });

  it("rolls back a migration that cannot complete", () => {
    const database = new Database(":memory:");
    const invalid: readonly Migration[] = [
      {
        name: "invalid_example",
        sql: "CREATE TABLE transient (id INTEGER); THIS IS NOT SQL;",
        version: 1,
      },
    ];

    try {
      expect(() => migrateDatabase(database, invalid)).toThrow();
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transient'",
        )
        .get();
      expect(table).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("migrates the identity schema forward from version one", () => {
    const database = new Database(":memory:");

    try {
      migrateDatabase(database, [workspaceIdentityMigration]);
      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare("SELECT version FROM schema_migrations ORDER BY version")
          .pluck()
          .all(),
      ).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
      ]);
      expect(
        database
          .prepare(
            `SELECT name
             FROM pragma_table_info('applications')
             WHERE name IN (
               'salary_minimum_amount', 'salary_maximum_amount',
               'salary_currency', 'salary_period', 'salary_disclosed',
               'salary_negotiable', 'work_arrangement_text',
               'office_days_per_week', 'remote_days_per_week'
             )
             ORDER BY cid`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "salary_minimum_amount",
        "salary_maximum_amount",
        "salary_currency",
        "salary_period",
        "salary_disclosed",
        "salary_negotiable",
        "work_arrangement_text",
        "office_days_per_week",
        "remote_days_per_week",
      ]);
      expect(
        database
          .prepare(
            `SELECT name FROM pragma_table_info('application_field_provenance')
             ORDER BY cid`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "id",
        "workspace_id",
        "application_id",
        "field_name",
        "value_json",
        "source_type",
        "source_email_evidence_id",
        "source_document_id",
        "source_job_posting_id",
        "observed_at",
        "confidence",
        "field_state",
        "idempotency_key",
        "verified_at",
        "verified_by_user_id",
        "created_at",
      ]);
      expect(
        database
          .prepare(
            `SELECT name
             FROM pragma_table_info('application_events')
             ORDER BY cid`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "id",
        "workspace_id",
        "application_id",
        "actor_user_id",
        "event_type",
        "from_status",
        "to_status",
        "occurred_at",
        "processed_at",
        "summary",
        "source_email_evidence_id",
        "source_email_message_id",
        "status_override_reason",
        "idempotency_key",
        "supersedes_event_id",
        "correction_reason",
        "sequence",
      ]);
      expect(
        database
          .prepare(
            `SELECT name
             FROM pragma_table_info('outlook_graph_connections')
             ORDER BY cid`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "id",
        "workspace_id",
        "name",
        "tenant_id",
        "client_id",
        "client_secret_encrypted",
        "mailbox",
        "folder_path",
        "enabled",
        "verified_at",
        "last_tested_at",
        "last_error_code",
        "created_at",
        "updated_at",
        "updated_by_user_id",
        "last_reconciled_at",
      ]);
      expect(
        database
          .prepare(
            `SELECT name
             FROM pragma_table_info('outlook_graph_connections')
             WHERE lower(name) IN ('client_secret', 'access_token', 'refresh_token')`,
          )
          .pluck()
          .all(),
      ).toEqual([]);
      expect(
        database
          .prepare(
            `SELECT name
             FROM pragma_table_info('application_outlook_graph_connections')
             ORDER BY cid`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "workspace_id",
        "application_id",
        "connection_id",
        "assigned_at",
        "assigned_by_user_id",
      ]);
      expect(
        database
          .prepare(
            "SELECT setup_completed_at FROM installation_state WHERE id = 1",
          )
          .pluck()
          .get(),
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("upgrades a version-30 mailbox into an unassigned named connection", () => {
    const database = new Database(":memory:");
    const now = "2026-07-28T10:00:00.000Z";
    try {
      migrateDatabase(database, applicationMigrations.slice(0, 30));
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES ('workspace-one', 'Workspace one', 'workspace-one', ?)`,
        )
        .run(now);
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES ('user-one', 'alex', 'Alex', 'active', ?, ?)`,
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES ('workspace-one', 'user-one', 'admin', ?)`,
        )
        .run(now);
      database
        .prepare(
          `INSERT INTO outlook_graph_connections
             (workspace_id, tenant_id, client_id, client_secret_encrypted,
              mailbox, folder_path, enabled, verified_at, last_tested_at,
              last_error_code, created_at, updated_at, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          "workspace-one",
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
          "v1.legacy-encrypted-client-secret-material",
          "jobs@example.com",
          "Inbox\\Jobs",
          now,
          now,
          now,
          now,
          "user-one",
        );

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            `SELECT workspace_id AS workspaceId, name, mailbox,
                    client_secret_encrypted AS clientSecretEncrypted,
                    length(id) AS idLength
             FROM outlook_graph_connections`,
          )
          .get(),
      ).toEqual({
        clientSecretEncrypted: "v1.legacy-encrypted-client-secret-material",
        idLength: 36,
        mailbox: "jobs@example.com",
        name: "jobs@example.com",
        workspaceId: "workspace-one",
      });
      expect(
        database
          .prepare("SELECT count(*) FROM application_outlook_graph_connections")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("preserves cached text while adding constrained structured previews", () => {
    const database = new Database(":memory:");
    const occurredAt = "2026-07-19T10:00:00.000Z";

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, 18));
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES ('workspace-preview', 'Preview', 'preview', ?)`,
        )
        .run(occurredAt);
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES ('user-preview', 'preview-user', 'Preview User', 'active', ?, ?)`,
        )
        .run(occurredAt, occurredAt);
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES ('workspace-preview', 'user-preview', 'admin', ?)`,
        )
        .run(occurredAt);
      const documentTypeId = database
        .prepare(
          `SELECT id FROM reference_values
           WHERE workspace_id = 'workspace-preview'
             AND category = 'document_type'
           ORDER BY sort_order LIMIT 1`,
        )
        .pluck()
        .get();
      if (typeof documentTypeId !== "string") {
        throw new Error("Missing document type fixture");
      }
      database
        .prepare(
          `INSERT INTO file_objects
             (sha256, byte_size, content, created_at)
           VALUES (?, 4, ?, ?)`,
        )
        .run("0".repeat(64), Buffer.from("text"), occurredAt);
      database
        .prepare(
          `INSERT INTO documents
             (id, workspace_id, file_sha256, document_type_reference_id,
              original_filename, media_type, uploaded_by_user_id, created_at)
           VALUES (
             'document-preview', 'workspace-preview', ?, ?, 'notes.txt',
             'text/plain', 'user-preview', ?
           )`,
        )
        .run("0".repeat(64), documentTypeId, occurredAt);
      database
        .prepare(
          `INSERT INTO document_previews
             (workspace_id, document_id, parser_version, media_type,
              plain_text, is_truncated, generated_at)
           VALUES (
             'workspace-preview', 'document-preview', 'plain-text-v1',
             'text/plain', 'Cached preview', 0, ?
           )`,
        )
        .run(occurredAt);

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            `SELECT preview_kind AS previewKind,
                    email_metadata_json AS emailMetadataJson
             FROM document_previews`,
          )
          .get(),
      ).toEqual({ emailMetadataJson: null, previewKind: "text" });
      expect(() =>
        database
          .prepare(
            `UPDATE document_previews
             SET email_metadata_json = '{}'`,
          )
          .run(),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            `UPDATE document_previews
             SET preview_kind = 'email'`,
          )
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("creates a constrained application ledger with its list index", () => {
    const database = new Database(":memory:");

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations);

      const tableSql = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'applications'",
        )
        .pluck()
        .get();
      expect(tableSql).toContain("STRICT");
      expect(tableSql).toContain("agency TEXT");
      expect(tableSql).toContain("salary TEXT");
      expect(tableSql).toContain("rating INTEGER");
      expect(tableSql).toContain("work_arrangement TEXT");
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'applications_by_workspace_updated'",
          )
          .pluck()
          .get(),
      ).toBe("applications_by_workspace_updated");
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'application_events'",
          )
          .pluck()
          .get(),
      ).toBe("application_events");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name = 'application_events_by_application_time'`,
          )
          .pluck()
          .get(),
      ).toBe("application_events_by_application_time");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name = 'application_events_by_source_email'`,
          )
          .pluck()
          .get(),
      ).toBe("application_events_by_source_email");
      const eventTableSql = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'application_events'",
        )
        .pluck()
        .get();
      expect(eventTableSql).toContain("processed_at TEXT NOT NULL");
      expect(eventTableSql).toContain("source_email_message_id TEXT");
      expect(eventTableSql).toContain("status_override_reason TEXT");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'trigger' AND name IN (
               'application_events_reject_update',
               'application_events_reject_delete'
             )
             ORDER BY name`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "application_events_reject_delete",
        "application_events_reject_update",
      ]);
      expect(tableSql).toContain("next_action TEXT");
      expect(tableSql).toContain("next_action_due TEXT");
      expect(tableSql).toContain("deleted_at TEXT");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name = 'applications_by_workspace_next_action_due'`,
          )
          .pluck()
          .get(),
      ).toBe("applications_by_workspace_next_action_due");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'application_deletions'`,
          )
          .pluck()
          .get(),
      ).toBe("application_deletions");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name = 'applications_active_by_workspace_updated'`,
          )
          .pluck()
          .get(),
      ).toBe("applications_active_by_workspace_updated");
      expect(
        database
          .prepare(
            `SELECT sql FROM sqlite_master
             WHERE type = 'index' AND name = 'applications_by_workspace_next_action_due'`,
          )
          .pluck()
          .get(),
      ).toContain("deleted_at IS NULL");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name IN (
               'application_contacts',
               'application_links'
             ) ORDER BY name`,
          )
          .pluck()
          .all(),
      ).toEqual(["application_contacts", "application_links"]);
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name IN (
               'application_contacts_by_application',
               'application_links_by_application'
             ) ORDER BY name`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "application_contacts_by_application",
        "application_links_by_application",
      ]);
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'reference_values'`,
          )
          .pluck()
          .get(),
      ).toBe("reference_values");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'trigger' AND name = 'workspaces_seed_reference_values'`,
          )
          .pluck()
          .get(),
      ).toBe("workspaces_seed_reference_values");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'mcp_audit_events'`,
          )
          .pluck()
          .get(),
      ).toBe("mcp_audit_events");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'trigger' AND name IN (
               'mcp_audit_events_reject_update',
               'mcp_audit_events_reject_delete'
             )
             ORDER BY name`,
          )
          .pluck()
          .all(),
      ).toEqual([
        "mcp_audit_events_reject_delete",
        "mcp_audit_events_reject_update",
      ]);
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name IN (
               'file_objects',
               'documents',
               'application_documents'
             ) ORDER BY name`,
          )
          .pluck()
          .all(),
      ).toEqual(["application_documents", "documents", "file_objects"]);
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'document_previews'`,
          )
          .pluck()
          .get(),
      ).toBe("document_previews");
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'mcp_workspace_settings'`,
          )
          .pluck()
          .get(),
      ).toBe("mcp_workspace_settings");
    } finally {
      database.close();
    }
  });

  it("backfills a creation event for applications from version three", () => {
    const database = new Database(":memory:");
    const legacyApplicationId = "application-legacy";

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, 3));
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          "workspace-legacy",
          "Legacy",
          "legacy",
          "2026-07-17T10:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          "user-legacy",
          "legacy",
          "Legacy User",
          "2026-07-17T10:00:00.000Z",
          "2026-07-17T10:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'admin', ?)`,
        )
        .run("workspace-legacy", "user-legacy", "2026-07-17T10:00:00.000Z");
      database
        .prepare(
          `INSERT INTO applications
             (id, workspace_id, company_name, role_title, status,
              created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          legacyApplicationId,
          "workspace-legacy",
          "Example Studio",
          "Product Designer",
          "interview",
          "user-legacy",
          "2026-07-17T11:00:00.000Z",
          "2026-07-17T12:00:00.000Z",
        );

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            `SELECT event_type AS type, from_status AS fromStatus,
                    to_status AS toStatus, occurred_at AS occurredAt
             FROM application_events
             WHERE application_id = ?`,
          )
          .get(legacyApplicationId),
      ).toEqual({
        fromStatus: null,
        occurredAt: "2026-07-17T11:00:00.000Z",
        toStatus: "Interview",
        type: "application_created",
      });
    } finally {
      database.close();
    }
  });

  it("adds nullable next-action fields without changing version-four records", () => {
    const database = new Database(":memory:");
    const applicationId = "application-version-four";

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, 4));
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          "workspace-version-four",
          "Version Four",
          "version-four",
          "2026-07-18T10:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          "user-version-four",
          "version-four",
          "Version Four User",
          "2026-07-18T10:00:00.000Z",
          "2026-07-18T10:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'admin', ?)`,
        )
        .run(
          "workspace-version-four",
          "user-version-four",
          "2026-07-18T10:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO applications
             (id, workspace_id, company_name, role_title, status,
              created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          applicationId,
          "workspace-version-four",
          "Example Studio",
          "Product Designer",
          "applied",
          "user-version-four",
          "2026-07-18T11:00:00.000Z",
          "2026-07-18T11:00:00.000Z",
        );

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            `SELECT company_name AS companyName, deleted_at AS deletedAt,
                    next_action AS nextAction, next_action_due AS nextActionDue
             FROM applications WHERE id = ?`,
          )
          .get(applicationId),
      ).toEqual({
        companyName: "Example Studio",
        deletedAt: null,
        nextAction: null,
        nextActionDue: null,
      });
    } finally {
      database.close();
    }
  });

  it("connects existing applications and history to workspace statuses", () => {
    const database = new Database(":memory:");
    const applicationId = "application-version-eight";

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, 8));
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          "workspace-version-eight",
          "Version Eight",
          "version-eight",
          "2026-07-18T10:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          "user-version-eight",
          "version-eight",
          "Version Eight User",
          "2026-07-18T10:00:00.000Z",
          "2026-07-18T10:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'admin', ?)`,
        )
        .run(
          "workspace-version-eight",
          "user-version-eight",
          "2026-07-18T10:00:00.000Z",
        );
      database
        .prepare(
          `UPDATE reference_values
           SET label = 'Submitted', updated_at = '2026-07-18T10:30:00.000Z'
           WHERE workspace_id = ? AND category = 'status' AND label = 'Applied'`,
        )
        .run("workspace-version-eight");
      database
        .prepare(
          `INSERT INTO applications
             (id, workspace_id, company_name, role_title, status,
              created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          applicationId,
          "workspace-version-eight",
          "Example Studio",
          "Product Designer",
          "applied",
          "user-version-eight",
          "2026-07-18T11:00:00.000Z",
          "2026-07-18T11:00:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO application_events
             (id, workspace_id, application_id, actor_user_id, event_type,
              from_status, to_status, occurred_at)
           VALUES (?, ?, ?, ?, 'application_created', NULL, 'applied', ?)`,
        )
        .run(
          "event-version-eight",
          "workspace-version-eight",
          applicationId,
          "user-version-eight",
          "2026-07-18T11:00:00.000Z",
        );

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            `SELECT applications.legacy_status AS legacyStatus,
                    reference_values.label AS status
             FROM applications
             JOIN reference_values
               ON reference_values.id = applications.status_reference_id
             WHERE applications.id = ?`,
          )
          .get(applicationId),
      ).toEqual({ legacyStatus: "applied", status: "Submitted" });
      expect(
        database
          .prepare(
            `SELECT from_status AS fromStatus, to_status AS toStatus
             FROM application_events WHERE application_id = ?`,
          )
          .get(applicationId),
      ).toEqual({ fromStatus: null, toStatus: "Applied" });
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("preserves audit events while extending the action allowlist", () => {
    const database = new Database(":memory:");

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, 12));
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES ('workspace-audit', 'Audit', 'audit', ?)`,
        )
        .run("2026-07-19T10:00:00.000Z");
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES ('user-audit', 'audit-user', 'Audit User', 'active', ?, ?)`,
        )
        .run("2026-07-19T10:00:00.000Z", "2026-07-19T10:00:00.000Z");
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES ('workspace-audit', 'user-audit', 'admin', ?)`,
        )
        .run("2026-07-19T10:00:00.000Z");
      database
        .prepare(
          `INSERT INTO mcp_audit_events
             (id, workspace_id, actor_user_id, transport, action, target_type,
              result, occurred_at)
           VALUES (
             'audit-event-1', 'workspace-audit', 'user-audit', 'local_stdio',
             'get_tracker_context', 'workspace', 'success', ?
           )`,
        )
        .run("2026-07-19T11:00:00.000Z");

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            "SELECT action, result FROM mcp_audit_events WHERE id = 'audit-event-1'",
          )
          .get(),
      ).toEqual({ action: "get_tracker_context", result: "success" });
      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_audit_events
               (id, workspace_id, actor_user_id, transport, action,
                target_type, result, occurred_at)
             VALUES (
               'audit-event-2', 'workspace-audit', 'user-audit',
               'local_stdio', 'create_application', 'application', 'success', ?
             )`,
          )
          .run("2026-07-19T12:00:00.000Z"),
      ).not.toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_audit_events
               (id, workspace_id, actor_user_id, transport, action,
                target_type, result, occurred_at)
             VALUES (
               'audit-event-3', 'workspace-audit', 'user-audit',
               'remote_http', 'complete_document_import', 'document',
               'success', ?
             )`,
          )
          .run("2026-07-19T12:01:00.000Z"),
      ).not.toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_audit_events
               (id, workspace_id, actor_user_id, transport, action,
                target_type, result, occurred_at)
             VALUES (
               'audit-event-4', 'workspace-audit', 'user-audit',
               'remote_http', 'extract_job_links', 'job_email', 'success', ?
             )`,
          )
          .run("2026-07-19T12:02:00.000Z"),
      ).not.toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_audit_events
               (id, workspace_id, actor_user_id, transport, action,
                target_type, result, occurred_at)
             VALUES (
               'audit-event-5', 'workspace-audit', 'user-audit',
               'remote_http', 'bulk_update_applications',
               'application_collection', 'success', ?
             )`,
          )
          .run("2026-07-19T12:03:00.000Z"),
      ).not.toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_audit_events
               (id, workspace_id, actor_user_id, transport, action,
                target_type, result, occurred_at)
             VALUES (
               'audit-event-6', 'workspace-audit', 'user-audit',
               'remote_http', 'get_connector_schema_status',
               'workspace', 'success', ?
             )`,
          )
          .run("2026-07-19T12:04:00.000Z"),
      ).not.toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_audit_events
               (id, workspace_id, actor_user_id, transport, action,
                target_type, result, occurred_at)
             VALUES (
               'audit-event-7', 'workspace-audit', 'user-audit',
               'remote_http', 'audit_duplicate_applications',
               'application_collection', 'success', ?
             )`,
          )
          .run("2026-07-19T12:05:00.000Z"),
      ).not.toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_audit_events
               (id, workspace_id, actor_user_id, transport, action,
                target_type, result, occurred_at)
             VALUES (
               'audit-event-8', 'workspace-audit', 'user-audit',
               'remote_http', 'merge_applications',
               'application', 'success', ?
             )`,
          )
          .run("2026-07-19T12:06:00.000Z"),
      ).not.toThrow();
      for (const [id, action, occurredAt] of [
        ["audit-event-9", "resolve_job_links", "2026-07-19T12:07:00.000Z"],
        ["audit-event-10", "inspect_job_posting", "2026-07-19T12:08:00.000Z"],
        [
          "audit-event-11",
          "sync_outlook_email_evidence",
          "2026-07-19T12:09:00.000Z",
        ],
        [
          "audit-event-12",
          "reconcile_outlook_graph_connection",
          "2026-07-19T12:10:00.000Z",
        ],
        [
          "audit-event-13",
          "process_outlook_job_digest",
          "2026-07-19T12:11:00.000Z",
        ],
        [
          "audit-event-14",
          "search_outlook_job_digests",
          "2026-07-19T12:12:00.000Z",
        ],
      ]) {
        expect(() =>
          database
            .prepare(
              `INSERT INTO mcp_audit_events
                 (id, workspace_id, actor_user_id, transport, action,
                  target_type, result, occurred_at)
               VALUES (
                 ?, 'workspace-audit', 'user-audit',
                 'remote_http', ?, 'job_email', 'success', ?
               )`,
            )
            .run(id, action, occurredAt),
        ).not.toThrow();
      }
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("creates constrained hash-only MCP client storage", () => {
    const database = new Database(":memory:");

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations);
      const tableSql = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_clients'",
        )
        .pluck()
        .get();
      expect(tableSql).toContain("token_hash TEXT NOT NULL");
      expect(tableSql).not.toContain("bearer_token");
      expect(tableSql).not.toContain("token_secret");
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'mcp_clients_by_workspace'",
          )
          .pluck()
          .get(),
      ).toBe("mcp_clients_by_workspace");
    } finally {
      database.close();
    }
  });

  it("creates hash-only storage for built-in MCP OAuth grants", () => {
    const database = new Database(":memory:");

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations);

      for (const table of [
        "mcp_oauth_clients",
        "mcp_oauth_authorization_codes",
        "mcp_oauth_tokens",
      ]) {
        expect(
          database
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .pluck()
            .get(table),
        ).toBe(table);
      }
      const codeSql = String(
        database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_oauth_authorization_codes'",
          )
          .pluck()
          .get(),
      );
      const tokenSql = String(
        database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_oauth_tokens'",
          )
          .pluck()
          .get(),
      );
      expect(codeSql).toContain("code_hash TEXT PRIMARY KEY");
      expect(tokenSql).toContain("token_hash TEXT NOT NULL UNIQUE");
      expect(`${codeSql}${tokenSql}`).not.toContain("access_token");
      expect(`${codeSql}${tokenSql}`).not.toContain("refresh_token");
    } finally {
      database.close();
    }
  });

  it("moves the previous workspace permission onto existing MCP connections", () => {
    const database = new Database(":memory:");
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    const timestamp = "2026-07-20T12:00:00.000Z";
    const bearerClientId = `atmcp_${"a".repeat(24)}`;
    const oauthClientId = `atoc_${"b".repeat(24)}`;

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, 17));
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES (?, 'Applications', 'default', ?)`,
        )
        .run(workspaceId, timestamp);
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES (?, 'alex', 'Alex Example', 'active', ?, ?)`,
        )
        .run(userId, timestamp, timestamp);
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'admin', ?)`,
        )
        .run(workspaceId, userId, timestamp);
      database
        .prepare(
          `INSERT INTO mcp_workspace_settings
             (workspace_id, access_mode, updated_by_user_id, updated_at)
           VALUES (?, 'read_write', ?, ?)`,
        )
        .run(workspaceId, userId, timestamp);
      database
        .prepare(
          `INSERT INTO mcp_clients
             (id, workspace_id, actor_user_id, name, token_hash,
              created_by_user_id, created_at)
           VALUES (?, ?, ?, 'Existing bearer', ?, ?, ?)`,
        )
        .run(
          bearerClientId,
          workspaceId,
          userId,
          "a".repeat(64),
          userId,
          timestamp,
        );
      database
        .prepare(
          `INSERT INTO mcp_oauth_clients
             (id, name, redirect_uris_json, created_at)
           VALUES (?, 'Claude', ?, ?)`,
        )
        .run(
          oauthClientId,
          JSON.stringify(["https://claude.ai/api/mcp/auth_callback"]),
          timestamp,
        );
      database
        .prepare(
          `INSERT INTO mcp_oauth_authorization_codes
             (code_hash, client_id, user_id, workspace_id, redirect_uri,
              code_challenge, resource, scope, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "b".repeat(64),
          oauthClientId,
          userId,
          workspaceId,
          "https://claude.ai/api/mcp/auth_callback",
          "c".repeat(43),
          "https://tracker.example/mcp",
          "application-tracker:tools",
          timestamp,
          "2026-07-20T12:05:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO mcp_oauth_tokens
             (id, token_hash, token_kind, family_id, client_id, user_id,
              workspace_id, resource, scope, issued_at, expires_at)
           VALUES (?, ?, 'access', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "token-01",
          "c".repeat(64),
          "family-1",
          oauthClientId,
          userId,
          workspaceId,
          "https://tracker.example/mcp",
          "application-tracker:tools",
          timestamp,
          "2026-07-20T12:15:00.000Z",
        );

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare("SELECT access_mode FROM mcp_clients WHERE id = ?")
          .pluck()
          .get(bearerClientId),
      ).toBe("read_write");
      expect(
        database
          .prepare(
            "SELECT access_mode FROM mcp_oauth_authorization_codes WHERE client_id = ?",
          )
          .pluck()
          .get(oauthClientId),
      ).toBe("read_write");
      expect(
        database
          .prepare(
            "SELECT access_mode FROM mcp_oauth_tokens WHERE client_id = ?",
          )
          .pluck()
          .get(oauthClientId),
      ).toBe("read_write");
    } finally {
      database.close();
    }
  });

  it("creates workspace-unique job posting and email evidence", () => {
    const database = new Database(":memory:");

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name IN (
               'application_job_postings',
               'application_email_evidence'
             )
             ORDER BY name`,
          )
          .pluck()
          .all(),
      ).toEqual(["application_email_evidence", "application_job_postings"]);
      expect(
        database
          .prepare("PRAGMA table_info(application_email_evidence)")
          .all()
          .find(
            (column) => (column as { name?: unknown }).name === "evidence_type",
          ),
      ).toMatchObject({
        dflt_value: "'other'",
        name: "evidence_type",
        notnull: 1,
        type: "TEXT",
      });
      const evidenceSql = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'application_email_evidence'",
        )
        .pluck()
        .get();
      expect(evidenceSql).toContain("'application_confirmation'");
      expect(evidenceSql).toContain("'interview_invitation'");
      expect(evidenceSql).toContain("'withdrawal'");
      const auditSql = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_audit_events'",
        )
        .pluck()
        .get();
      expect(auditSql).toContain("match_job_application_email");
      expect(auditSql).toContain("upsert_application_from_email");
      expect(auditSql).toContain("extract_job_links");
      expect(auditSql).toContain("resolve_job_links");
      expect(auditSql).toContain("inspect_job_posting");
      expect(auditSql).toContain("sync_outlook_email_evidence");
      expect(auditSql).toContain("reconcile_outlook_graph_connection");
      expect(auditSql).toContain("search_outlook_job_digests");
      expect(auditSql).toContain("process_outlook_job_digest");
      expect(auditSql).toContain("job_email");
    } finally {
      database.close();
    }
  });

  it("classifies legacy email evidence as other during migration", () => {
    const database = new Database(":memory:");

    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, -1));
      const setup = new SqliteSetupRepository(
        database,
      ).createInitialAdministrator({
        completedAt: "2026-07-31T06:00:00.000Z",
        displayName: "Alex Example",
        passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
        username: "alex",
        workspaceName: "Applications",
      });
      const actor = new LocalMcpActorProvider(
        new SqliteMcpActorRepository(database),
        { username: "alex", workspaceSlug: "default" },
      ).getActor();
      const statusId = database
        .prepare(
          `SELECT id FROM reference_values
           WHERE workspace_id = ? AND category = 'status' AND label = 'Applied'`,
        )
        .pluck()
        .get(setup.workspace.id);
      if (typeof statusId !== "string") {
        throw new Error("Expected the default Applied status");
      }
      const applicationId = "legacy-application";
      database
        .prepare(
          `INSERT INTO applications (
             id, workspace_id, agency, company_name, role_title, legacy_status,
             status_reference_id, source_reference_id, role_type_reference_id,
             location, source_url, applied_on, next_action, next_action_due,
             notes, rating, salary, work_arrangement, created_by_user_id,
             created_at, updated_at
           ) VALUES (
             ?, ?, NULL, 'Legacy Evidence Ltd', 'Platform Engineer',
             'prospect', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             NULL, NULL, NULL, ?, ?, ?
           )`,
        )
        .run(
          applicationId,
          setup.workspace.id,
          statusId,
          actor.userId,
          "2026-07-31T06:05:00.000Z",
          "2026-07-31T06:05:00.000Z",
        );
      database
        .prepare(
          `INSERT INTO application_email_evidence
             (id, workspace_id, application_id, message_id, web_url,
              received_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          "legacy-evidence",
          setup.workspace.id,
          applicationId,
          "<legacy@example.com>",
          "2026-07-31T05:45:00.000Z",
          "2026-07-31T06:06:00.000Z",
          "2026-07-31T06:06:00.000Z",
        );

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            "SELECT evidence_type FROM application_email_evidence WHERE id = ?",
          )
          .pluck()
          .get("legacy-evidence"),
      ).toBe("other");
      expect(() =>
        database
          .prepare(
            "UPDATE application_email_evidence SET evidence_type = 'invalid' WHERE id = ?",
          )
          .run("legacy-evidence"),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("preserves legacy event content and row ordering in the activity migration", () => {
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      migrateDatabase(database, applicationMigrations.slice(0, 35));
      const setup = new SqliteSetupRepository(
        database,
      ).createInitialAdministrator({
        completedAt: "2026-07-31T07:00:00.000Z",
        displayName: "Alex Example",
        passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
        username: "alex",
        workspaceName: "Applications",
      });
      const statusId = database
        .prepare(
          `SELECT id FROM reference_values
           WHERE workspace_id = ? AND category = 'status' AND label = 'Applied'`,
        )
        .pluck()
        .get(setup.workspace.id);
      if (typeof statusId !== "string") throw new Error("Missing status");
      database
        .prepare(
          `INSERT INTO applications (
             id, workspace_id, agency, company_name, role_title, legacy_status,
             status_reference_id, source_reference_id, role_type_reference_id,
             location, source_url, applied_on, next_action, next_action_due,
             notes, rating, salary, work_arrangement, created_by_user_id,
             created_at, updated_at
           ) VALUES (
             'legacy-application', ?, NULL, 'Legacy Ltd', 'Engineer',
             'prospect', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             NULL, NULL, NULL, ?, ?, ?
           )`,
        )
        .run(
          setup.workspace.id,
          statusId,
          setup.administrator.id,
          "2026-07-31T07:00:00.000Z",
          "2026-07-31T07:00:00.000Z",
        );
      const insertEvent = database.prepare(
        `INSERT INTO application_events (
           id, workspace_id, application_id, actor_user_id, event_type,
           from_status, to_status, occurred_at, processed_at,
           source_email_message_id, status_override_reason
         ) VALUES (?, ?, 'legacy-application', ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertEvent.run(
        "legacy-event-one",
        setup.workspace.id,
        setup.administrator.id,
        "application_created",
        null,
        "Prospect",
        "2026-07-31T07:00:00.000Z",
        "2026-07-31T07:00:01.000Z",
        null,
        null,
      );
      insertEvent.run(
        "legacy-event-two",
        setup.workspace.id,
        setup.administrator.id,
        "status_changed",
        "Prospect",
        "Applied",
        "2026-07-31T07:00:00.000Z",
        "2026-07-31T07:00:02.000Z",
        "<applied@example.com>",
        "Verified correction",
      );

      migrateDatabase(database, applicationMigrations);

      expect(
        database
          .prepare(
            `SELECT id, event_type AS type, from_status AS fromStatus,
                    to_status AS toStatus, occurred_at AS occurredAt,
                    processed_at AS processedAt,
                    source_email_message_id AS sourceEmailMessageId,
                    status_override_reason AS statusOverrideReason
             FROM application_events
             WHERE application_id = 'legacy-application'
             ORDER BY occurred_at DESC, sequence DESC`,
          )
          .all(),
      ).toEqual([
        {
          fromStatus: "Prospect",
          id: "legacy-event-two",
          occurredAt: "2026-07-31T07:00:00.000Z",
          processedAt: "2026-07-31T07:00:02.000Z",
          sourceEmailMessageId: "<applied@example.com>",
          statusOverrideReason: "Verified correction",
          toStatus: "Applied",
          type: "status_changed",
        },
        {
          fromStatus: null,
          id: "legacy-event-one",
          occurredAt: "2026-07-31T07:00:00.000Z",
          processedAt: "2026-07-31T07:00:01.000Z",
          sourceEmailMessageId: null,
          statusOverrideReason: null,
          toStatus: "Prospect",
          type: "application_created",
        },
      ]);
      const auditSql = String(
        database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_audit_events'",
          )
          .pluck()
          .get(),
      );
      expect(auditSql).toContain("list_application_events");
      expect(auditSql).toContain("add_application_activity");
    } finally {
      database.close();
    }
  });
});
