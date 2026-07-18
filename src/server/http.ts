import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ApplicationLedgerService } from "../application/applications.js";
import { AuthService } from "../application/auth.js";
import { McpStatusService } from "../application/mcp_status.js";
import { ReferenceValuesService } from "../application/reference_values.js";
import { SetupService } from "../application/setup.js";
import { UserAdministrationService } from "../application/users.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { StaticSetupTokenVerifier } from "../infrastructure/auth/setup_token_verifier.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteReferenceValuesRepository } from "../infrastructure/database/reference_values_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { SqliteUsersRepository } from "../infrastructure/database/users_repository.js";
import { createApp } from "./app.js";
import { parseRuntimeConfig } from "./config.js";
import { createJsonLogger } from "./logging.js";

const logger = createJsonLogger();

async function startApplication(): Promise<void> {
  const environmentPath = resolve(process.cwd(), ".env");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

  const config = parseRuntimeConfig(process.env);
  const database = openApplicationDatabase(config.databasePath);

  try {
    const applicationsService = new ApplicationLedgerService(
      new SqliteApplicationsRepository(database),
    );
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
    const referenceValuesService = new ReferenceValuesService(
      new SqliteReferenceValuesRepository(database),
    );
    const mcpStatusService = new McpStatusService(config.mcp.session);
    const staticRoot =
      config.nodeEnv === "production"
        ? resolve(process.cwd(), "dist/client")
        : undefined;
    const app = createApp({
      applicationsService,
      authCookie: {
        maxAgeSeconds: config.session.absoluteDurationMs / 1000,
        secure: config.session.cookieSecure,
      },
      authService,
      logger,
      mcpStatusService,
      referenceValuesService,
      setupService,
      usersService,
      ...(staticRoot ? { staticRoot } : {}),
    });

    const server = app.listen(config.port, config.host, () => {
      logger.info("application_started", {
        bind: config.host === "0.0.0.0" ? "all_interfaces" : "configured",
        port: config.port,
      });
    });
    let shuttingDown = false;

    server.once("error", (error) => {
      logger.error("http_server_failed", { error });
      if (database.open) database.close();
      process.exitCode = 1;
    });

    function shutdown(signal: "SIGINT" | "SIGTERM"): void {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("application_stopping", { signal });
      server.close((error) => {
        if (database.open) database.close();
        if (error) {
          logger.error("application_stop_failed", { error, signal });
          process.exitCode = 1;
          return;
        }
        logger.info("application_stopped", { signal });
      });
    }

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    if (database.open) database.close();
    throw error;
  }
}

void startApplication().catch((error: unknown) => {
  logger.error("application_start_failed", { error });
  process.exitCode = 1;
});
