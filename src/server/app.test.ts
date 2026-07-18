import request from "supertest";
import { describe, expect, it } from "vitest";

import { SetupService } from "../application/setup.js";
import { createApp } from "./app.js";
import type { ApplicationLogger, LogContext } from "./logging.js";

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function capturingLogger() {
  const errors: { context?: LogContext; event: string }[] = [];
  const info: { context?: LogContext; event: string }[] = [];
  const logger: ApplicationLogger = {
    error: (event, context) =>
      errors.push({ event, ...(context ? { context } : {}) }),
    info: (event, context) =>
      info.push({ event, ...(context ? { context } : {}) }),
  };
  return { errors, info, logger };
}

describe("health endpoint", () => {
  it("reports service availability without configuration details", async () => {
    const response = await request(createApp()).get("/api/health").expect(200);

    expect(response.body).toEqual({
      service: "application-tracker",
      status: "ok",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toMatch(requestIdPattern);
  });
});

describe("HTTP error and logging boundary", () => {
  it("returns structured client errors for malformed, oversized, and unknown API requests", async () => {
    const { logger } = capturingLogger();
    const app = createApp({ logger });

    const malformed = await request(app)
      .post("/api/setup")
      .set("Content-Type", "application/json")
      .send('{"setupToken":"body-secret"');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: { code: "invalid_json" } });
    expect(malformed.headers["x-request-id"]).toMatch(requestIdPattern);

    const oversized = await request(app)
      .post("/api/setup")
      .send({ value: "x".repeat(300 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({
      error: { code: "payload_too_large" },
    });

    const missing = await request(app).get("/api/not-a-route");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: "not_found" } });
  });

  it("logs safe request metadata without headers, query values, bodies, or error messages", async () => {
    const requestSecret = "request-value-must-not-be-logged";
    const errorSecret = "error-message-must-not-be-logged";
    const { errors, info, logger } = capturingLogger();
    const setupService = new SetupService(
      {
        createInitialAdministrator: () => {
          throw new Error("not used");
        },
        isSetupComplete: () => {
          throw new Error(errorSecret);
        },
      },
      {
        hash: () => Promise.resolve("not used"),
        verify: () => Promise.resolve(false),
      },
      {
        isConfigured: () => false,
        verify: () => false,
      },
    );
    const app = createApp({ logger, setupService });

    const response = await request(app)
      .get(`/api/setup/status?token=${requestSecret}`)
      .set("Authorization", `Bearer ${requestSecret}`)
      .set("Cookie", `session=${requestSecret}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "internal_error" } });
    const serialized = JSON.stringify({ errors, info });
    expect(serialized).not.toContain(requestSecret);
    expect(serialized).not.toContain(errorSecret);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.event).toBe("http_request_failed");
    expect(errors[0]?.context?.error).toBeInstanceOf(Error);
    expect(typeof errors[0]?.context?.requestId).toBe("string");

    const completed = info.find(
      ({ event }) => event === "http_request_completed",
    );
    expect(completed?.context).toMatchObject({
      method: "GET",
      route: "/status",
      statusCode: 500,
    });
    expect(typeof completed?.context?.durationMs).toBe("number");
    expect(typeof completed?.context?.requestId).toBe("string");
  });
});
