import { z } from "zod";

import {
  supportedMcpOAuthAlgorithms,
  type McpOAuthConfig,
  type RemoteMcpNetworkConfig,
} from "../application/mcp_oauth.js";
import type { RemoteMcpRequestPolicy } from "./mcp_http_limits.js";

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function secureConfigurationUrl(value: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid runtime configuration: ${field}`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`Invalid runtime configuration: ${field}`);
  }
  return url;
}

function configurationList(
  value: string,
  field: string,
  normalize: (entry: string) => string,
): readonly string[] {
  const entries = value.split(",").map((entry) => entry.trim());
  if (
    entries.length === 0 ||
    entries.length > 32 ||
    entries.some((entry) => entry.length === 0)
  ) {
    throw new Error(`Invalid runtime configuration: ${field}`);
  }
  const normalized = entries.map(normalize);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Invalid runtime configuration: ${field}`);
  }
  return normalized;
}

function parseAllowedHosts(value: string): readonly string[] {
  return configurationList(value, "MCP_REMOTE_ALLOWED_HOSTS", (entry) => {
    const normalized = entry.toLowerCase();
    let parsed: URL;
    try {
      parsed = new URL(`https://${normalized}`);
    } catch {
      throw new Error(
        "Invalid runtime configuration: MCP_REMOTE_ALLOWED_HOSTS",
      );
    }
    if (
      parsed.host !== normalized ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error(
        "Invalid runtime configuration: MCP_REMOTE_ALLOWED_HOSTS",
      );
    }
    return normalized;
  });
}

function parseAllowedOrigins(value: string): readonly string[] {
  return configurationList(value, "MCP_REMOTE_ALLOWED_ORIGINS", (entry) => {
    const parsed = secureConfigurationUrl(entry, "MCP_REMOTE_ALLOWED_ORIGINS");
    if (parsed.pathname !== "/") {
      throw new Error(
        "Invalid runtime configuration: MCP_REMOTE_ALLOWED_ORIGINS",
      );
    }
    return parsed.origin;
  });
}

const runtimeEnvironmentSchema = z.object({
  BACKUP_DIRECTORY: z.string().trim().min(1).default("./backups"),
  DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default("./data/application-tracker.sqlite"),
  DOCUMENT_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(52_428_800)
    .default(10_485_760),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  MCP_SESSION_ABSOLUTE_SECONDS: z.coerce
    .number()
    .int()
    .min(900)
    .max(604_800)
    .default(14_400),
  MCP_SESSION_GLOBAL_LIMIT: z.coerce.number().int().min(1).max(1000).default(6),
  MCP_SESSION_IDLE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(900),
  MCP_SESSION_PER_ACTOR_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(2),
  MCP_LOCAL_ACTOR_USERNAME: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      .optional(),
  ),
  MCP_LOCAL_WORKSPACE_SLUG: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
      .optional(),
  ),
  MCP_OAUTH_ALGORITHM: z.preprocess(
    blankToUndefined,
    z.enum(supportedMcpOAuthAlgorithms).optional(),
  ),
  MCP_OAUTH_AUDIENCE: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(512).optional(),
  ),
  MCP_OAUTH_ISSUER: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(2048).optional(),
  ),
  MCP_OAUTH_JWKS_URL: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(2048).optional(),
  ),
  MCP_OAUTH_REQUIRED_SCOPE: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/)
      .optional(),
  ),
  MCP_OAUTH_WORKSPACE_SLUG: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
      .optional(),
  ),
  MCP_REMOTE_ALLOWED_HOSTS: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(4096).optional(),
  ),
  MCP_REMOTE_ALLOWED_ORIGINS: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(4096).optional(),
  ),
  MCP_REMOTE_ENABLED: z.enum(["true", "false"]).default("false"),
  MCP_REMOTE_MAX_CONCURRENT_REQUESTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(8),
  MCP_REMOTE_MAX_REQUEST_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(1_048_576)
    .default(65_536),
  MCP_REMOTE_RATE_LIMIT_REQUESTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(60),
  MCP_REMOTE_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3600)
    .default(60),
  MCP_REMOTE_URL: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(2048).optional(),
  ),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
  SESSION_ABSOLUTE_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(2_592_000)
    .default(86_400),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  SESSION_IDLE_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(1800),
  SESSION_REFRESH_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(60),
  SETUP_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32).max(512).optional(),
  ),
});

export interface RuntimeConfig {
  backupDirectory: string;
  databasePath: string;
  documents: {
    maxUploadBytes: number;
  };
  host: string;
  mcp: {
    local?: {
      actorUsername: string;
      workspaceSlug: string;
    };
    oauth?: McpOAuthConfig;
    remote?: RemoteMcpNetworkConfig;
    request: RemoteMcpRequestPolicy;
    session: {
      absoluteDurationMs: number;
      globalLimit: number;
      idleDurationMs: number;
      perActorLimit: number;
    };
  };
  nodeEnv: "development" | "test" | "production";
  port: number;
  session: {
    absoluteDurationMs: number;
    cookieSecure: boolean;
    idleDurationMs: number;
    refreshIntervalMs: number;
  };
  setupToken?: string;
}

export function parseRuntimeConfig(
  environment: Record<string, string | undefined>,
): RuntimeConfig {
  const result = runtimeEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join(".") || "environment")
      .join(", ");
    throw new Error(`Invalid runtime configuration: ${fields}`);
  }

  if (
    Boolean(result.data.MCP_LOCAL_ACTOR_USERNAME) !==
    Boolean(result.data.MCP_LOCAL_WORKSPACE_SLUG)
  ) {
    throw new Error(
      "Invalid runtime configuration: MCP_LOCAL_ACTOR_USERNAME, MCP_LOCAL_WORKSPACE_SLUG",
    );
  }

  const oauthFields = [
    result.data.MCP_OAUTH_ALGORITHM,
    result.data.MCP_OAUTH_AUDIENCE,
    result.data.MCP_OAUTH_ISSUER,
    result.data.MCP_OAUTH_JWKS_URL,
    result.data.MCP_OAUTH_REQUIRED_SCOPE,
    result.data.MCP_OAUTH_WORKSPACE_SLUG,
  ];
  const configuredOauthFields = oauthFields.filter(Boolean).length;
  if (
    configuredOauthFields !== 0 &&
    configuredOauthFields !== oauthFields.length
  ) {
    throw new Error(
      "Invalid runtime configuration: MCP OAuth settings must be configured together",
    );
  }

  let oauth: McpOAuthConfig | undefined;
  if (
    result.data.MCP_OAUTH_ALGORITHM &&
    result.data.MCP_OAUTH_AUDIENCE &&
    result.data.MCP_OAUTH_ISSUER &&
    result.data.MCP_OAUTH_JWKS_URL &&
    result.data.MCP_OAUTH_REQUIRED_SCOPE &&
    result.data.MCP_OAUTH_WORKSPACE_SLUG
  ) {
    const issuer = secureConfigurationUrl(
      result.data.MCP_OAUTH_ISSUER,
      "MCP_OAUTH_ISSUER",
    );
    const jwks = secureConfigurationUrl(
      result.data.MCP_OAUTH_JWKS_URL,
      "MCP_OAUTH_JWKS_URL",
    );
    if (issuer.origin !== jwks.origin) {
      throw new Error(
        "Invalid runtime configuration: MCP_OAUTH_JWKS_URL must use the issuer origin",
      );
    }
    oauth = {
      algorithm: result.data.MCP_OAUTH_ALGORITHM,
      audience: result.data.MCP_OAUTH_AUDIENCE,
      issuer: result.data.MCP_OAUTH_ISSUER,
      jwksUrl: result.data.MCP_OAUTH_JWKS_URL,
      requiredScope: result.data.MCP_OAUTH_REQUIRED_SCOPE,
      workspaceSlug: result.data.MCP_OAUTH_WORKSPACE_SLUG,
    };
  }

  const remoteFields = [
    result.data.MCP_REMOTE_URL,
    result.data.MCP_REMOTE_ALLOWED_HOSTS,
    result.data.MCP_REMOTE_ALLOWED_ORIGINS,
  ];
  const configuredRemoteFields = remoteFields.filter(Boolean).length;
  if (
    result.data.MCP_REMOTE_ENABLED === "false" &&
    configuredRemoteFields > 0
  ) {
    throw new Error(
      "Invalid runtime configuration: MCP_REMOTE_ENABLED must be true when remote settings are present",
    );
  }
  if (
    result.data.MCP_REMOTE_ENABLED === "true" &&
    (configuredRemoteFields !== remoteFields.length || !oauth)
  ) {
    throw new Error(
      "Invalid runtime configuration: remote MCP requires complete network and OAuth settings",
    );
  }

  let remote: RuntimeConfig["mcp"]["remote"];
  if (
    result.data.MCP_REMOTE_ENABLED === "true" &&
    result.data.MCP_REMOTE_URL &&
    result.data.MCP_REMOTE_ALLOWED_HOSTS &&
    result.data.MCP_REMOTE_ALLOWED_ORIGINS &&
    oauth
  ) {
    const resourceUrl = secureConfigurationUrl(
      result.data.MCP_REMOTE_URL,
      "MCP_REMOTE_URL",
    );
    if (resourceUrl.pathname !== "/mcp") {
      throw new Error(
        "Invalid runtime configuration: MCP_REMOTE_URL must use the /mcp path",
      );
    }
    if (oauth.audience !== resourceUrl.href) {
      throw new Error(
        "Invalid runtime configuration: MCP_OAUTH_AUDIENCE must equal MCP_REMOTE_URL",
      );
    }
    const allowedHosts = parseAllowedHosts(
      result.data.MCP_REMOTE_ALLOWED_HOSTS,
    );
    const allowedOrigins = parseAllowedOrigins(
      result.data.MCP_REMOTE_ALLOWED_ORIGINS,
    );
    if (!allowedHosts.includes(resourceUrl.host.toLowerCase())) {
      throw new Error(
        "Invalid runtime configuration: MCP_REMOTE_ALLOWED_HOSTS must include the remote URL host",
      );
    }
    remote = {
      allowedHosts,
      allowedOrigins,
      resourceUrl: resourceUrl.href,
    };
  }

  if (
    result.data.SESSION_ABSOLUTE_SECONDS <= result.data.SESSION_IDLE_SECONDS
  ) {
    throw new Error("Invalid runtime configuration: SESSION_ABSOLUTE_SECONDS");
  }

  if (result.data.SESSION_REFRESH_SECONDS >= result.data.SESSION_IDLE_SECONDS) {
    throw new Error("Invalid runtime configuration: SESSION_REFRESH_SECONDS");
  }

  if (
    result.data.MCP_SESSION_GLOBAL_LIMIT <
    result.data.MCP_SESSION_PER_ACTOR_LIMIT
  ) {
    throw new Error("Invalid runtime configuration: MCP_SESSION_GLOBAL_LIMIT");
  }

  if (
    result.data.MCP_SESSION_ABSOLUTE_SECONDS <=
    result.data.MCP_SESSION_IDLE_SECONDS
  ) {
    throw new Error(
      "Invalid runtime configuration: MCP_SESSION_ABSOLUTE_SECONDS",
    );
  }

  return {
    backupDirectory: result.data.BACKUP_DIRECTORY,
    databasePath: result.data.DATABASE_PATH,
    documents: { maxUploadBytes: result.data.DOCUMENT_MAX_UPLOAD_BYTES },
    host: result.data.HOST,
    mcp: {
      ...(result.data.MCP_LOCAL_ACTOR_USERNAME &&
      result.data.MCP_LOCAL_WORKSPACE_SLUG
        ? {
            local: {
              actorUsername: result.data.MCP_LOCAL_ACTOR_USERNAME,
              workspaceSlug: result.data.MCP_LOCAL_WORKSPACE_SLUG,
            },
          }
        : {}),
      ...(oauth ? { oauth } : {}),
      ...(remote ? { remote } : {}),
      request: {
        maxConcurrentRequests: result.data.MCP_REMOTE_MAX_CONCURRENT_REQUESTS,
        maxRequestBytes: result.data.MCP_REMOTE_MAX_REQUEST_BYTES,
        rateLimitRequests: result.data.MCP_REMOTE_RATE_LIMIT_REQUESTS,
        rateLimitWindowMs:
          result.data.MCP_REMOTE_RATE_LIMIT_WINDOW_SECONDS * 1000,
      },
      session: {
        absoluteDurationMs: result.data.MCP_SESSION_ABSOLUTE_SECONDS * 1000,
        globalLimit: result.data.MCP_SESSION_GLOBAL_LIMIT,
        idleDurationMs: result.data.MCP_SESSION_IDLE_SECONDS * 1000,
        perActorLimit: result.data.MCP_SESSION_PER_ACTOR_LIMIT,
      },
    },
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    session: {
      absoluteDurationMs: result.data.SESSION_ABSOLUTE_SECONDS * 1000,
      cookieSecure:
        result.data.SESSION_COOKIE_SECURE === undefined
          ? result.data.NODE_ENV === "production"
          : result.data.SESSION_COOKIE_SECURE === "true",
      idleDurationMs: result.data.SESSION_IDLE_SECONDS * 1000,
      refreshIntervalMs: result.data.SESSION_REFRESH_SECONDS * 1000,
    },
    ...(result.data.SETUP_TOKEN ? { setupToken: result.data.SETUP_TOKEN } : {}),
  };
}
