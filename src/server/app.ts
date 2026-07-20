import compression from "compression";
import express, {
  type Express,
  type RequestHandler,
  type Router,
} from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import type { SetupService } from "../application/setup.js";
import type { ApplicationLedgerService } from "../application/applications.js";
import type { AuthService } from "../application/auth.js";
import type { McpStatusService } from "../application/mcp_status.js";
import type { McpClientCredentialsService } from "../application/mcp_clients.js";
import type { McpBuiltInOAuthService } from "../application/mcp_builtin_oauth.js";
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
  httpRateLimit?: HttpRateLimitPolicy;
  logger?: ApplicationLogger;
  mcpStatusService?: McpStatusService;
  mcpClientsService?: McpClientCredentialsService;
  mcpOAuthConnectionsService?: McpBuiltInOAuthService;
  mcpOAuthRouter?: RequestHandler;
  mcpProtectedResourceMetadata?: McpProtectedResourceMetadataConfig;
  remoteMcpRouter?: Router;
  referenceValuesService?: ReferenceValuesService;
  setupService?: SetupService;
  staticRoot?: string;
  trustProxyHops?: number;
  usersService?: UserAdministrationService;
}

export interface HttpRateLimitPolicy {
  requests: number;
  windowMs: number;
}

const defaultHttpRateLimitPolicy: HttpRateLimitPolicy = {
  requests: 600,
  windowMs: 60_000,
};

function resolveHttpRateLimitPolicy(
  configured: HttpRateLimitPolicy | undefined,
): HttpRateLimitPolicy {
  const policy = configured ?? defaultHttpRateLimitPolicy;
  if (
    !Number.isInteger(policy.requests) ||
    policy.requests < 1 ||
    !Number.isInteger(policy.windowMs) ||
    policy.windowMs < 1
  ) {
    throw new Error("Invalid HTTP rate limit policy");
  }
  return policy;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? noOpLogger;
  const httpRateLimit = resolveHttpRateLimitPolicy(options.httpRateLimit);
  const trustProxyHops = options.trustProxyHops ?? 0;
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 8
  ) {
    throw new Error("Invalid trusted proxy hop count");
  }

  app.disable("x-powered-by");
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  app.use(helmet());
  app.use(compression());
  app.use(
    rateLimit({
      identifier: "application-tracker-http",
      legacyHeaders: false,
      limit: httpRateLimit.requests,
      message: { error: { code: "request_rate_limited" } },
      standardHeaders: "draft-8",
      validate: { xForwardedForHeader: false },
      windowMs: httpRateLimit.windowMs,
    }),
  );
  app.use("/api", createApiRequestLogger(logger));
  app.use("/api", express.json({ limit: "256kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      service: "application-tracker",
      status: "ok",
    });
  });

  if (options.mcpOAuthRouter) {
    app.use(options.mcpOAuthRouter);
  }

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
      createMcpStatusRouter(
        options.authService,
        options.mcpStatusService,
        options.mcpClientsService,
        options.mcpOAuthConnectionsService,
      ),
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
