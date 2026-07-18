import { z } from "zod";

const runtimeEnvironmentSchema = z.object({
  DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default("./data/application-tracker.sqlite"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
});

export interface RuntimeConfig {
  databasePath: string;
  host: string;
  nodeEnv: "development" | "test" | "production";
  port: number;
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

  return {
    databasePath: result.data.DATABASE_PATH,
    host: result.data.HOST,
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
  };
}
