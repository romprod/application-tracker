import { Router, type Request } from "express";

import {
  ApplicationNotFoundError,
  type ApplicationLedgerService,
} from "../application/applications.js";
import type { AuthService } from "../application/auth.js";
import {
  applicationIdSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from "../domain/applications.js";
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

export function createApplicationsRouter(
  authService: AuthService,
  applicationsService: ApplicationLedgerService,
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

  router.get("/", (request, response) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    response.json({
      applications: applicationsService.listApplications(actor),
    });
  });

  router.post("/", (request, response) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = createApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    response.status(201).json({
      application: applicationsService.createApplication(actor, parsed.data),
    });
  });

  router.get("/:applicationId/events", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsedId = applicationIdSchema.safeParse(
      request.params.applicationId,
    );
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        events: applicationsService.listApplicationEvents(actor, parsedId.data),
      });
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      next(error);
    }
  });

  router.patch("/:applicationId", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsedId = applicationIdSchema.safeParse(
      request.params.applicationId,
    );
    const parsedInput = updateApplicationSchema.safeParse(request.body);
    if (!parsedId.success || !parsedInput.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        application: applicationsService.updateApplication(
          actor,
          parsedId.data,
          parsedInput.data,
        ),
      });
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      next(error);
    }
  });

  return router;
}
