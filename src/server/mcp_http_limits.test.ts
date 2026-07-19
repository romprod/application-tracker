import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../application/auth.js";
import { createRemoteMcpRequestGuards } from "./mcp_http_limits.js";

function actor(actorId: string): AuthenticatedActor {
  return {
    authenticated: true,
    user: { displayName: actorId, role: "admin", username: actorId },
    userId: actorId,
    workspace: { name: "Applications" },
    workspaceId: "workspace-1",
  };
}

function actorApp(
  guards: ReturnType<typeof createRemoteMcpRequestGuards>,
  handler: express.RequestHandler = (_request, response) => {
    response.sendStatus(204);
  },
) {
  const app = express();
  app.use((request, response, next) => {
    const actorId = request.get("X-Test-Actor") ?? "user-1";
    response.locals.remoteMcpPrincipal = {
      actor: actor(actorId),
      principalId: "client:test",
      workspaceSlug: "default",
    };
    next();
  });
  app.use(guards.concurrency);
  app.use(guards.rateLimit);
  app.get("/", handler);
  return app;
}

const policy = {
  maxConcurrentRequests: 2,
  maxConcurrentRequestsPerActor: 1,
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
      .set("X-Test-Actor", "actor-a")
      .then((response) => response);
    await enteredPromise;
    await request(app).get("/").set("X-Test-Actor", "actor-a").expect(429);
    await request(app).get("/").set("X-Test-Actor", "actor-b").expect(204);
    release?.();
    expect((await first).status).toBe(204);
    await request(app).get("/").set("X-Test-Actor", "actor-a").expect(204);
  });

  it("retains the installation-wide concurrency cap across actors", async () => {
    const releases: Array<() => void> = [];
    let entered = 0;
    const app = actorApp(
      createRemoteMcpRequestGuards({
        ...policy,
        rateLimitRequests: 10,
      }),
      async (_request, response) => {
        entered += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
        response.sendStatus(204);
      },
    );

    const first = request(app)
      .get("/")
      .set("X-Test-Actor", "actor-a")
      .then((response) => response);
    const second = request(app)
      .get("/")
      .set("X-Test-Actor", "actor-b")
      .then((response) => response);
    await vi.waitFor(() => expect(entered).toBe(2));

    await request(app).get("/").set("X-Test-Actor", "actor-c").expect(429);
    releases.splice(0).forEach((release) => release());
    expect((await first).status).toBe(204);
    expect((await second).status).toBe(204);
  });

  it("rejects an invalid policy at construction", () => {
    expect(() =>
      createRemoteMcpRequestGuards({ ...policy, maxConcurrentRequests: 0 }),
    ).toThrow("Invalid remote MCP request policy");
    expect(() =>
      createRemoteMcpRequestGuards({
        ...policy,
        maxConcurrentRequestsPerActor: policy.maxConcurrentRequests,
      }),
    ).toThrow("Invalid remote MCP request policy");
  });
});
