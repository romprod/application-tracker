import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "./config.js";

describe("parseRuntimeConfig", () => {
  it("uses self-hosted network defaults", () => {
    expect(parseRuntimeConfig({})).toEqual({
      databasePath: "./data/application-tracker.sqlite",
      host: "0.0.0.0",
      mcp: {
        session: {
          absoluteDurationMs: 14_400_000,
          globalLimit: 6,
          idleDurationMs: 900_000,
          perActorLimit: 2,
        },
      },
      nodeEnv: "development",
      port: 3333,
      session: {
        absoluteDurationMs: 86_400_000,
        cookieSecure: false,
        idleDurationMs: 1_800_000,
        refreshIntervalMs: 60_000,
      },
    });
  });

  it("rejects a port outside the TCP range", () => {
    expect(() => parseRuntimeConfig({ PORT: "70000" })).toThrow(
      "Invalid runtime configuration",
    );
  });

  it("treats a blank setup token as unconfigured", () => {
    expect(parseRuntimeConfig({ SETUP_TOKEN: "" })).not.toHaveProperty(
      "setupToken",
    );
  });

  it("rejects a setup token with insufficient entropy", () => {
    expect(() => parseRuntimeConfig({ SETUP_TOKEN: "too-short" })).toThrow(
      "Invalid runtime configuration: SETUP_TOKEN",
    );
  });

  it("uses secure cookies in production", () => {
    expect(
      parseRuntimeConfig({ NODE_ENV: "production" }).session.cookieSecure,
    ).toBe(true);
  });

  it("rejects an absolute lifetime shorter than the idle lifetime", () => {
    expect(() =>
      parseRuntimeConfig({
        SESSION_ABSOLUTE_SECONDS: "900",
        SESSION_IDLE_SECONDS: "1800",
      }),
    ).toThrow("Invalid runtime configuration: SESSION_ABSOLUTE_SECONDS");
  });

  it("accepts an explicit MCP session policy", () => {
    expect(
      parseRuntimeConfig({
        MCP_SESSION_ABSOLUTE_SECONDS: "28800",
        MCP_SESSION_GLOBAL_LIMIT: "12",
        MCP_SESSION_IDLE_SECONDS: "1800",
        MCP_SESSION_PER_ACTOR_LIMIT: "3",
      }).mcp.session,
    ).toEqual({
      absoluteDurationMs: 28_800_000,
      globalLimit: 12,
      idleDurationMs: 1_800_000,
      perActorLimit: 3,
    });
  });

  it("rejects contradictory MCP session limits and lifetimes", () => {
    expect(() =>
      parseRuntimeConfig({
        MCP_SESSION_GLOBAL_LIMIT: "2",
        MCP_SESSION_PER_ACTOR_LIMIT: "3",
      }),
    ).toThrow("Invalid runtime configuration: MCP_SESSION_GLOBAL_LIMIT");
    expect(() =>
      parseRuntimeConfig({
        MCP_SESSION_ABSOLUTE_SECONDS: "900",
        MCP_SESSION_IDLE_SECONDS: "900",
      }),
    ).toThrow("Invalid runtime configuration: MCP_SESSION_ABSOLUTE_SECONDS");
  });
});
