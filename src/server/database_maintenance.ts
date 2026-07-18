import { existsSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

import {
  createVerifiedBackup,
  restoreVerifiedBackup,
  verifyDatabaseArtifact,
} from "../infrastructure/database/backup_restore.js";
import { parseRuntimeConfig } from "./config.js";
import { parseDatabaseMaintenanceArguments } from "./database_maintenance_arguments.js";
import { createJsonLogger } from "./logging.js";

const logger = createJsonLogger();

const environmentPath = resolve(process.cwd(), ".env");
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

function timestampedBackupPath(directory: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return resolve(directory, `application-tracker-${timestamp}.sqlite`);
}

async function main(): Promise<void> {
  const request = parseDatabaseMaintenanceArguments(process.argv.slice(2));
  const config = parseRuntimeConfig(process.env);

  if (request.command === "verify") {
    console.info(JSON.stringify(await verifyDatabaseArtifact(request.input)));
    return;
  }
  if (request.command === "restore") {
    console.info(
      JSON.stringify(
        await restoreVerifiedBackup(request.input, request.output),
      ),
    );
    return;
  }
  if (config.databasePath === ":memory:") {
    throw new Error("The backup command requires a file-backed database");
  }

  const source = new Database(resolve(config.databasePath), {
    fileMustExist: true,
    readonly: true,
  });
  try {
    source.pragma("busy_timeout = 5000");
    const output =
      request.output ?? timestampedBackupPath(config.backupDirectory);
    console.info(JSON.stringify(await createVerifiedBackup(source, output)));
  } finally {
    source.close();
  }
}

void main().catch((error: unknown) => {
  logger.error("database_maintenance_failed", { error });
  process.exitCode = 1;
});
