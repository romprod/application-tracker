import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const compiledServer = join(repositoryRoot, "dist/server/server/http.js");
const compiledClient = join(repositoryRoot, "dist/client/index.html");
const setupToken = process.env.E2E_SETUP_TOKEN;
const port = Number.parseInt(process.env.E2E_PORT ?? "4173", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("E2E_PORT must be an integer between 1 and 65535");
}
if (!setupToken || setupToken.length < 32 || setupToken.length > 512) {
  throw new Error("E2E_SETUP_TOKEN must contain between 32 and 512 characters");
}

await access(compiledServer);
await access(compiledClient);

const temporaryRoot = await mkdtemp(join(tmpdir(), "application-tracker-e2e-"));
const databasePath = join(temporaryRoot, "data/application-tracker.sqlite");
const backupDirectory = join(temporaryRoot, "backups");
await mkdir(dirname(databasePath), { recursive: true });
await mkdir(backupDirectory, { recursive: true });
await symlink(join(repositoryRoot, "dist"), join(temporaryRoot, "dist"), "dir");

let cleanupPromise;
function cleanup() {
  cleanupPromise ??= rm(temporaryRoot, { force: true, recursive: true });
  return cleanupPromise;
}

const server = spawn(process.execPath, [compiledServer], {
  cwd: temporaryRoot,
  env: {
    BACKUP_DIRECTORY: backupDirectory,
    DATABASE_PATH: databasePath,
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    PORT: String(port),
    SESSION_COOKIE_SECURE: "false",
    SETUP_TOKEN: setupToken,
  },
  stdio: "inherit",
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (!server.kill(signal)) {
    process.exitCode = 1;
    void cleanup();
  }
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

server.once("error", (error) => {
  console.error("The E2E application server could not start", error);
  process.exitCode = 1;
  void cleanup();
});

server.once("exit", (code, signal) => {
  if (!stopping) {
    console.error(
      `The E2E application server exited unexpectedly (${signal ?? code ?? "unknown"})`,
    );
    process.exitCode = code && code > 0 ? code : 1;
  }
  void cleanup().catch((error) => {
    console.error("The E2E temporary directory could not be removed", error);
    process.exitCode = 1;
  });
});
