import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  createVerifiedBackup,
  restoreVerifiedBackup,
  verifyDatabaseArtifact,
} from "./backup_restore.js";
import { openApplicationDatabase } from "./connection.js";
import { applicationMigrations, migrateDatabase } from "./migrations.js";
import { SqliteSetupRepository } from "./setup_repository.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "application-tracker-backup-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createPopulatedDatabase(databasePath: string) {
  const database = openApplicationDatabase(databasePath);
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-18T22:00:00.000Z",
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  return { database, setup };
}

describe("SQLite backup and restore", () => {
  it("creates and verifies an online backup while the WAL database is open", async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "live.sqlite");
    const backupPath = join(directory, "backups", "snapshot.sqlite");
    const { database, setup } = createPopulatedDatabase(databasePath);

    try {
      const report = await createVerifiedBackup(database, backupPath);

      expect(report).toMatchObject({
        applicationSchemaVersion: 24,
        path: backupPath,
        requiresMigration: false,
        schemaVersion: 24,
      });
      expect(report.bytes).toBeGreaterThan(0);
      expect(report.pages).toBeGreaterThan(0);
      expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(lstatSync(backupPath).mode & 0o777).toBe(0o600);

      const backup = new Database(backupPath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        expect(
          backup
            .prepare("SELECT name FROM workspaces WHERE id = ?")
            .pluck()
            .get(setup.workspace.id),
        ).toBe("Applications");
      } finally {
        backup.close();
      }
    } finally {
      database.close();
    }
  });

  it("leaves no SQLite sidecars beside created or verified artifacts", async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "live.sqlite");
    const backupDirectory = join(directory, "backups");
    const backupPath = join(backupDirectory, "snapshot.sqlite");
    const { database } = createPopulatedDatabase(databasePath);

    try {
      await createVerifiedBackup(database, backupPath);
    } finally {
      database.close();
    }

    expect(readdirSync(backupDirectory)).toEqual(["snapshot.sqlite"]);

    await verifyDatabaseArtifact(backupPath);

    expect(readdirSync(backupDirectory)).toEqual(["snapshot.sqlite"]);
  });

  it("does not delete sidecar paths that existed before verification", async () => {
    const directory = temporaryDirectory();
    const corruptPath = join(directory, "corrupt.sqlite");
    const sharedMemoryPath = `${corruptPath}-shm`;
    const writeAheadLogPath = `${corruptPath}-wal`;
    writeFileSync(corruptPath, "not a sqlite database");
    writeFileSync(sharedMemoryPath, "keep shared memory");
    writeFileSync(writeAheadLogPath, "keep write-ahead log");

    await expect(verifyDatabaseArtifact(corruptPath)).rejects.toThrow(
      "Database verification failed",
    );

    expect(() => lstatSync(sharedMemoryPath)).not.toThrow();
    expect(() => lstatSync(writeAheadLogPath)).not.toThrow();
  });

  it("restores a verified backup into a new database and verifies the result", async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "live.sqlite");
    const backupPath = join(directory, "snapshot.sqlite");
    const restorePath = join(
      directory,
      "restore",
      "application-tracker.sqlite",
    );
    const { database, setup } = createPopulatedDatabase(databasePath);

    try {
      await createVerifiedBackup(database, backupPath);
    } finally {
      database.close();
    }

    const report = await restoreVerifiedBackup(backupPath, restorePath);

    expect(report).toMatchObject({
      applicationSchemaVersion: 24,
      path: restorePath,
      requiresMigration: false,
      schemaVersion: 24,
    });
    expect(lstatSync(restorePath).mode & 0o777).toBe(0o600);
    expect(
      readdirSync(directory).filter((entry) =>
        entry.startsWith("snapshot.sqlite-"),
      ),
    ).toEqual([]);
    expect(readdirSync(join(directory, "restore"))).toEqual([
      "application-tracker.sqlite",
    ]);

    const restored = new Database(restorePath, {
      fileMustExist: true,
      readonly: true,
    });
    try {
      expect(
        restored
          .prepare("SELECT username FROM users WHERE id = ?")
          .pluck()
          .get(setup.administrator.id),
      ).toBe("alex");
    } finally {
      restored.close();
    }
  });

  it("refuses to overwrite a backup or restore destination", async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "live.sqlite");
    const destinationPath = join(directory, "existing.sqlite");
    const { database } = createPopulatedDatabase(databasePath);
    writeFileSync(destinationPath, "keep this file");

    try {
      await expect(
        createVerifiedBackup(database, destinationPath),
      ).rejects.toThrow("Destination already exists");
    } finally {
      database.close();
    }
    expect(readFileSync(destinationPath, "utf8")).toBe("keep this file");

    await expect(
      restoreVerifiedBackup(databasePath, destinationPath),
    ).rejects.toThrow("Destination already exists");
    expect(readFileSync(destinationPath, "utf8")).toBe("keep this file");

    const symlinkPath = join(directory, "linked.sqlite");
    symlinkSync(destinationPath, symlinkPath);
    const source = new Database(databasePath, {
      fileMustExist: true,
      readonly: true,
    });
    try {
      await expect(createVerifiedBackup(source, symlinkPath)).rejects.toThrow(
        "Destination already exists",
      );
    } finally {
      source.close();
    }
  });

  it("rejects corrupted files and databases with foreign-key violations", async () => {
    const directory = temporaryDirectory();
    const corruptPath = join(directory, "corrupt.sqlite");
    writeFileSync(corruptPath, "not a sqlite database");

    await expect(verifyDatabaseArtifact(corruptPath)).rejects.toThrow(
      "Database verification failed",
    );
    expect(() => lstatSync(`${corruptPath}-shm`)).toThrow();
    expect(() => lstatSync(`${corruptPath}-wal`)).toThrow();

    const invalidPath = join(directory, "invalid.sqlite");
    const { database } = createPopulatedDatabase(invalidPath);
    database.pragma("foreign_keys = OFF");
    database
      .prepare(
        `INSERT INTO workspace_memberships
           (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'member', ?)`,
      )
      .run("missing-workspace", "missing-user", "2026-07-18T22:10:00.000Z");
    database.close();

    await expect(verifyDatabaseArtifact(invalidPath)).rejects.toThrow(
      "Database foreign-key verification failed",
    );
  });

  it("rejects migration history that does not match this release", async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "drifted.sqlite");
    const { database } = createPopulatedDatabase(databasePath);
    database
      .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 9")
      .run("0".repeat(64));
    database.close();

    await expect(verifyDatabaseArtifact(databasePath)).rejects.toThrow(
      "Migration drift detected for version 9",
    );
  });

  it("accepts a valid older schema and reports that migration is required", async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "older.sqlite");
    const database = new Database(databasePath);
    migrateDatabase(database, applicationMigrations.slice(0, 8));
    database.close();

    await expect(verifyDatabaseArtifact(databasePath)).resolves.toMatchObject({
      applicationSchemaVersion: 24,
      requiresMigration: true,
      schemaVersion: 8,
    });
  });
});
