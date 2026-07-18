import { z } from "zod";

const runtimeEnvironmentSchema = z.object({
  BACKUP_DIRECTORY: z.string().trim().min(1).default("./backups"),
  DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default("./data/application-tracker.sqlite"),
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
  host: string;
  mcp: {
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
    host: result.data.HOST,
    mcp: {
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
