import compression from "compression";
import express, { type ErrorRequestHandler, type Express } from "express";
import helmet from "helmet";

import type { SetupService } from "../application/setup.js";
import type { ApplicationLedgerService } from "../application/applications.js";
import type { AuthService } from "../application/auth.js";
import type { McpStatusService } from "../application/mcp_status.js";
import type { UserAdministrationService } from "../application/users.js";
import type { ReferenceValuesService } from "../application/reference_values.js";
import { createAuthRouter, type AuthCookieOptions } from "./auth_routes.js";
import { createApplicationsRouter } from "./applications_routes.js";
import { createSetupRouter } from "./setup_routes.js";
import { createMcpStatusRouter } from "./mcp_status_routes.js";
import { createUsersRouter } from "./users_routes.js";
import { createReferenceValuesRouter } from "./reference_values_routes.js";

export interface AppOptions {
  applicationsService?: ApplicationLedgerService;
  authCookie?: AuthCookieOptions;
  authService?: AuthService;
  mcpStatusService?: McpStatusService;
  referenceValuesService?: ReferenceValuesService;
  setupService?: SetupService;
  staticRoot?: string;
  usersService?: UserAdministrationService;
}

const internalErrorHandler: ErrorRequestHandler = (
  _error,
  _request,
  response,
  next,
) => {
  void next;
  response.status(500).json({ error: { code: "internal_error" } });
};

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      service: "application-tracker",
      status: "ok",
    });
  });

  if (options.authService && options.applicationsService) {
    app.use(
      "/api/applications",
      createApplicationsRouter(
        options.authService,
        options.applicationsService,
      ),
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

  app.use(internalErrorHandler);

  return app;
}
