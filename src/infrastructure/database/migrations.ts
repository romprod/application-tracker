import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { workspaceIdentityMigration } from "./migrations/001_workspace_identity.js";
import { installationStateMigration } from "./migrations/002_installation_state.js";
import { applicationLedgerMigration } from "./migrations/003_application_ledger.js";
import { applicationHistoryMigration } from "./migrations/004_application_history.js";
import { applicationNextActionsMigration } from "./migrations/005_application_next_actions.js";

export interface Migration {
  name: string;
  sql: string;
  version: number;
}

interface AppliedMigration {
  checksum: string;
  name: string;
  version: number;
}

export const applicationMigrations: readonly Migration[] = [
  workspaceIdentityMigration,
  installationStateMigration,
  applicationLedgerMigration,
  applicationHistoryMigration,
  applicationNextActionsMigration,
];

const createMigrationTable = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL CHECK (length(checksum) = 64),
    applied_at TEXT NOT NULL
  ) STRICT;
`;

function migrationChecksum(migration: Migration): string {
  return createHash("sha256")
    .update(String(migration.version))
    .update("\0")
    .update(migration.name)
    .update("\0")
    .update(migration.sql)
    .digest("hex");
}

function validateMigrationPlan(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration plan must contain version ${String(expectedVersion)} in order`,
      );
    }

    if (!/^[a-z][a-z0-9_]*$/.test(migration.name)) {
      throw new Error(
        `Migration ${String(migration.version)} has an invalid name`,
      );
    }
  });
}

export function migrateDatabase(
  database: Database.Database,
  migrations: readonly Migration[] = applicationMigrations,
): void {
  validateMigrationPlan(migrations);
  database.exec(createMigrationTable);

  const appliedMigrations = database
    .prepare(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    )
    .all() as AppliedMigration[];

  for (const applied of appliedMigrations) {
    const migration = migrations.find(
      (candidate) => candidate.version === applied.version,
    );

    if (!migration) {
      throw new Error(
        `Database migration version ${String(applied.version)} is newer than this application`,
      );
    }

    const checksum = migrationChecksum(migration);
    if (migration.name !== applied.name || checksum !== applied.checksum) {
      throw new Error(
        `Migration drift detected for version ${String(applied.version)}`,
      );
    }
  }

  const insertMigration = database.prepare(
    `INSERT INTO schema_migrations (version, name, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  );
  const applyMigration = database.transaction(
    (migration: Migration, checksum: string) => {
      database.exec(migration.sql);
      insertMigration.run(
        migration.version,
        migration.name,
        checksum,
        new Date().toISOString(),
      );
    },
  );
  const appliedVersions = new Set(
    appliedMigrations.map((migration) => migration.version),
  );

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration.immediate(migration, migrationChecksum(migration));
    }
  }
}
