import type {
  McpSessionCleanupResult,
  RemoteMcpSessionRegistry,
} from "../application/mcp_sessions.js";
import { noOpLogger, type ApplicationLogger } from "./logging.js";

export class McpSessionRuntime {
  private cleanupTask: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly registry: RemoteMcpSessionRegistry,
    private readonly cleanupIntervalMs: number,
    private readonly logger: ApplicationLogger = noOpLogger,
  ) {
    if (!Number.isInteger(cleanupIntervalMs) || cleanupIntervalMs < 1) {
      throw new Error("Invalid MCP session cleanup interval");
    }
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runCleanup(), this.cleanupIntervalMs);
    this.timer.unref();
  }

  public async stop(): Promise<McpSessionCleanupResult> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.cleanupTask;
    const result = await this.registry.closeAll();
    if (result.closed > 0) {
      this.logger.info("mcp_sessions_closed", {
        closed: result.closed,
        failures: result.failures,
      });
    }
    if (result.failures > 0) {
      this.logger.error("mcp_session_resource_cleanup_failed", {
        closed: result.closed,
        failures: result.failures,
      });
    }
    return result;
  }

  private runCleanup(): void {
    if (this.cleanupTask) return;
    const task = this.registry
      .cleanupExpired()
      .then((result) => {
        if (result.closed > 0) {
          this.logger.info("mcp_sessions_expired", {
            closed: result.closed,
            failures: result.failures,
          });
        }
        if (result.failures > 0) {
          this.logger.error("mcp_session_resource_cleanup_failed", {
            closed: result.closed,
            failures: result.failures,
          });
        }
      })
      .catch((error: unknown) => {
        this.logger.error("mcp_session_cleanup_failed", { error });
      })
      .finally(() => {
        if (this.cleanupTask === task) this.cleanupTask = undefined;
      });
    this.cleanupTask = task;
  }
}
