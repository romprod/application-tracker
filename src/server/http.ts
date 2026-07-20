import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ApplicationLedgerService } from "../application/applications.js";
import { AuthService } from "../application/auth.js";
import { DocumentLibraryService } from "../application/documents.js";
import { DocumentPreviewService } from "../application/document_previews.js";
import { EmailLinkExtractionService } from "../application/email_links.js";
import { ApplicationMcpService } from "../application/mcp.js";
import { McpDocumentImportManager } from "../application/mcp_document_imports.js";
import { McpClientCredentialsService } from "../application/mcp_clients.js";
import { McpAccessService } from "../application/mcp_access.js";
import {
  ApplicationMcpRuntimeStatusProvider,
  McpStatusService,
} from "../application/mcp_status.js";
import { McpAuditService } from "../application/mcp_audit.js";
import { RemoteMcpAuthorizationService } from "../application/mcp_oauth.js";
import { CompositeRemoteMcpAuthorizer } from "../application/mcp_remote_auth.js";
import { RemoteMcpSessionRegistry } from "../application/mcp_sessions.js";
import { ReferenceValuesService } from "../application/reference_values.js";
import { SetupService } from "../application/setup.js";
import { UserAdministrationService } from "../application/users.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoMcpClientTokenManager } from "../infrastructure/auth/mcp_client_token_manager.js";
import { JoseMcpAccessTokenVerifier } from "../infrastructure/auth/mcp_access_token_verifier.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { StaticSetupTokenVerifier } from "../infrastructure/auth/setup_token_verifier.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { SqliteMcpAuditRepository } from "../infrastructure/database/mcp_audit_repository.js";
import { SqliteMcpAccessRepository } from "../infrastructure/database/mcp_access_repository.js";
import { SqliteMcpClientsRepository } from "../infrastructure/database/mcp_clients_repository.js";
import { SqliteRemoteMcpActorRepository } from "../infrastructure/database/mcp_oauth_actor_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteDocumentsRepository } from "../infrastructure/database/documents_repository.js";
import { SqliteDocumentPreviewsRepository } from "../infrastructure/database/document_previews_repository.js";
import { DocumentPreviewSupervisor } from "../infrastructure/documents/document_preview_supervisor.js";
import { SqliteReferenceValuesRepository } from "../infrastructure/database/reference_values_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { SqliteUsersRepository } from "../infrastructure/database/users_repository.js";
import { createApp } from "./app.js";
import { parseRuntimeConfig } from "./config.js";
import { createJsonLogger } from "./logging.js";
import { RemoteMcpHttpEndpoint } from "./mcp_http_endpoint.js";
import { createApplicationMcpServer } from "./mcp_server.js";
import { McpSessionRuntime } from "./mcp_session_runtime.js";

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
    const documentsRepository = new SqliteDocumentsRepository(
      database,
      config.documents,
    );
    const documentsService = new DocumentLibraryService(
      documentsRepository,
      config.documents,
    );
    const documentPreviewService = new DocumentPreviewService(
      documentsRepository,
      new SqliteDocumentPreviewsRepository(database),
      new DocumentPreviewSupervisor(config.documents.preview),
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
        loginAttemptLimit: config.session.loginAttemptLimit,
        loginAttemptMaxTrackedKeys: config.session.loginAttemptMaxTrackedKeys,
        loginAttemptWindowMs: config.session.loginAttemptWindowMs,
        maxConcurrentVerifications: config.session.maxConcurrentVerifications,
        refreshIntervalMs: config.session.refreshIntervalMs,
      },
    );
    const usersService = new UserAdministrationService(
      new SqliteUsersRepository(database),
      passwordHasher,
      undefined,
      config.mcp.oauth?.issuer,
    );
    const referenceValuesService = new ReferenceValuesService(
      new SqliteReferenceValuesRepository(database),
    );
    const mcpAuditService = new McpAuditService(
      new SqliteMcpAuditRepository(database),
    );
    const mcpAccessService = new McpAccessService(
      new SqliteMcpAccessRepository(database),
    );
    const mcpSessionRegistry = new RemoteMcpSessionRegistry(config.mcp.session);
    const mcpDocumentImports = new McpDocumentImportManager(
      config.documents.maxUploadBytes,
    );
    const mcpClientsService = new McpClientCredentialsService(
      new SqliteMcpClientsRepository(database),
      new CryptoMcpClientTokenManager(),
    );
    const oauthMcpAuthorization = config.mcp.oauth
      ? new RemoteMcpAuthorizationService(
          new JoseMcpAccessTokenVerifier(config.mcp.oauth),
          new SqliteRemoteMcpActorRepository(database),
          config.mcp.oauth.requiredScope,
          config.mcp.oauth.workspaceSlug,
        )
      : undefined;
    const remoteMcpAuthorization = new CompositeRemoteMcpAuthorizer(
      mcpClientsService,
      oauthMcpAuthorization,
    );
    const mcpSessionRuntime = new McpSessionRuntime(
      mcpSessionRegistry,
      Math.min(
        60_000,
        Math.max(1_000, Math.floor(config.mcp.session.idleDurationMs / 2)),
      ),
      logger,
    );
    const remoteMcpEndpoint = config.mcp.remote
      ? new RemoteMcpHttpEndpoint({
          authorizer: remoteMcpAuthorization,
          createServer: (actorProvider, actor) =>
            createApplicationMcpServer(
              new ApplicationMcpService(
                actorProvider,
                applicationsService,
                referenceValuesService,
                mcpAccessService,
                documentsService,
                mcpDocumentImports,
              ),
              {
                audit: {
                  actorUserId: actor.userId,
                  recorder: mcpAuditService,
                  runAtomically: (operation) =>
                    database.transaction(operation).immediate(),
                  transport: "remote_http",
                  workspaceId: actor.workspaceId,
                },
                instructions:
                  "This authenticated remote server is bound to the actor's Application Tracker workspace. Call get_tracker_context before using workspace data. Mutation tools work only while a website administrator has enabled MCP write access, and delete_application also requires explicit confirmation.",
                logger,
              },
            ),
          logger,
          network: config.mcp.remote,
          ...(config.mcp.oauth
            ? { oauth: { requiredScope: config.mcp.oauth.requiredScope } }
            : {}),
          requestPolicy: config.mcp.request,
          sessions: mcpSessionRegistry,
          sourceRateLimit: {
            requests: config.http.rateLimitRequests,
            windowMs: config.http.rateLimitWindowMs,
          },
        })
      : undefined;
    const mcpStatusService = new McpStatusService(
      config.mcp.session,
      new ApplicationMcpRuntimeStatusProvider(
        mcpSessionRegistry,
        oauthMcpAuthorization,
        remoteMcpEndpoint,
        true,
      ),
      mcpAuditService,
      mcpAccessService,
      mcpClientsService,
    );
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
      documents: {
        emailLinksService: new EmailLinkExtractionService(),
        maxConcurrentUploads: config.documents.maxConcurrentUploads,
        maxUploadBytes: config.documents.maxUploadBytes,
        previewService: documentPreviewService,
        service: documentsService,
      },
      httpRateLimit: {
        requests: config.http.rateLimitRequests,
        windowMs: config.http.rateLimitWindowMs,
      },
      logger,
      mcpClientsService,
      ...(config.mcp.remote && config.mcp.oauth
        ? {
            mcpProtectedResourceMetadata: {
              authorizationServer: config.mcp.oauth.issuer,
              requiredScope: config.mcp.oauth.requiredScope,
              resourceUrl: config.mcp.remote.resourceUrl,
            },
          }
        : {}),
      mcpStatusService,
      ...(remoteMcpEndpoint
        ? { remoteMcpRouter: remoteMcpEndpoint.router() }
        : {}),
      referenceValuesService,
      setupService,
      usersService,
      ...(staticRoot ? { staticRoot } : {}),
    });

    mcpSessionRuntime.start();
    const server = app.listen(config.port, config.host, () => {
      logger.info("application_started", {
        bind: config.host === "0.0.0.0" ? "all_interfaces" : "configured",
        port: config.port,
      });
    });
    let shuttingDown = false;

    server.once("error", (error) => {
      logger.error("http_server_failed", { error });
      process.exitCode = 1;
      void mcpSessionRuntime.stop().finally(() => {
        if (database.open) database.close();
      });
    });

    function shutdown(signal: "SIGINT" | "SIGTERM"): void {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("application_stopping", { signal });
      server.close((error) => {
        void mcpSessionRuntime
          .stop()
          .catch((sessionError: unknown) => {
            logger.error("mcp_session_shutdown_failed", {
              error: sessionError,
            });
            process.exitCode = 1;
          })
          .finally(() => {
            if (database.open) database.close();
            if (error) {
              logger.error("application_stop_failed", { error, signal });
              process.exitCode = 1;
              return;
            }
            logger.info("application_stopped", { signal });
          });
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
