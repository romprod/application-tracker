import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "./config.js";

describe("parseRuntimeConfig", () => {
  it("uses private local defaults", () => {
    expect(parseRuntimeConfig({})).toEqual({
      databasePath: "./data/application-tracker.sqlite",
      host: "127.0.0.1",
      nodeEnv: "development",
      port: 3333,
    });
  });

  it("rejects a port outside the TCP range", () => {
    expect(() => parseRuntimeConfig({ PORT: "70000" })).toThrow(
      "Invalid runtime configuration",
    );
  });
});
