import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

import { verifyMigrationHistory } from "./migrations.js";

export interface VerifiedDatabaseArtifact {
  applicationSchemaVersion: number;
  bytes: number;
  path: string;
  requiresMigration: boolean;
  schemaVersion: number;
  sha256: string;
}

export interface BackupReport extends VerifiedDatabaseArtifact {
  pages: number;
}

function destinationExists(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

function prepareDestination(configuredPath: string): {
  destinationPath: string;
  temporaryPath: string;
} {
  const destinationPath = resolve(configuredPath);
  if (destinationExists(destinationPath)) {
    throw new Error(`Destination already exists: ${destinationPath}`);
  }
  const destinationDirectory = dirname(destinationPath);
  mkdirSync(destinationDirectory, { mode: 0o700, recursive: true });
  const temporaryPath = join(
    destinationDirectory,
    `.${basename(destinationPath)}.partial-${randomUUID()}`,
  );
  return { destinationPath, temporaryPath };
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path) as AsyncIterable<Buffer>;
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function verificationFailure(message: string): Error {
  return new Error(message);
}

function transientSqliteSidecars(path: string): string[] {
  return [`${path}-shm`, `${path}-wal`].filter(
    (sidecarPath) => !destinationExists(sidecarPath),
  );
}

function removeTransientSqliteSidecars(sidecarPaths: string[]): void {
  try {
    for (const sidecarPath of sidecarPaths) {
      rmSync(sidecarPath, { force: true });
    }
  } catch {
    throw verificationFailure("Database verification cleanup failed");
  }
}

async function withReadonlyDatabaseArtifact<T>(
  configuredPath: string,
  operation: (database: Database.Database, path: string) => Promise<T>,
  openFailureMessage?: string,
): Promise<T> {
  const path = resolve(configuredPath);
  const sidecarsToCleanup = transientSqliteSidecars(path);
  try {
    let database: Database.Database;
    try {
      database = new Database(path, { fileMustExist: true, readonly: true });
    } catch (error) {
      if (openFailureMessage) {
        throw verificationFailure(openFailureMessage);
      }
      throw error;
    }

    try {
      return await operation(database, path);
    } finally {
      database.close();
    }
  } finally {
    removeTransientSqliteSidecars(sidecarsToCleanup);
  }
}

export async function verifyDatabaseArtifact(
  configuredPath: string,
): Promise<VerifiedDatabaseArtifact> {
  return withReadonlyDatabaseArtifact(
    configuredPath,
    async (database, path) => {
      try {
        database.pragma("query_only = ON");
        const integrity = database
          .prepare("PRAGMA integrity_check")
          .pluck()
          .all() as string[];
        if (integrity.length !== 1 || integrity[0] !== "ok") {
          throw verificationFailure("Database integrity verification failed");
        }
        const foreignKeyViolations = database
          .prepare("PRAGMA foreign_key_check")
          .all();
        if (foreignKeyViolations.length > 0) {
          throw verificationFailure("Database foreign-key verification failed");
        }
        const history = verifyMigrationHistory(database);
        const { size: bytes } = statSync(path);
        return {
          applicationSchemaVersion: history.applicationSchemaVersion,
          bytes,
          path,
          requiresMigration: history.requiresMigration,
          schemaVersion: history.schemaVersion,
          sha256: await fileSha256(path),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.startsWith("Database integrity verification failed") ||
            error.message.startsWith(
              "Database foreign-key verification failed",
            ) ||
            error.message.startsWith("Database migration history") ||
            error.message.startsWith("Database migration version") ||
            error.message.startsWith("Migration drift detected"))
        ) {
          throw error;
        }
        throw verificationFailure("Database verification failed");
      }
    },
    "Database verification failed",
  );
}

async function writeVerifiedCopy(
  source: Database.Database,
  configuredDestinationPath: string,
): Promise<BackupReport> {
  const { destinationPath, temporaryPath } = prepareDestination(
    configuredDestinationPath,
  );
  let published = false;
  try {
    closeSync(openSync(temporaryPath, "wx", 0o600));
    const metadata = await source.backup(temporaryPath);
    chmodSync(temporaryPath, 0o600);
    const verification = await verifyDatabaseArtifact(temporaryPath);
    try {
      linkSync(temporaryPath, destinationPath);
    } catch (error) {
      if (destinationExists(destinationPath)) {
        throw new Error(`Destination already exists: ${destinationPath}`, {
          cause: error,
        });
      }
      throw error;
    }
    published = true;
    chmodSync(destinationPath, 0o600);
    rmSync(temporaryPath);
    return {
      ...verification,
      path: destinationPath,
      pages: metadata.totalPages,
    };
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (published) rmSync(destinationPath, { force: true });
    throw error;
  }
}

export async function createVerifiedBackup(
  source: Database.Database,
  destinationPath: string,
): Promise<BackupReport> {
  return writeVerifiedCopy(source, destinationPath);
}

export async function restoreVerifiedBackup(
  sourcePath: string,
  destinationPath: string,
): Promise<BackupReport> {
  await verifyDatabaseArtifact(sourcePath);
  return withReadonlyDatabaseArtifact(sourcePath, (source) =>
    writeVerifiedCopy(source, destinationPath),
  );
}
