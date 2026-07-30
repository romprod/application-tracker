import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ApplicationLedgerService } from "../application/applications.js";
import { DocumentLibraryService } from "../application/documents.js";
import { EmailLinkExtractionService } from "../application/email_links.js";
import {
  ApplicationMcpService,
  LocalMcpActorProvider,
} from "../application/mcp.js";
import { McpDocumentImportManager } from "../application/mcp_document_imports.js";
import { McpConnectionAccessPolicy } from "../application/mcp_access.js";
import { McpAuditService } from "../application/mcp_audit.js";
import { JobEmailReconciliationService } from "../application/job_email_reconciliation.js";
import { JobPostingInspectionService } from "../application/job_posting_inspection.js";
import { OutlookEmailSyncService } from "../application/outlook_email_sync.js";
import { OutlookConnectionReconciliationService } from "../application/outlook_connection_reconciliation.js";
import { OutlookJobDigestProcessingService } from "../application/outlook_job_digest.js";
import { OutlookGraphConnectionsService } from "../application/outlook_graph_connections.js";
import { ReferenceValuesService } from "../application/reference_values.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { SqliteDocumentsRepository } from "../infrastructure/database/documents_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteMcpActorRepository } from "../infrastructure/database/mcp_actor_repository.js";
import { SqliteMcpAuditRepository } from "../infrastructure/database/mcp_audit_repository.js";
import { SqliteJobEmailReconciliationRepository } from "../infrastructure/database/job_email_reconciliation_repository.js";
import { SqliteReferenceValuesRepository } from "../infrastructure/database/reference_values_repository.js";
import { SqliteOutlookGraphConnectionsRepository } from "../infrastructure/database/outlook_graph_connections_repository.js";
import { AesGcmOutlookGraphSecretCipher } from "../infrastructure/auth/outlook_graph_secret_cipher.js";
import { MicrosoftGraphOutlookConnectionAdapter } from "../infrastructure/microsoft_graph_outlook_mail.js";
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
    const initialActor = actorProvider.getActor();
    const applicationsService = new ApplicationLedgerService(
      new SqliteApplicationsRepository(database),
    );
    const emailLinksService = new EmailLinkExtractionService();
    const jobPostingInspectionService = new JobPostingInspectionService();
    const jobEmailReconciliationService = new JobEmailReconciliationService(
      new SqliteJobEmailReconciliationRepository(database),
      applicationsService,
      (operation) => database.transaction(operation).immediate(),
    );
    const outlookGraphConnectionsService = config.outlookConnectionEncryptionKey
      ? new OutlookGraphConnectionsService(
          new SqliteOutlookGraphConnectionsRepository(database),
          new AesGcmOutlookGraphSecretCipher(
            Buffer.from(config.outlookConnectionEncryptionKey, "hex"),
          ),
          new MicrosoftGraphOutlookConnectionAdapter(),
        )
      : undefined;
    const outlookEmailSyncService = outlookGraphConnectionsService
      ? new OutlookEmailSyncService(
          applicationsService,
          jobEmailReconciliationService,
          emailLinksService,
          outlookGraphConnectionsService,
        )
      : undefined;
    const outlookConnectionReconciliationService =
      outlookGraphConnectionsService && outlookEmailSyncService
        ? new OutlookConnectionReconciliationService(
            applicationsService,
            jobEmailReconciliationService,
            outlookEmailSyncService,
            outlookGraphConnectionsService,
          )
        : undefined;
    const outlookJobDigestProcessingService = outlookGraphConnectionsService
      ? new OutlookJobDigestProcessingService(
          outlookGraphConnectionsService,
          jobEmailReconciliationService,
          emailLinksService,
          undefined,
          jobPostingInspectionService,
        )
      : undefined;
    const tools = new ApplicationMcpService(
      actorProvider,
      applicationsService,
      new ReferenceValuesService(new SqliteReferenceValuesRepository(database)),
      new McpConnectionAccessPolicy(config.mcp.local.accessMode),
      new DocumentLibraryService(
        new SqliteDocumentsRepository(database, config.documents),
        config.documents,
      ),
      new McpDocumentImportManager(config.documents.maxUploadBytes),
      emailLinksService,
      jobEmailReconciliationService,
      outlookEmailSyncService,
      outlookConnectionReconciliationService,
      outlookJobDigestProcessingService,
      undefined,
      undefined,
      jobPostingInspectionService,
    );
    const auditService = new McpAuditService(
      new SqliteMcpAuditRepository(database),
    );
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: initialActor.userId,
        recorder: auditService,
        runAtomically: (operation) =>
          database.transaction(operation).immediate(),
        workspaceId: initialActor.workspaceId,
      },
      logger,
    });
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
