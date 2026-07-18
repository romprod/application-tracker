import { Router } from "express";

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

  return router;
}
