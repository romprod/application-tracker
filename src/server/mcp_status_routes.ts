import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { AuthService } from "../application/auth.js";
import {
  McpOAuthConnectionForbiddenError,
  McpOAuthConnectionNotFoundError,
  type McpBuiltInOAuthService,
} from "../application/mcp_builtin_oauth.js";
import {
  McpClientActorUnavailableError,
  McpClientForbiddenError,
  McpClientLimitError,
  McpClientNotFoundError,
  type McpClientCredentialsService,
} from "../application/mcp_clients.js";
import {
  McpStatusForbiddenError,
  type McpStatusService,
} from "../application/mcp_status.js";
import { requestSessionToken } from "./auth_routes.js";

export function createMcpStatusRouter(
  authService: AuthService,
  mcpStatusService: McpStatusService,
  mcpClientsService?: McpClientCredentialsService,
  mcpOAuthConnectionsService?: McpBuiltInOAuthService,
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

  router.post("/clients", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    if (!mcpClientsService) {
      response
        .status(503)
        .json({ error: { code: "client_credentials_unavailable" } });
      return;
    }
    const parsed = z
      .strictObject({
        accessMode: z.enum(["read_only", "read_write"]),
        actorUserId: z.string().min(8).max(64),
        name: z.string().trim().min(1).max(80),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.status(201).json({
        credential: mcpClientsService.create(actor, parsed.data),
        status: mcpStatusService.getStatus(actor),
      });
    } catch (error) {
      if (sendMcpClientError(response, error)) return;
      next(error);
    }
  });

  router.patch("/clients/:clientId", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    if (!mcpClientsService) {
      response
        .status(503)
        .json({ error: { code: "client_credentials_unavailable" } });
      return;
    }
    const clientId = clientIdSchema.safeParse(request.params.clientId);
    const body = z
      .strictObject({ accessMode: z.enum(["read_only", "read_write"]) })
      .safeParse(request.body);
    if (!clientId.success || !body.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        client: mcpClientsService.updateAccessMode(
          actor,
          clientId.data,
          body.data.accessMode,
        ),
        status: mcpStatusService.getStatus(actor),
      });
    } catch (error) {
      if (sendMcpClientError(response, error)) return;
      next(error);
    }
  });

  router.post("/clients/:clientId/rotate", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    if (!mcpClientsService) {
      response
        .status(503)
        .json({ error: { code: "client_credentials_unavailable" } });
      return;
    }
    const clientId = clientIdSchema.safeParse(request.params.clientId);
    if (!clientId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        credential: mcpClientsService.rotate(actor, clientId.data),
        status: mcpStatusService.getStatus(actor),
      });
    } catch (error) {
      if (sendMcpClientError(response, error)) return;
      next(error);
    }
  });

  router.delete("/clients/:clientId", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    if (!mcpClientsService) {
      response
        .status(503)
        .json({ error: { code: "client_credentials_unavailable" } });
      return;
    }
    const clientId = clientIdSchema.safeParse(request.params.clientId);
    if (!clientId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        client: mcpClientsService.revoke(actor, clientId.data),
        status: mcpStatusService.getStatus(actor),
      });
    } catch (error) {
      if (sendMcpClientError(response, error)) return;
      next(error);
    }
  });

  router.delete("/clients/:clientId/permanent", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    if (!mcpClientsService) {
      response
        .status(503)
        .json({ error: { code: "client_credentials_unavailable" } });
      return;
    }
    const clientId = clientIdSchema.safeParse(request.params.clientId);
    if (!clientId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      mcpClientsService.delete(actor, clientId.data);
      response.json({ status: mcpStatusService.getStatus(actor) });
    } catch (error) {
      if (sendMcpClientError(response, error)) return;
      next(error);
    }
  });

  router.delete(
    "/oauth-clients/:clientId/users/:actorUserId",
    (request, response, next) => {
      const actor = authService.getActor(requestSessionToken(request));
      if (!actor) {
        response
          .status(401)
          .json({ error: { code: "authentication_required" } });
        return;
      }
      if (!mcpOAuthConnectionsService) {
        response
          .status(503)
          .json({ error: { code: "oauth_connections_unavailable" } });
        return;
      }
      const clientId = oauthClientIdSchema.safeParse(request.params.clientId);
      const actorUserId = actorUserIdSchema.safeParse(
        request.params.actorUserId,
      );
      if (!clientId.success || !actorUserId.success) {
        response.status(400).json({ error: { code: "validation_error" } });
        return;
      }
      try {
        mcpOAuthConnectionsService.deleteConnection(
          actor,
          clientId.data,
          actorUserId.data,
        );
        response.json({ status: mcpStatusService.getStatus(actor) });
      } catch (error) {
        if (sendMcpOAuthConnectionError(response, error)) return;
        next(error);
      }
    },
  );

  return router;
}

const clientIdSchema = z.string().regex(/^atmcp_[A-Za-z0-9_-]{24}$/);
const oauthClientIdSchema = z.string().regex(/^atoc_[A-Za-z0-9_-]{24}$/);
const actorUserIdSchema = z.string().min(8).max(64);

function sendMcpClientError(response: Response, error: unknown): boolean {
  if (error instanceof McpClientForbiddenError) {
    response.status(403).json({ error: { code: "forbidden" } });
    return true;
  }
  if (error instanceof McpClientActorUnavailableError) {
    response.status(409).json({ error: { code: "actor_unavailable" } });
    return true;
  }
  if (error instanceof McpClientLimitError) {
    response.status(409).json({ error: { code: "client_limit_reached" } });
    return true;
  }
  if (error instanceof McpClientNotFoundError) {
    response.status(404).json({ error: { code: "client_not_found" } });
    return true;
  }
  return false;
}

function sendMcpOAuthConnectionError(
  response: Response,
  error: unknown,
): boolean {
  if (error instanceof McpOAuthConnectionForbiddenError) {
    response.status(403).json({ error: { code: "forbidden" } });
    return true;
  }
  if (error instanceof McpOAuthConnectionNotFoundError) {
    response.status(404).json({ error: { code: "connection_not_found" } });
    return true;
  }
  return false;
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
