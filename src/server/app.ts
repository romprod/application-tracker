import compression from "compression";
import express, { type Express, type Router } from "express";
import helmet from "helmet";

import type { SetupService } from "../application/setup.js";
import type { ApplicationLedgerService } from "../application/applications.js";
import type { AuthService } from "../application/auth.js";
import type { McpStatusService } from "../application/mcp_status.js";
import type { UserAdministrationService } from "../application/users.js";
import type { ReferenceValuesService } from "../application/reference_values.js";
import type { DocumentsRouteOptions } from "./documents_routes.js";
import { createAuthRouter, type AuthCookieOptions } from "./auth_routes.js";
import { createApplicationsRouter } from "./applications_routes.js";
import { createSetupRouter } from "./setup_routes.js";
import { createMcpStatusRouter } from "./mcp_status_routes.js";
import {
  createMcpProtectedResourceMetadataRouter,
  mcpProtectedResourceMetadataPath,
  type McpProtectedResourceMetadataConfig,
} from "./mcp_metadata_routes.js";
import { createUsersRouter } from "./users_routes.js";
import { createReferenceValuesRouter } from "./reference_values_routes.js";
import { createDocumentsRouter } from "./documents_routes.js";
import {
  apiNotFoundHandler,
  createApiErrorHandler,
  createApiRequestLogger,
} from "./http_boundary.js";
import { noOpLogger, type ApplicationLogger } from "./logging.js";

export interface AppOptions {
  applicationsService?: ApplicationLedgerService;
  authCookie?: AuthCookieOptions;
  authService?: AuthService;
  documents?: DocumentsRouteOptions;
  logger?: ApplicationLogger;
  mcpStatusService?: McpStatusService;
  mcpProtectedResourceMetadata?: McpProtectedResourceMetadataConfig;
  remoteMcpRouter?: Router;
  referenceValuesService?: ReferenceValuesService;
  setupService?: SetupService;
  staticRoot?: string;
  usersService?: UserAdministrationService;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? noOpLogger;

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use("/api", createApiRequestLogger(logger));
  app.use("/api", express.json({ limit: "256kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      service: "application-tracker",
      status: "ok",
    });
  });

  if (options.mcpProtectedResourceMetadata) {
    app.use(
      mcpProtectedResourceMetadataPath(
        options.mcpProtectedResourceMetadata.resourceUrl,
      ),
      createMcpProtectedResourceMetadataRouter(
        options.mcpProtectedResourceMetadata,
      ),
    );
  }

  if (options.remoteMcpRouter) {
    app.use("/mcp", createApiRequestLogger(logger), options.remoteMcpRouter);
  }

  if (options.authService && options.applicationsService) {
    app.use(
      "/api/applications",
      createApplicationsRouter(
        options.authService,
        options.applicationsService,
      ),
    );
  }

  if (options.authService && options.documents) {
    app.use(
      "/api/documents",
      createDocumentsRouter(options.authService, options.documents),
    );
  }

  if (options.setupService) {
    app.use("/api/setup", createSetupRouter(options.setupService));
  }

  if (options.authService && options.authCookie) {
    app.use(
      "/api/auth",
      createAuthRouter(options.authService, options.authCookie),
    );
  }

  if (options.authService && options.usersService) {
    app.use(
      "/api/settings/users",
      createUsersRouter(options.authService, options.usersService),
    );
  }

  if (options.authService && options.referenceValuesService) {
    app.use(
      "/api/settings/lists",
      createReferenceValuesRouter(
        options.authService,
        options.referenceValuesService,
      ),
    );
  }

  if (options.authService && options.mcpStatusService) {
    app.use(
      "/api/settings/mcp",
      createMcpStatusRouter(options.authService, options.mcpStatusService),
    );
  }

  app.use("/api", apiNotFoundHandler);

  if (options.staticRoot) {
    app.use(express.static(options.staticRoot, { index: false }));
    app.use((request, response, next) => {
      if (request.method !== "GET" || !request.accepts("html")) {
        next();
        return;
      }

      response.sendFile("index.html", { root: options.staticRoot });
    });
  }

  app.use(createApiErrorHandler(logger));

  return app;
}
