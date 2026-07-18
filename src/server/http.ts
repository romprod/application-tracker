import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createApp } from "./app.js";
import { parseRuntimeConfig } from "./config.js";

const environmentPath = resolve(process.cwd(), ".env");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}

const config = parseRuntimeConfig(process.env);
const staticRoot =
  config.nodeEnv === "production"
    ? resolve(process.cwd(), "dist/client")
    : undefined;
const app = createApp(staticRoot ? { staticRoot } : {});

const server = app.listen(config.port, config.host, () => {
  console.info(
    `Application Tracker listening on http://${config.host}:${String(config.port)}`,
  );
});

function shutdown(signal: string): void {
  console.info(`Received ${signal}; stopping Application Tracker`);
  server.close((error) => {
    if (error) {
      console.error("Application Tracker did not stop cleanly", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
