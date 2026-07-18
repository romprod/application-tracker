import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "./config.js";

describe("parseRuntimeConfig", () => {
  it("uses self-hosted network defaults", () => {
    expect(parseRuntimeConfig({})).toEqual({
      databasePath: "./data/application-tracker.sqlite",
      host: "0.0.0.0",
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
});
