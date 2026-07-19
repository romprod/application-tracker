import { Router, type Request } from "express";
import { z } from "zod";

import type { AuthService } from "../application/auth.js";
import {
  McpStatusForbiddenError,
  type McpStatusService,
} from "../application/mcp_status.js";
import { requestSessionToken } from "./auth_routes.js";

export function createMcpStatusRouter(
  authService: AuthService,
  mcpStatusService: McpStatusService,
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
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }

    try {
      response.json({ status: mcpStatusService.getStatus(actor) });
    } catch (error) {
      if (error instanceof McpStatusForbiddenError) {
        response.status(403).json({ error: { code: "forbidden" } });
        return;
      }
      next(error);
    }
  });

  router.patch("/", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = z
      .strictObject({ accessMode: z.enum(["read_only", "read_write"]) })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        status: mcpStatusService.setAccessMode(actor, parsed.data.accessMode),
      });
    } catch (error) {
      if (error instanceof McpStatusForbiddenError) {
        response.status(403).json({ error: { code: "forbidden" } });
        return;
      }
      next(error);
    }
  });

  return router;
}

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
