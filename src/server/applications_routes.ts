import { Router, type Request } from "express";

import type { ApplicationLedgerService } from "../application/applications.js";
import type { AuthService } from "../application/auth.js";
import { createApplicationSchema } from "../domain/applications.js";
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

  return router;
}
