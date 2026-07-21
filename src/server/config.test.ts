import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "./config.js";

const completeRemoteEnvironment = {
  MCP_OAUTH_ALGORITHM: "RS256",
  MCP_OAUTH_AUDIENCE: "https://tracker.example/mcp",
  MCP_OAUTH_ISSUER: "https://identity.example/application/o/mcp/",
  MCP_OAUTH_JWKS_URL: "https://identity.example/application/o/mcp/jwks/",
  MCP_OAUTH_REQUIRED_SCOPE: "tracker:read",
  MCP_OAUTH_WORKSPACE_SLUG: "default",
  MCP_REMOTE_ALLOWED_HOSTS: "tracker.example,tracker.example:8443",
  MCP_REMOTE_ALLOWED_ORIGINS: "https://client.example,https://desktop.example/",
  MCP_REMOTE_ENABLED: "true",
  MCP_REMOTE_URL: "https://tracker.example/mcp",
} as const;

describe("parseRuntimeConfig", () => {
  it("uses self-hosted network defaults", () => {
    expect(parseRuntimeConfig({})).toEqual({
      backupDirectory: "./backups",
      databasePath: "./data/application-tracker.sqlite",
      documents: {
        maxInstallationBytes: 2_147_483_648,
        maxInstallationDocuments: 10_000,
        maxConcurrentUploads: 2,
        maxUploadBytes: 10_485_760,
        maxWorkspaceBytes: 536_870_912,
        maxWorkspaceDocuments: 2_000,
        preview: {
          maxConcurrentWorkers: 2,
          maxDecodedBytes: 8_388_608,
          maxInputBytes: 1_048_576,
          maxMemoryMb: 32,
          maxOutputCharacters: 100_000,
          timeoutMs: 1500,
        },
      },
      host: "0.0.0.0",
      http: {
        rateLimitRequests: 600,
        rateLimitWindowMs: 60_000,
        trustProxyHops: 0,
      },
      mcp: {
        request: {
          maxConcurrentRequests: 8,
          maxConcurrentRequestsPerActor: 4,
          maxRequestBytes: 65_536,
          rateLimitRequests: 600,
          rateLimitWindowMs: 60_000,
        },
        session: {
          absoluteDurationMs: 14_400_000,
          globalLimit: 256,
          idleDurationMs: 300_000,
          perActorLimit: 64,
        },
      },
      nodeEnv: "development",
      port: 3333,
      session: {
        absoluteDurationMs: 86_400_000,
        cookieSecure: false,
        idleDurationMs: 1_800_000,
        loginAttemptLimit: 10,
        loginAttemptMaxTrackedKeys: 10_000,
        loginAttemptWindowMs: 60_000,
        maxConcurrentVerifications: 2,
        refreshIntervalMs: 60_000,
      },
    });
  });

  it("rejects a blank backup directory", () => {
    expect(() => parseRuntimeConfig({ BACKUP_DIRECTORY: " " })).toThrow(
      "Invalid runtime configuration: BACKUP_DIRECTORY",
    );
  });

  it("accepts only a bounded document upload limit", () => {
    expect(
      parseRuntimeConfig({ DOCUMENT_MAX_UPLOAD_BYTES: "5242880" }).documents,
    ).toMatchObject({ maxUploadBytes: 5_242_880 });
    expect(() =>
      parseRuntimeConfig({ DOCUMENT_MAX_UPLOAD_BYTES: "512" }),
    ).toThrow("Invalid runtime configuration: DOCUMENT_MAX_UPLOAD_BYTES");
    expect(() =>
      parseRuntimeConfig({ DOCUMENT_MAX_UPLOAD_BYTES: "52428801" }),
    ).toThrow("Invalid runtime configuration: DOCUMENT_MAX_UPLOAD_BYTES");
  });

  it("accepts only bounded document upload concurrency", () => {
    expect(
      parseRuntimeConfig({ DOCUMENT_MAX_CONCURRENT_UPLOADS: "4" }).documents
        .maxConcurrentUploads,
    ).toBe(4);
    expect(() =>
      parseRuntimeConfig({ DOCUMENT_MAX_CONCURRENT_UPLOADS: "0" }),
    ).toThrow("Invalid runtime configuration: DOCUMENT_MAX_CONCURRENT_UPLOADS");
    expect(() =>
      parseRuntimeConfig({ DOCUMENT_MAX_CONCURRENT_UPLOADS: "33" }),
    ).toThrow("Invalid runtime configuration: DOCUMENT_MAX_CONCURRENT_UPLOADS");
  });

  it("accepts only bounded document preview worker limits", () => {
    expect(
      parseRuntimeConfig({
        DOCUMENT_PREVIEW_MAX_CONCURRENT_WORKERS: "4",
        DOCUMENT_PREVIEW_MAX_DECODED_BYTES: "4194304",
        DOCUMENT_PREVIEW_MAX_INPUT_BYTES: "524288",
        DOCUMENT_PREVIEW_MAX_MEMORY_MB: "48",
        DOCUMENT_PREVIEW_MAX_OUTPUT_CHARACTERS: "50000",
        DOCUMENT_PREVIEW_TIMEOUT_MS: "2000",
      }).documents.preview,
    ).toEqual({
      maxConcurrentWorkers: 4,
      maxDecodedBytes: 4_194_304,
      maxInputBytes: 524_288,
      maxMemoryMb: 48,
      maxOutputCharacters: 50_000,
      timeoutMs: 2000,
    });
    expect(() =>
      parseRuntimeConfig({ DOCUMENT_PREVIEW_MAX_CONCURRENT_WORKERS: "0" }),
    ).toThrow(
      "Invalid runtime configuration: DOCUMENT_PREVIEW_MAX_CONCURRENT_WORKERS",
    );
    expect(() =>
      parseRuntimeConfig({ DOCUMENT_PREVIEW_MAX_MEMORY_MB: "8" }),
    ).toThrow("Invalid runtime configuration: DOCUMENT_PREVIEW_MAX_MEMORY_MB");
    expect(() =>
      parseRuntimeConfig({
        DOCUMENT_MAX_UPLOAD_BYTES: "1024",
        DOCUMENT_PREVIEW_MAX_INPUT_BYTES: "2048",
      }),
    ).toThrow(
      "Invalid runtime configuration: DOCUMENT_PREVIEW_MAX_INPUT_BYTES",
    );
  });

  it("accepts ordered document storage quotas", () => {
    expect(
      parseRuntimeConfig({
        DOCUMENT_MAX_INSTALLATION_BYTES: "8192",
        DOCUMENT_MAX_INSTALLATION_COUNT: "20",
        DOCUMENT_MAX_UPLOAD_BYTES: "1024",
        DOCUMENT_MAX_WORKSPACE_BYTES: "4096",
        DOCUMENT_MAX_WORKSPACE_COUNT: "10",
        DOCUMENT_PREVIEW_MAX_INPUT_BYTES: "1024",
      }).documents,
    ).toMatchObject({
      maxInstallationBytes: 8192,
      maxInstallationDocuments: 20,
      maxUploadBytes: 1024,
      maxWorkspaceBytes: 4096,
      maxWorkspaceDocuments: 10,
    });
    expect(() =>
      parseRuntimeConfig({
        DOCUMENT_MAX_INSTALLATION_BYTES: "4096",
        DOCUMENT_MAX_UPLOAD_BYTES: "8192",
        DOCUMENT_PREVIEW_MAX_INPUT_BYTES: "1024",
      }),
    ).toThrow("Invalid runtime configuration: DOCUMENT_MAX_INSTALLATION_BYTES");
    expect(() =>
      parseRuntimeConfig({
        DOCUMENT_MAX_INSTALLATION_COUNT: "5",
        DOCUMENT_MAX_WORKSPACE_COUNT: "10",
      }),
    ).toThrow("Invalid runtime configuration: DOCUMENT_MAX_INSTALLATION_COUNT");
  });

  it("accepts bounded login verification and attempt limits", () => {
    expect(
      parseRuntimeConfig({
        LOGIN_MAX_CONCURRENT_VERIFICATIONS: "4",
        LOGIN_RATE_LIMIT_ATTEMPTS: "20",
        LOGIN_RATE_LIMIT_MAX_KEYS: "5000",
        LOGIN_RATE_LIMIT_WINDOW_SECONDS: "120",
      }).session,
    ).toMatchObject({
      loginAttemptLimit: 20,
      loginAttemptMaxTrackedKeys: 5000,
      loginAttemptWindowMs: 120_000,
      maxConcurrentVerifications: 4,
    });
    expect(() =>
      parseRuntimeConfig({ LOGIN_MAX_CONCURRENT_VERIFICATIONS: "0" }),
    ).toThrow(
      "Invalid runtime configuration: LOGIN_MAX_CONCURRENT_VERIFICATIONS",
    );
    expect(() =>
      parseRuntimeConfig({ LOGIN_RATE_LIMIT_ATTEMPTS: "0" }),
    ).toThrow("Invalid runtime configuration: LOGIN_RATE_LIMIT_ATTEMPTS");
    expect(() =>
      parseRuntimeConfig({ LOGIN_RATE_LIMIT_MAX_KEYS: "99" }),
    ).toThrow("Invalid runtime configuration: LOGIN_RATE_LIMIT_MAX_KEYS");
  });

  it("accepts only bounded HTTP request limits", () => {
    expect(
      parseRuntimeConfig({
        HTTP_RATE_LIMIT_REQUESTS: "1200",
        HTTP_RATE_LIMIT_WINDOW_SECONDS: "120",
        HTTP_TRUST_PROXY_HOPS: "2",
      }).http,
    ).toEqual({
      rateLimitRequests: 1200,
      rateLimitWindowMs: 120_000,
      trustProxyHops: 2,
    });
    expect(() => parseRuntimeConfig({ HTTP_RATE_LIMIT_REQUESTS: "0" })).toThrow(
      "Invalid runtime configuration: HTTP_RATE_LIMIT_REQUESTS",
    );
    expect(() =>
      parseRuntimeConfig({ HTTP_RATE_LIMIT_WINDOW_SECONDS: "3601" }),
    ).toThrow("Invalid runtime configuration: HTTP_RATE_LIMIT_WINDOW_SECONDS");
    expect(() => parseRuntimeConfig({ HTTP_TRUST_PROXY_HOPS: "9" })).toThrow(
      "Invalid runtime configuration: HTTP_TRUST_PROXY_HOPS",
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

  it("accepts bounded remote MCP request controls", () => {
    expect(
      parseRuntimeConfig({
        MCP_REMOTE_MAX_CONCURRENT_REQUESTS: "4",
        MCP_REMOTE_MAX_CONCURRENT_REQUESTS_PER_ACTOR: "2",
        MCP_REMOTE_MAX_REQUEST_BYTES: "32768",
        MCP_REMOTE_RATE_LIMIT_REQUESTS: "30",
        MCP_REMOTE_RATE_LIMIT_WINDOW_SECONDS: "120",
      }).mcp.request,
    ).toEqual({
      maxConcurrentRequests: 4,
      maxConcurrentRequestsPerActor: 2,
      maxRequestBytes: 32_768,
      rateLimitRequests: 30,
      rateLimitWindowMs: 120_000,
    });
  });

  it("rejects out-of-range remote MCP request controls", () => {
    expect(() =>
      parseRuntimeConfig({ MCP_REMOTE_MAX_REQUEST_BYTES: "512" }),
    ).toThrow("Invalid runtime configuration: MCP_REMOTE_MAX_REQUEST_BYTES");
    expect(() =>
      parseRuntimeConfig({ MCP_REMOTE_MAX_CONCURRENT_REQUESTS: "1" }),
    ).toThrow(
      "Invalid runtime configuration: MCP_REMOTE_MAX_CONCURRENT_REQUESTS",
    );
    expect(() =>
      parseRuntimeConfig({
        MCP_REMOTE_MAX_CONCURRENT_REQUESTS: "4",
        MCP_REMOTE_MAX_CONCURRENT_REQUESTS_PER_ACTOR: "4",
      }),
    ).toThrow(
      "Invalid runtime configuration: MCP_REMOTE_MAX_CONCURRENT_REQUESTS_PER_ACTOR",
    );
    expect(() =>
      parseRuntimeConfig({ MCP_REMOTE_RATE_LIMIT_REQUESTS: "10001" }),
    ).toThrow("Invalid runtime configuration: MCP_REMOTE_RATE_LIMIT_REQUESTS");
  });

  it("accepts only a complete local MCP actor binding", () => {
    expect(
      parseRuntimeConfig({
        MCP_LOCAL_ACTOR_USERNAME: "alex",
        MCP_LOCAL_WORKSPACE_SLUG: "default",
      }).mcp.local,
    ).toEqual({
      accessMode: "read_only",
      actorUsername: "alex",
      workspaceSlug: "default",
    });

    expect(
      parseRuntimeConfig({
        MCP_LOCAL_ACCESS_MODE: "read_write",
        MCP_LOCAL_ACTOR_USERNAME: "alex",
        MCP_LOCAL_WORKSPACE_SLUG: "default",
      }).mcp.local,
    ).toMatchObject({ accessMode: "read_write" });

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

  it("enables remote MCP with complete network settings and optional OAuth", () => {
    expect(parseRuntimeConfig(completeRemoteEnvironment).mcp.remote).toEqual({
      allowedHosts: ["tracker.example", "tracker.example:8443"],
      allowedOrigins: ["https://client.example", "https://desktop.example"],
      resourceUrl: "https://tracker.example/mcp",
    });

    expect(() =>
      parseRuntimeConfig({
        MCP_REMOTE_ENABLED: "true",
        MCP_REMOTE_URL: "https://tracker.example/mcp",
      }),
    ).toThrow("remote MCP requires complete network settings");
    expect(
      parseRuntimeConfig({
        MCP_REMOTE_ALLOWED_HOSTS: "tracker.example",
        MCP_REMOTE_ALLOWED_ORIGINS: "https://client.example",
        MCP_REMOTE_ENABLED: "true",
        MCP_REMOTE_URL: "https://tracker.example/mcp",
      }).mcp,
    ).toMatchObject({
      remote: {
        allowedHosts: ["tracker.example"],
        allowedOrigins: ["https://client.example"],
        resourceUrl: "https://tracker.example/mcp",
      },
    });
    expect(() =>
      parseRuntimeConfig({
        MCP_REMOTE_ENABLED: "false",
        MCP_REMOTE_URL: "https://tracker.example/mcp",
      }),
    ).toThrow("MCP_REMOTE_ENABLED must be true");
  });

  it("requires a canonical resource URL and matching audience", () => {
    expect(() =>
      parseRuntimeConfig({
        ...completeRemoteEnvironment,
        MCP_REMOTE_URL: "https://tracker.example/other",
      }),
    ).toThrow("MCP_REMOTE_URL must use the /mcp path");
    expect(() =>
      parseRuntimeConfig({
        ...completeRemoteEnvironment,
        MCP_OAUTH_AUDIENCE: "https://tracker.example/other",
      }),
    ).toThrow("MCP_OAUTH_AUDIENCE must equal MCP_REMOTE_URL");
  });

  it("rejects unsafe remote host and origin allowlists", () => {
    expect(() =>
      parseRuntimeConfig({
        ...completeRemoteEnvironment,
        MCP_REMOTE_ALLOWED_HOSTS: "other.example",
      }),
    ).toThrow("must include the remote URL host");
    expect(() =>
      parseRuntimeConfig({
        ...completeRemoteEnvironment,
        MCP_REMOTE_ALLOWED_HOSTS: "https://tracker.example",
      }),
    ).toThrow("Invalid runtime configuration: MCP_REMOTE_ALLOWED_HOSTS");
    expect(() =>
      parseRuntimeConfig({
        ...completeRemoteEnvironment,
        MCP_REMOTE_ALLOWED_ORIGINS: "http://client.example",
      }),
    ).toThrow("Invalid runtime configuration: MCP_REMOTE_ALLOWED_ORIGINS");
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
