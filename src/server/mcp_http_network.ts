import type { RequestHandler, Response } from "express";

import type { RemoteMcpNetworkConfig } from "../application/mcp_oauth.js";

const allowedHeaders = [
  "Authorization",
  "Content-Type",
  "Last-Event-ID",
  "MCP-Protocol-Version",
  "MCP-Session-Id",
].join(", ");

function sendNetworkError(
  response: Response,
  code: "host_not_allowed" | "origin_not_allowed",
): void {
  response.set("Cache-Control", "no-store");
  response.status(403).json({ error: { code } });
}

function requestOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.href === `${parsed.origin}/`
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function createRemoteMcpNetworkGuard(
  config: RemoteMcpNetworkConfig,
): RequestHandler {
  const allowedHosts = new Set(config.allowedHosts);
  const allowedOrigins = new Set(config.allowedOrigins);

  return (request, response, next) => {
    const host = request.headers.host?.toLowerCase();
    if (!host || !allowedHosts.has(host)) {
      sendNetworkError(response, "host_not_allowed");
      return;
    }

    const originHeader = request.headers.origin;
    if (originHeader) {
      const origin = requestOrigin(originHeader);
      if (!origin || !allowedOrigins.has(origin)) {
        sendNetworkError(response, "origin_not_allowed");
        return;
      }
      response.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Expose-Headers":
          "MCP-Session-Id, WWW-Authenticate, X-Request-Id",
        Vary: "Origin",
      });
    }

    if (request.method === "OPTIONS") {
      response.set({
        "Access-Control-Allow-Headers": allowedHeaders,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Max-Age": "600",
      });
      response.sendStatus(204);
      return;
    }
    next();
  };
}
