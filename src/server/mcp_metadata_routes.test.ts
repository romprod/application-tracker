import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

const metadata = {
  authorizationServer: "https://identity.example/application/o/mcp/",
  requiredScope: "tracker:read",
  resourceUrl: "https://tracker.example/mcp",
};

describe("MCP protected resource metadata", () => {
  it("is absent until remote MCP has complete configuration", async () => {
    await request(createApp())
      .get("/.well-known/oauth-protected-resource/mcp")
      .expect(404);
  });

  it("publishes only the RFC 9728 discovery contract", async () => {
    const response = await request(
      createApp({ mcpProtectedResourceMetadata: metadata }),
    )
      .get("/.well-known/oauth-protected-resource/mcp")
      .expect(200);

    expect(response.body).toEqual({
      authorization_servers: ["https://identity.example/application/o/mcp/"],
      bearer_methods_supported: ["header"],
      resource: "https://tracker.example/mcp",
      resource_name: "Application Tracker MCP",
      scopes_supported: ["tracker:read"],
    });
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(JSON.stringify(response.body)).not.toContain("jwks");
  });

  it("supports discovery preflight and rejects other methods", async () => {
    const app = createApp({ mcpProtectedResourceMetadata: metadata });
    const preflight = await request(app)
      .options("/.well-known/oauth-protected-resource/mcp")
      .expect(204);
    expect(preflight.headers["access-control-allow-methods"]).toBe(
      "GET, OPTIONS",
    );

    await request(app)
      .post("/.well-known/oauth-protected-resource/mcp")
      .expect(405, { error: { code: "method_not_allowed" } });
  });
});
