import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createRemoteMcpNetworkGuard } from "./mcp_http_network.js";

const config = {
  allowedHosts: ["tracker.example"],
  allowedOrigins: ["https://client.example"],
  resourceUrl: "https://tracker.example/mcp",
};

function guardedApp(next = vi.fn()) {
  const app = express();
  app.use("/mcp", createRemoteMcpNetworkGuard(config));
  app.all("/mcp", (_request, response) => {
    next();
    response.sendStatus(204);
  });
  return { app, next };
}

describe("remote MCP network guard", () => {
  it("rejects an unapproved or missing host before the route", async () => {
    const { app, next } = guardedApp();
    await request(app)
      .post("/mcp")
      .set("Host", "other.example")
      .expect(403, { error: { code: "host_not_allowed" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects malformed, insecure, or unapproved browser origins", async () => {
    for (const origin of [
      "null",
      "http://client.example",
      "https://other.example",
      "https://client.example/path",
    ]) {
      await request(guardedApp().app)
        .post("/mcp")
        .set("Host", "tracker.example")
        .set("Origin", origin)
        .expect(403, { error: { code: "origin_not_allowed" } });
    }
  });

  it("allows non-browser requests and approved origins", async () => {
    await request(guardedApp().app)
      .post("/mcp")
      .set("Host", "tracker.example")
      .expect(204);
    const browser = await request(guardedApp().app)
      .post("/mcp")
      .set("Host", "tracker.example")
      .set("Origin", "https://client.example")
      .expect(204);
    expect(browser.headers["access-control-allow-origin"]).toBe(
      "https://client.example",
    );
    expect(browser.headers.vary).toBe("Origin");
  });

  it("answers an approved preflight without authorization", async () => {
    const { app, next } = guardedApp();
    const response = await request(app)
      .options("/mcp")
      .set("Host", "tracker.example")
      .set("Origin", "https://client.example")
      .expect(204);

    expect(response.headers["access-control-allow-methods"]).toBe(
      "GET, POST, DELETE, OPTIONS",
    );
    expect(response.headers["access-control-allow-headers"]).toContain(
      "Authorization",
    );
    expect(next).not.toHaveBeenCalled();
  });
});
