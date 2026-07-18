import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteMcpSessionRegistry } from "../application/mcp_sessions.js";
import type { ApplicationLogger } from "./logging.js";
import { McpSessionRuntime } from "./mcp_session_runtime.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("McpSessionRuntime", () => {
  it("closes expired resources without waiting for another request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const close = vi.fn();
    const info = vi.fn<ApplicationLogger["info"]>();
    const logger: ApplicationLogger = { error: vi.fn(), info };
    const registry = new RemoteMcpSessionRegistry(
      {
        absoluteDurationMs: 10_000,
        globalLimit: 2,
        idleDurationMs: 2_000,
        perActorLimit: 1,
      },
      () => new Date(),
      () => "remote-session-1",
    );
    const reservation = await registry.reserve({
      actorUserId: "actor-1",
      workspaceId: "workspace-1",
    });
    await registry.activate(reservation.id, { close });
    const runtime = new McpSessionRuntime(registry, 1_000, logger);
    runtime.start();

    await vi.advanceTimersByTimeAsync(3_000);

    expect(close).toHaveBeenCalledOnce();
    expect(registry.sessionCounts("workspace-1")).toEqual({
      active: 0,
      initializing: 0,
    });
    expect(info).toHaveBeenCalledWith("mcp_sessions_expired", {
      closed: 1,
      failures: 0,
    });
    await runtime.stop();
  });

  it("clears all active and initializing sessions during shutdown", async () => {
    const close = vi.fn();
    const info = vi.fn<ApplicationLogger["info"]>();
    const logger: ApplicationLogger = { error: vi.fn(), info };
    let sequence = 0;
    const registry = new RemoteMcpSessionRegistry(
      {
        absoluteDurationMs: 120_000,
        globalLimit: 2,
        idleDurationMs: 60_000,
        perActorLimit: 1,
      },
      () => new Date("2026-01-01T00:00:00.000Z"),
      () => `remote-session-${String(++sequence)}`,
    );
    const active = await registry.reserve({
      actorUserId: "actor-1",
      workspaceId: "workspace-1",
    });
    await registry.activate(active.id, { close });
    await registry.reserve({
      actorUserId: "actor-2",
      workspaceId: "workspace-1",
    });
    const runtime = new McpSessionRuntime(registry, 30_000, logger);
    runtime.start();

    await expect(runtime.stop()).resolves.toEqual({
      closed: 2,
      failures: 0,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(registry.sessionCounts("workspace-1")).toEqual({
      active: 0,
      initializing: 0,
    });
    expect(info).toHaveBeenCalledWith("mcp_sessions_closed", {
      closed: 2,
      failures: 0,
    });
  });
});
