import express from "express";
import { rateLimit } from "express-rate-limit";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../application/auth.js";
import {
  InsufficientMcpScopeError,
  InvalidMcpAccessTokenError,
  RemoteMcpActorUnavailableError,
} from "../application/mcp_oauth.js";
import { createRemoteMcpBearerAuth, remoteMcpActor } from "./mcp_http_auth.js";
import type { RemoteMcpAuthorizer } from "../application/mcp_remote_auth.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};
const resourceMetadataUrl =
  "https://tracker.example/.well-known/oauth-protected-resource/mcp";

function appWith(authorizer: RemoteMcpAuthorizer, oauth = true) {
  const app = express();
  app.get(
    "/mcp",
    rateLimit({ limit: 600, windowMs: 60_000 }),
    createRemoteMcpBearerAuth({
      authorizer,
      ...(oauth
        ? {
            oauth: {
              requiredScope: "tracker:read",
              resourceUrl: "https://tracker.example/mcp",
            },
          }
        : {}),
    }),
    (_request, response) => {
      response.json({ userId: remoteMcpActor(response).userId });
    },
  );
  return app;
}

describe("remote MCP bearer authorization", () => {
  it("challenges a request without credentials without claiming an invalid token", async () => {
    const response = await request(appWith({ authorize: vi.fn() })).get("/mcp");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: "authentication_required" },
    });
    expect(response.headers["www-authenticate"]).toBe(
      `Bearer resource_metadata="${resourceMetadataUrl}", scope="tracker:read"`,
    );
  });

  it("uses a generic bearer challenge when OAuth discovery is not configured", async () => {
    const response = await request(appWith({ authorize: vi.fn() }, false)).get(
      "/mcp",
    );

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe(
      'Bearer realm="application-tracker-mcp"',
    );
    expect(JSON.stringify(response.body)).not.toContain("oauth");
  });

  it.each(["Basic abc", "Bearer", "Bearer one two"])(
    "rejects malformed authorization: %s",
    async (authorization) => {
      const response = await request(appWith({ authorize: vi.fn() }))
        .get("/mcp")
        .set("Authorization", authorization);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: { code: "invalid_token" } });
      expect(response.headers["www-authenticate"]).toContain(
        'Bearer error="invalid_token"',
      );
    },
  );

  it.each([
    [new InvalidMcpAccessTokenError(), 401, "invalid_token", true],
    [
      new InsufficientMcpScopeError("tracker:read"),
      403,
      "insufficient_scope",
      true,
    ],
    [new RemoteMcpActorUnavailableError(), 403, "actor_unavailable", false],
  ] as const)(
    "maps %s to a sanitized authorization response",
    async (error, status, code, challenged) => {
      const response = await request(
        appWith({ authorize: vi.fn(() => Promise.reject(error)) }),
      )
        .get("/mcp")
        .set("Authorization", "Bearer signed.jwt.value");

      expect(response.status).toBe(status);
      expect(response.body).toEqual({ error: { code } });
      expect(Boolean(response.headers["www-authenticate"])).toBe(challenged);
      expect(JSON.stringify(response.body)).not.toContain(error.message);
    },
  );

  it("passes the resolved actor without retaining the bearer token", async () => {
    const authorize = vi.fn(() =>
      Promise.resolve({
        actor,
        principalId: "oauth:test:alex",
        workspaceSlug: "default",
      }),
    );
    const response = await request(appWith({ authorize }))
      .get("/mcp")
      .set("Authorization", "Bearer signed.jwt.value")
      .expect(200, { userId: "user-1" });

    expect(authorize).toHaveBeenCalledWith("signed.jwt.value");
    expect(JSON.stringify(response.body)).not.toContain("signed.jwt.value");
  });
});
