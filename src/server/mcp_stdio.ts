import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ApplicationLedgerService } from "../application/applications.js";
import {
  LocalMcpActorProvider,
  LocalMcpReadService,
} from "../application/mcp.js";
import { ReferenceValuesService } from "../application/reference_values.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteMcpActorRepository } from "../infrastructure/database/mcp_actor_repository.js";
import { SqliteReferenceValuesRepository } from "../infrastructure/database/reference_values_repository.js";
import { parseRuntimeConfig } from "./config.js";
import { createJsonLogger } from "./logging.js";
import { createLocalMcpServer } from "./mcp_server.js";

const stderrDestination = {
  error: (line: string) => console.error(line),
  info: (line: string) => console.error(line),
};
const logger = createJsonLogger({ destination: stderrDestination });

async function startLocalMcpServer(): Promise<void> {
  const environmentPath = resolve(process.cwd(), ".env");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

  const config = parseRuntimeConfig(process.env);
  if (!config.mcp.local) {
    throw new Error("Local MCP actor and workspace context are required");
  }

  const database = openApplicationDatabase(config.databasePath);
  try {
    const actorProvider = new LocalMcpActorProvider(
      new SqliteMcpActorRepository(database),
      {
        username: config.mcp.local.actorUsername,
        workspaceSlug: config.mcp.local.workspaceSlug,
      },
    );
    actorProvider.getActor();
    const tools = new LocalMcpReadService(
      actorProvider,
      new ApplicationLedgerService(new SqliteApplicationsRepository(database)),
      new ReferenceValuesService(new SqliteReferenceValuesRepository(database)),
    );
    const server = createLocalMcpServer(tools, logger);
    let cleanedUp = false;

    function cleanup(): void {
      if (cleanedUp) return;
      cleanedUp = true;
      if (database.open) database.close();
      logger.info("mcp_stdio_stopped");
    }

    server.server.onerror = (error) => {
      logger.error("mcp_protocol_failed", { error });
    };
    server.server.oninitialized = () => {
      logger.info("mcp_stdio_initialized");
    };
    server.server.onclose = cleanup;

    async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
      logger.info("mcp_stdio_stopping", { signal });
      try {
        await server.close();
      } catch (error) {
        logger.error("mcp_stdio_stop_failed", { error, signal });
        process.exitCode = 1;
        cleanup();
      }
    }

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    await server.connect(new StdioServerTransport());
    logger.info("mcp_stdio_started");
  } catch (error) {
    if (database.open) database.close();
    throw error;
  }
}

void startLocalMcpServer().catch((error: unknown) => {
  logger.error("mcp_stdio_start_failed", { error });
  process.exitCode = 1;
});
