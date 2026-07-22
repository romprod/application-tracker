import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  applicationMigrations,
  migrateDatabase,
  type Migration,
} from "./migrations.js";
import { workspaceIdentityMigration } from "./migrations/001_workspace_identity.js";

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
        21,
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
      const auditSql = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_audit_events'",
        )
        .pluck()
        .get();
      expect(auditSql).toContain("match_job_application_email");
      expect(auditSql).toContain("upsert_application_from_email");
      expect(auditSql).toContain("extract_job_links");
      expect(auditSql).toContain("job_email");
    } finally {
      database.close();
    }
  });
});
