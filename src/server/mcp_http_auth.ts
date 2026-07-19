import type { RequestHandler, Response } from "express";

import type { AuthenticatedActor } from "../application/auth.js";
import {
  InsufficientMcpScopeError,
  InvalidMcpAccessTokenError,
  RemoteMcpActorUnavailableError,
} from "../application/mcp_oauth.js";
import { mcpProtectedResourceMetadataUrl } from "./mcp_metadata_routes.js";

export interface RemoteMcpAuthorizer {
  authorize(token: string): Promise<AuthenticatedActor>;
}

export interface RemoteMcpBearerAuthOptions {
  authorizer: RemoteMcpAuthorizer;
  requiredScope: string;
  resourceUrl: string;
}

const bearerTokenPattern = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

function challengeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function bearerChallenge(
  options: RemoteMcpBearerAuthOptions,
  error?: "insufficient_scope" | "invalid_token",
): string {
  return [
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${challengeValue(
      mcpProtectedResourceMetadataUrl(options.resourceUrl),
    )}"`,
    `scope="${challengeValue(options.requiredScope)}"`,
  ].join(", ");
}

function sendAuthorizationError(
  response: Response,
  status: 401 | 403,
  code:
    | "actor_unavailable"
    | "authentication_required"
    | "insufficient_scope"
    | "invalid_token",
  challenge?: string,
): void {
  response.set("Cache-Control", "no-store");
  if (challenge) response.set("WWW-Authenticate", `Bearer ${challenge}`);
  response.status(status).json({ error: { code } });
}

export function remoteMcpActor(response: Response): AuthenticatedActor {
  const actor: unknown = response.locals.remoteMcpActor;
  if (!actor) throw new Error("Remote MCP actor is unavailable");
  return actor as AuthenticatedActor;
}

export function createRemoteMcpBearerAuth(
  options: RemoteMcpBearerAuthOptions,
): RequestHandler {
  return async (request, response, next) => {
    const header = request.headers.authorization;
    if (!header) {
      sendAuthorizationError(
        response,
        401,
        "authentication_required",
        bearerChallenge(options),
      );
      return;
    }
    const token = bearerTokenPattern.exec(header)?.[1];
    if (!token) {
      sendAuthorizationError(
        response,
        401,
        "invalid_token",
        bearerChallenge(options, "invalid_token"),
      );
      return;
    }

    try {
      response.locals.remoteMcpActor =
        await options.authorizer.authorize(token);
      next();
    } catch (error) {
      if (error instanceof InvalidMcpAccessTokenError) {
        sendAuthorizationError(
          response,
          401,
          "invalid_token",
          bearerChallenge(options, "invalid_token"),
        );
        return;
      }
      if (error instanceof InsufficientMcpScopeError) {
        sendAuthorizationError(
          response,
          403,
          "insufficient_scope",
          bearerChallenge(options, "insufficient_scope"),
        );
        return;
      }
      if (error instanceof RemoteMcpActorUnavailableError) {
        sendAuthorizationError(response, 403, "actor_unavailable");
        return;
      }
      next(error);
    }
  };
}
