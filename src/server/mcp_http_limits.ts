import type { RequestHandler, Response } from "express";

import { remoteMcpActor, remoteMcpPrincipal } from "./mcp_http_auth.js";

export interface RemoteMcpRequestPolicy {
  maxConcurrentRequests: number;
  maxConcurrentRequestsPerActor: number;
  maxRequestBytes: number;
  rateLimitRequests: number;
  rateLimitWindowMs: number;
}

interface ActorRateWindow {
  count: number;
  startedAtMs: number;
}

function sendRequestLimit(response: Response, retryAfterSeconds: number): void {
  response.set({
    "Cache-Control": "no-store",
    "Retry-After": String(Math.max(1, retryAfterSeconds)),
  });
  response.status(429).json({
    error: { code: -32_003, message: "Request limit reached" },
    id: null,
    jsonrpc: "2.0",
  });
}

export interface RemoteMcpRequestGuards {
  concurrency: RequestHandler;
  rateLimit: RequestHandler;
}

export function createRemoteMcpRequestGuards(
  policy: RemoteMcpRequestPolicy,
  clock: () => Date = () => new Date(),
): RemoteMcpRequestGuards {
  if (
    !Number.isInteger(policy.maxConcurrentRequests) ||
    policy.maxConcurrentRequests < 2 ||
    !Number.isInteger(policy.maxConcurrentRequestsPerActor) ||
    policy.maxConcurrentRequestsPerActor < 1 ||
    policy.maxConcurrentRequestsPerActor >= policy.maxConcurrentRequests ||
    policy.maxRequestBytes < 1 ||
    policy.rateLimitRequests < 1 ||
    policy.rateLimitWindowMs < 1
  ) {
    throw new Error("Invalid remote MCP request policy");
  }

  const rateWindows = new Map<string, ActorRateWindow>();
  const activeRequestsByActor = new Map<string, number>();
  let activeRequests = 0;

  const rateLimit: RequestHandler = (_request, response, next) => {
    const nowMs = clock().getTime();
    const connectionId = remoteMcpPrincipal(response).principalId;
    const current = rateWindows.get(connectionId);
    const actorWindow =
      !current || nowMs - current.startedAtMs >= policy.rateLimitWindowMs
        ? { count: 0, startedAtMs: nowMs }
        : current;

    if (actorWindow.count >= policy.rateLimitRequests) {
      sendRequestLimit(
        response,
        Math.ceil(
          (actorWindow.startedAtMs + policy.rateLimitWindowMs - nowMs) / 1000,
        ),
      );
      return;
    }
    actorWindow.count += 1;
    rateWindows.set(connectionId, actorWindow);

    next();
  };

  const concurrency: RequestHandler = (_request, response, next) => {
    const actorId = remoteMcpActor(response).userId;
    const actorActiveRequests = activeRequestsByActor.get(actorId) ?? 0;
    if (
      activeRequests >= policy.maxConcurrentRequests ||
      actorActiveRequests >= policy.maxConcurrentRequestsPerActor
    ) {
      sendRequestLimit(response, 1);
      return;
    }

    activeRequests += 1;
    activeRequestsByActor.set(actorId, actorActiveRequests + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      activeRequests -= 1;
      const remainingActorRequests =
        (activeRequestsByActor.get(actorId) ?? 1) - 1;
      if (remainingActorRequests === 0) {
        activeRequestsByActor.delete(actorId);
      } else {
        activeRequestsByActor.set(actorId, remainingActorRequests);
      }
    };
    response.once("finish", release);
    response.once("close", release);
    next();
  };

  return { concurrency, rateLimit };
}
