import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "../application/auth.js";
import { createRemoteMcpRequestGuards } from "./mcp_http_limits.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};

function actorApp(
  guards: ReturnType<typeof createRemoteMcpRequestGuards>,
  handler: express.RequestHandler = (_request, response) => {
    response.sendStatus(204);
  },
) {
  const app = express();
  app.use((_request, response, next) => {
    response.locals.remoteMcpActor = actor;
    next();
  });
  app.use(guards.concurrency);
  app.use(guards.rateLimit);
  app.get("/", handler);
  return app;
}

const policy = {
  maxConcurrentRequests: 1,
  maxRequestBytes: 65_536,
  rateLimitRequests: 2,
  rateLimitWindowMs: 60_000,
};

describe("remote MCP request guard", () => {
  it("rate limits by resolved actor and resets after the fixed window", async () => {
    let nowMs = 1_000;
    const app = actorApp(
      createRemoteMcpRequestGuards(policy, () => new Date(nowMs)),
    );

    await request(app).get("/").expect(204);
    await request(app).get("/").expect(204);
    const limited = await request(app).get("/").expect(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.body).toEqual({
      error: { code: -32_003, message: "Request limit reached" },
      id: null,
      jsonrpc: "2.0",
    });

    nowMs += 60_000;
    await request(app).get("/").expect(204);
  });

  it("rejects concurrent work and releases capacity on completion", async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    let blockNextRequest = true;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const app = actorApp(
      createRemoteMcpRequestGuards({
        ...policy,
        rateLimitRequests: 10,
      }),
      async (_request, response) => {
        if (blockNextRequest) {
          blockNextRequest = false;
          entered?.();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        response.sendStatus(204);
      },
    );

    const first = request(app)
      .get("/")
      .then((response) => response);
    await enteredPromise;
    await request(app).get("/").expect(429);
    release?.();
    expect((await first).status).toBe(204);
    await request(app).get("/").expect(204);
  });

  it("rejects an invalid policy at construction", () => {
    expect(() =>
      createRemoteMcpRequestGuards({ ...policy, maxConcurrentRequests: 0 }),
    ).toThrow("Invalid remote MCP request policy");
  });
});
