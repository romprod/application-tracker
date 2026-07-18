import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { SetupService } from "../application/setup.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { StaticSetupTokenVerifier } from "../infrastructure/auth/setup_token_verifier.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { createApp } from "./app.js";
import { parseRuntimeConfig } from "./config.js";

const environmentPath = resolve(process.cwd(), ".env");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}

const config = parseRuntimeConfig(process.env);
const database = openApplicationDatabase(config.databasePath);
const setupService = new SetupService(
  new SqliteSetupRepository(database),
  new ScryptPasswordHasher(),
  new StaticSetupTokenVerifier(config.setupToken),
);
const staticRoot =
  config.nodeEnv === "production"
    ? resolve(process.cwd(), "dist/client")
    : undefined;
const app = createApp({
  setupService,
  ...(staticRoot ? { staticRoot } : {}),
});

const server = app.listen(config.port, config.host, () => {
  console.info(
    `Application Tracker listening on http://${config.host}:${String(config.port)}`,
  );
});

function shutdown(signal: string): void {
  console.info(`Received ${signal}; stopping Application Tracker`);
  server.close((error) => {
    database.close();
    if (error) {
      console.error("Application Tracker did not stop cleanly", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
