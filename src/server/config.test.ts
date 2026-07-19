import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "./config.js";

describe("parseRuntimeConfig", () => {
  it("uses self-hosted network defaults", () => {
    expect(parseRuntimeConfig({})).toEqual({
      backupDirectory: "./backups",
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

  it("rejects a blank backup directory", () => {
    expect(() => parseRuntimeConfig({ BACKUP_DIRECTORY: " " })).toThrow(
      "Invalid runtime configuration: BACKUP_DIRECTORY",
    );
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

  it("accepts only a complete local MCP actor binding", () => {
    expect(
      parseRuntimeConfig({
        MCP_LOCAL_ACTOR_USERNAME: "alex",
        MCP_LOCAL_WORKSPACE_SLUG: "default",
      }).mcp.local,
    ).toEqual({ actorUsername: "alex", workspaceSlug: "default" });

    expect(() =>
      parseRuntimeConfig({ MCP_LOCAL_ACTOR_USERNAME: "alex" }),
    ).toThrow(
      "Invalid runtime configuration: MCP_LOCAL_ACTOR_USERNAME, MCP_LOCAL_WORKSPACE_SLUG",
    );
  });

  it("accepts a complete strict MCP OAuth verifier configuration", () => {
    expect(
      parseRuntimeConfig({
        MCP_OAUTH_ALGORITHM: "RS256",
        MCP_OAUTH_AUDIENCE: "https://tracker.example/mcp",
        MCP_OAUTH_ISSUER: "https://identity.example/application/o/mcp/",
        MCP_OAUTH_JWKS_URL: "https://identity.example/application/o/mcp/jwks/",
        MCP_OAUTH_REQUIRED_SCOPE: "tracker:read",
        MCP_OAUTH_WORKSPACE_SLUG: "default",
      }).mcp.oauth,
    ).toEqual({
      algorithm: "RS256",
      audience: "https://tracker.example/mcp",
      issuer: "https://identity.example/application/o/mcp/",
      jwksUrl: "https://identity.example/application/o/mcp/jwks/",
      requiredScope: "tracker:read",
      workspaceSlug: "default",
    });
  });

  it("rejects partial or unsafe MCP OAuth configuration", () => {
    expect(() => parseRuntimeConfig({ MCP_OAUTH_ALGORITHM: "RS256" })).toThrow(
      "MCP OAuth settings must be configured together",
    );
    expect(() =>
      parseRuntimeConfig({
        MCP_OAUTH_ALGORITHM: "RS256",
        MCP_OAUTH_AUDIENCE: "https://tracker.example/mcp",
        MCP_OAUTH_ISSUER: "http://identity.example/application/o/mcp/",
        MCP_OAUTH_JWKS_URL: "http://identity.example/application/o/mcp/jwks/",
        MCP_OAUTH_REQUIRED_SCOPE: "tracker:read",
        MCP_OAUTH_WORKSPACE_SLUG: "default",
      }),
    ).toThrow("Invalid runtime configuration: MCP_OAUTH_ISSUER");
    expect(() =>
      parseRuntimeConfig({
        MCP_OAUTH_ALGORITHM: "RS256",
        MCP_OAUTH_AUDIENCE: "https://tracker.example/mcp",
        MCP_OAUTH_ISSUER: "https://identity.example/application/o/mcp/",
        MCP_OAUTH_JWKS_URL: "https://keys.example/mcp/jwks/",
        MCP_OAUTH_REQUIRED_SCOPE: "tracker:read",
        MCP_OAUTH_WORKSPACE_SLUG: "default",
      }),
    ).toThrow("MCP_OAUTH_JWKS_URL must use the issuer origin");
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
