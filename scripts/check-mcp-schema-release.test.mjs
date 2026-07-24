import { describe, expect, it } from "vitest";

import { evaluateMcpPublication } from "./check-mcp-schema-release.mjs";

const live = {
  schemaSha256: "b".repeat(64),
  schemaVersion: 6,
  toolCount: 22,
};
const published = {
  schemaSha256: "a".repeat(64),
  schemaVersion: 1,
  toolCount: 19,
};

describe("MCP publication check", () => {
  it("reports optional drift without blocking a direct MCP release", () => {
    expect(evaluateMcpPublication(live, published, false)).toMatchObject({
      exitCode: 0,
      message: expect.stringContaining("Direct MCP deployment is not blocked"),
    });
  });

  it("blocks drift only when publication was explicitly requested", () => {
    expect(evaluateMcpPublication(live, published, true)).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining("publication is incomplete"),
    });
  });

  it("passes when the optional published marker matches", () => {
    expect(evaluateMcpPublication(live, live, true)).toMatchObject({
      exitCode: 0,
      message: expect.stringContaining("metadata is current"),
    });
  });
});
