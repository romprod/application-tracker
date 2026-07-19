import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../application/auth.js";
import {
  InsufficientMcpScopeError,
  InvalidMcpAccessTokenError,
  RemoteMcpActorUnavailableError,
} from "../application/mcp_oauth.js";
import {
  createRemoteMcpBearerAuth,
  remoteMcpActor,
  type RemoteMcpAuthorizer,
} from "./mcp_http_auth.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};
const resourceMetadataUrl =
  "https://tracker.example/.well-known/oauth-protected-resource/mcp";

function appWith(authorizer: RemoteMcpAuthorizer) {
  const app = express();
  app.get(
    "/mcp",
    createRemoteMcpBearerAuth({
      authorizer,
      requiredScope: "tracker:read",
      resourceUrl: "https://tracker.example/mcp",
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
    const authorize = vi.fn(() => Promise.resolve(actor));
    const response = await request(appWith({ authorize }))
      .get("/mcp")
      .set("Authorization", "Bearer signed.jwt.value")
      .expect(200, { userId: "user-1" });

    expect(authorize).toHaveBeenCalledWith("signed.jwt.value");
    expect(JSON.stringify(response.body)).not.toContain("signed.jwt.value");
  });
});
