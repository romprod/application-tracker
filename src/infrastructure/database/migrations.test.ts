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
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
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
});
