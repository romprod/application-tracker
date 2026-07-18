import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import { migrateDatabase } from "./migrations.js";

const memoryDatabasePath = ":memory:";

export function openApplicationDatabase(
  configuredPath: string,
): Database.Database {
  const isMemoryDatabase = configuredPath === memoryDatabasePath;
  const databasePath = isMemoryDatabase
    ? memoryDatabasePath
    : resolve(configuredPath);

  if (!isMemoryDatabase) {
    mkdirSync(dirname(databasePath), { mode: 0o700, recursive: true });
  }

  const database = new Database(databasePath);

  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.pragma("synchronous = NORMAL");

    if (!isMemoryDatabase) {
      chmodSync(databasePath, 0o600);
      database.pragma("journal_mode = WAL");
    }

    if (database.pragma("foreign_keys", { simple: true }) !== 1) {
      throw new Error("SQLite foreign key enforcement is unavailable");
    }

    migrateDatabase(database);

    if (!isMemoryDatabase) {
      chmodSync(databasePath, 0o600);
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
