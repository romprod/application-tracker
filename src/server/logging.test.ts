import { describe, expect, it } from "vitest";

import { createJsonLogger } from "./logging.js";

describe("structured logging", () => {
  it("writes JSON events while redacting sensitive fields and error details", () => {
    const infoLines: string[] = [];
    const errorLines: string[] = [];
    const logger = createJsonLogger({
      destination: {
        error: (line) => errorLines.push(line),
        info: (line) => infoLines.push(line),
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    logger.info("application_started", { port: 3333 });
    logger.error("operation_failed", {
      authorization: "auth-value",
      error: new Error("error-value"),
      nested: {
        accessToken: "token-value",
        password: "password-value",
        safeValue: "retained",
      },
      query: "query-value",
      username: "personal-name",
    });

    expect(JSON.parse(infoLines[0] ?? "")).toEqual({
      event: "application_started",
      level: "info",
      port: 3333,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.parse(errorLines[0] ?? "")).toEqual({
      authorization: "[REDACTED]",
      error: { name: "Error" },
      event: "operation_failed",
      level: "error",
      nested: {
        accessToken: "[REDACTED]",
        password: "[REDACTED]",
        safeValue: "retained",
      },
      query: "[REDACTED]",
      timestamp: "2026-01-01T00:00:00.000Z",
      username: "[REDACTED]",
    });
    expect(errorLines.join("\n")).not.toMatch(
      /auth-value|error-value|password-value|query-value|personal-name|token-value/,
    );
  });
});
