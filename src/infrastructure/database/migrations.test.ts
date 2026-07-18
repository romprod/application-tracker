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
      ).toEqual([1, 2]);
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
});
