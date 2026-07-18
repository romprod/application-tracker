import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

import { AuthService } from "../application/auth.js";
import { SetupService } from "../application/setup.js";
import { UserAdministrationService } from "../application/users.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { StaticSetupTokenVerifier } from "../infrastructure/auth/setup_token_verifier.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { SqliteUsersRepository } from "../infrastructure/database/users_repository.js";
import { createApp } from "./app.js";
import { parseRuntimeConfig } from "./config.js";

const environmentPath = resolve(process.cwd(), ".env");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}

const config = parseRuntimeConfig(process.env);
const database = openApplicationDatabase(config.databasePath);
const passwordHasher = new ScryptPasswordHasher();
const setupService = new SetupService(
  new SqliteSetupRepository(database),
  passwordHasher,
  new StaticSetupTokenVerifier(config.setupToken),
);
const dummyPasswordHash = await passwordHasher.hash(
  randomBytes(32).toString("base64url"),
);
const authService = new AuthService(
  new SqliteAuthRepository(database),
  passwordHasher,
  new CryptoSessionTokenManager(),
  {
    absoluteDurationMs: config.session.absoluteDurationMs,
    dummyPasswordHash,
    idleDurationMs: config.session.idleDurationMs,
    refreshIntervalMs: config.session.refreshIntervalMs,
  },
);
const usersService = new UserAdministrationService(
  new SqliteUsersRepository(database),
  passwordHasher,
);
const staticRoot =
  config.nodeEnv === "production"
    ? resolve(process.cwd(), "dist/client")
    : undefined;
const app = createApp({
  authCookie: {
    maxAgeSeconds: config.session.absoluteDurationMs / 1000,
    secure: config.session.cookieSecure,
  },
  authService,
  setupService,
  usersService,
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
