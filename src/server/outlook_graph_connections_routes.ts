import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import type { AuthService, AuthenticatedActor } from "../application/auth.js";
import {
  OutlookGraphClientSecretRequiredError,
  OutlookGraphConnectionForbiddenError,
  OutlookGraphConnectionImpactChangedError,
  OutlookGraphConnectionNameConflictError,
  OutlookGraphConnectionNotFoundError,
  OutlookGraphConnectionStorageError,
  type OutlookGraphConnectionsService,
} from "../application/outlook_graph_connections.js";
import { OutlookEmailSyncOperationalError } from "../application/outlook_email_sync.js";
import {
  createOutlookGraphConnectionSchema,
  deleteOutlookGraphConnectionSchema,
  outlookGraphConnectionIdSchema,
  updateOutlookGraphConnectionSchema,
  updateOutlookGraphConnectionStateSchema,
} from "../domain/outlook_graph_connections.js";
import { requestSessionToken } from "./auth_routes.js";

function hasSameHostOrigin(request: Request): boolean {
  const host = request.get("Host");
  const origin = request.get("Origin");
  if (!host || !origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function authenticatedAdministrator(
  request: Request,
  response: Response,
  authService: AuthService,
): AuthenticatedActor | undefined {
  const actor = authService.getActor(requestSessionToken(request));
  if (!actor) {
    response.status(401).json({ error: { code: "authentication_required" } });
    return undefined;
  }
  if (actor.user.role !== "admin") {
    response.status(403).json({ error: { code: "forbidden" } });
    return undefined;
  }
  return actor;
}

function authenticatedActor(
  request: Request,
  response: Response,
  authService: AuthService,
): AuthenticatedActor | undefined {
  const actor = authService.getActor(requestSessionToken(request));
  if (!actor) {
    response.status(401).json({ error: { code: "authentication_required" } });
    return undefined;
  }
  return actor;
}

function requireService(
  response: Response,
  service: OutlookGraphConnectionsService | undefined,
): service is OutlookGraphConnectionsService {
  if (service) return true;
  response
    .status(503)
    .json({ error: { code: "outlook_secure_storage_unavailable" } });
  return false;
}

function handleKnownError(
  error: unknown,
  response: Response,
  next: NextFunction,
): void {
  if (error instanceof OutlookGraphConnectionForbiddenError) {
    response.status(403).json({ error: { code: "forbidden" } });
    return;
  }
  if (error instanceof OutlookGraphConnectionNotFoundError) {
    response
      .status(404)
      .json({ error: { code: "outlook_connection_not_found" } });
    return;
  }
  if (error instanceof OutlookGraphConnectionNameConflictError) {
    response
      .status(409)
      .json({ error: { code: "outlook_connection_name_conflict" } });
    return;
  }
  if (error instanceof OutlookGraphConnectionImpactChangedError) {
    response.status(409).json({
      assignedApplicationCount: error.assignedApplicationCount,
      error: { code: "outlook_connection_impact_changed" },
    });
    return;
  }
  if (error instanceof OutlookGraphClientSecretRequiredError) {
    response
      .status(409)
      .json({ error: { code: "outlook_client_secret_required" } });
    return;
  }
  if (error instanceof OutlookGraphConnectionStorageError) {
    response
      .status(503)
      .json({ error: { code: "outlook_connection_storage_failed" } });
    return;
  }
  if (error instanceof OutlookEmailSyncOperationalError) {
    const unavailable =
      error.code === "outlook_graph_throttled" ||
      error.code === "outlook_graph_unavailable";
    response
      .status(unavailable ? 503 : 422)
      .json({ error: { code: error.code } });
    return;
  }
  next(error);
}

export function createOutlookGraphConnectionsRouter(
  authService: AuthService,
  service?: OutlookGraphConnectionsService,
): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use((request, response, next) => {
    if (
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS"
    ) {
      next();
      return;
    }
    if (!hasSameHostOrigin(request)) {
      response.status(403).json({ error: { code: "csrf_rejected" } });
      return;
    }
    next();
  });

  router.get("/", (request, response, next) => {
    const actor = authenticatedAdministrator(request, response, authService);
    if (!actor) return;
    if (!service) {
      response.json({
        status: { connections: [], secureStorageConfigured: false },
      });
      return;
    }
    try {
      response.json({ status: service.getStatus(actor) });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.get("/options", (request, response, next) => {
    const actor = authenticatedActor(request, response, authService);
    if (!actor) return;
    try {
      response.json({
        connections: service?.listOptions(actor) ?? [],
      });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.post("/", async (request, response, next) => {
    const actor = authenticatedAdministrator(request, response, authService);
    if (!actor || !requireService(response, service)) return;
    const parsed = createOutlookGraphConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response
        .status(201)
        .json({ status: await service.create(actor, parsed.data) });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.put("/:connectionId", async (request, response, next) => {
    const actor = authenticatedAdministrator(request, response, authService);
    if (!actor || !requireService(response, service)) return;
    const parsedId = outlookGraphConnectionIdSchema.safeParse(
      request.params.connectionId,
    );
    const parsedInput = updateOutlookGraphConnectionSchema.safeParse(
      request.body,
    );
    if (!parsedId.success || !parsedInput.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        status: await service.update(actor, parsedId.data, parsedInput.data),
      });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.post("/:connectionId/verify", async (request, response, next) => {
    const actor = authenticatedAdministrator(request, response, authService);
    if (!actor || !requireService(response, service)) return;
    const parsedId = outlookGraphConnectionIdSchema.safeParse(
      request.params.connectionId,
    );
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({ status: await service.verify(actor, parsedId.data) });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.patch("/:connectionId/state", async (request, response, next) => {
    const actor = authenticatedAdministrator(request, response, authService);
    if (!actor || !requireService(response, service)) return;
    const parsedId = outlookGraphConnectionIdSchema.safeParse(
      request.params.connectionId,
    );
    const parsed = updateOutlookGraphConnectionStateSchema.safeParse(
      request.body,
    );
    if (!parsedId.success || !parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        status: await service.setEnabled(
          actor,
          parsedId.data,
          parsed.data.enabled,
        ),
      });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.delete("/:connectionId", (request, response, next) => {
    const actor = authenticatedAdministrator(request, response, authService);
    if (!actor || !requireService(response, service)) return;
    const parsedId = outlookGraphConnectionIdSchema.safeParse(
      request.params.connectionId,
    );
    const parsed = deleteOutlookGraphConnectionSchema.safeParse(request.body);
    if (!parsedId.success || !parsed.success) {
      response.status(400).json({ error: { code: "confirmation_required" } });
      return;
    }
    try {
      response.json({
        status: service.delete(
          actor,
          parsedId.data,
          parsed.data.expectedAssignedApplicationCount,
        ),
      });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  return router;
}
