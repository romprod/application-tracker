import { describe, expect, it, vi } from "vitest";

import {
  McpActorSessionLimitError,
  McpGlobalSessionLimitError,
  RemoteMcpSessionRegistry,
} from "./mcp_sessions.js";

const policy = {
  absoluteDurationMs: 120_000,
  globalLimit: 2,
  idleDurationMs: 60_000,
  perActorLimit: 1,
};

function sequenceIds(): () => string {
  let sequence = 0;
  return () => `remote-session-${String(++sequence)}`;
}

describe("RemoteMcpSessionRegistry", () => {
  it("rejects an incomplete trusted actor binding", async () => {
    const registry = new RemoteMcpSessionRegistry(
      policy,
      () => new Date("2026-01-01T00:00:00.000Z"),
      sequenceIds(),
    );

    await expect(
      registry.reserve({ actorUserId: "", workspaceId: "workspace-1" }),
    ).rejects.toThrow("Invalid MCP session identity");
    await expect(
      registry.reserve({ actorUserId: "actor-1", workspaceId: " " }),
    ).rejects.toThrow("Invalid MCP session identity");
  });

  it("reserves capacity atomically across concurrent initializations", async () => {
    const registry = new RemoteMcpSessionRegistry(
      policy,
      () => new Date("2026-01-01T00:00:00.000Z"),
      sequenceIds(),
    );

    const sameActor = await Promise.allSettled([
      registry.reserve({ actorUserId: "actor-1", workspaceId: "workspace-1" }),
      registry.reserve({ actorUserId: "actor-1", workspaceId: "workspace-1" }),
    ]);

    expect(
      sameActor.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = sameActor.find(({ status }) => status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (!rejected || rejected.status !== "rejected") {
      throw new Error("Expected one rejected reservation");
    }
    const reason = rejected.reason as unknown;
    expect(reason).toBeInstanceOf(McpActorSessionLimitError);
    expect(reason).toMatchObject({ code: "actor_session_limit" });

    await registry.reserve({
      actorUserId: "actor-2",
      workspaceId: "workspace-1",
    });
    await expect(
      registry.reserve({
        actorUserId: "actor-3",
        workspaceId: "workspace-2",
      }),
    ).rejects.toBeInstanceOf(McpGlobalSessionLimitError);
    expect(registry.sessionCounts("workspace-1")).toEqual({
      active: 0,
      initializing: 2,
    });
    expect(registry.sessionCounts("workspace-2")).toEqual({
      active: 0,
      initializing: 0,
    });
  });

  it("activates, refreshes idle expiry, and closes expired resources", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const close = vi.fn();
    const registry = new RemoteMcpSessionRegistry(
      policy,
      () => now,
      sequenceIds(),
    );
    const reservation = await registry.reserve({
      actorUserId: "actor-1",
      workspaceId: "workspace-1",
    });

    await expect(registry.activate(reservation.id, { close })).resolves.toBe(
      true,
    );
    expect(registry.sessionCounts("workspace-1")).toEqual({
      active: 1,
      initializing: 0,
    });

    now = new Date("2026-01-01T00:00:50.000Z");
    await expect(registry.touch(reservation.id)).resolves.toBe(true);
    now = new Date("2026-01-01T00:01:05.000Z");
    await expect(registry.cleanupExpired()).resolves.toEqual({
      closed: 0,
      failures: 0,
    });
    now = new Date("2026-01-01T00:01:51.000Z");
    await expect(registry.cleanupExpired()).resolves.toEqual({
      closed: 1,
      failures: 0,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(registry.sessionCounts("workspace-1")).toEqual({
      active: 0,
      initializing: 0,
    });
  });

  it("caps refreshed sessions at their absolute lifetime", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const close = vi.fn();
    const registry = new RemoteMcpSessionRegistry(
      policy,
      () => now,
      sequenceIds(),
    );
    const reservation = await registry.reserve({
      actorUserId: "actor-1",
      workspaceId: "workspace-1",
    });
    await registry.activate(reservation.id, { close });

    now = new Date("2026-01-01T00:00:50.000Z");
    await registry.touch(reservation.id);
    now = new Date("2026-01-01T00:01:40.000Z");
    await registry.touch(reservation.id);
    now = new Date("2026-01-01T00:02:01.000Z");

    await expect(registry.cleanupExpired()).resolves.toEqual({
      closed: 1,
      failures: 0,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("expires abandoned initialization and releases its reserved capacity", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const registry = new RemoteMcpSessionRegistry(
      policy,
      () => now,
      sequenceIds(),
    );
    await registry.reserve({
      actorUserId: "actor-1",
      workspaceId: "workspace-1",
    });

    now = new Date("2026-01-01T00:01:01.000Z");

    await expect(registry.cleanupExpired()).resolves.toEqual({
      closed: 1,
      failures: 0,
    });
    await expect(
      registry.reserve({
        actorUserId: "actor-1",
        workspaceId: "workspace-1",
      }),
    ).resolves.toMatchObject({ state: "initializing" });
  });

  it("handles explicit close and late activation without leaking resources", async () => {
    const close = vi.fn();
    const lateClose = vi.fn();
    const registry = new RemoteMcpSessionRegistry(
      policy,
      () => new Date("2026-01-01T00:00:00.000Z"),
      sequenceIds(),
    );
    const active = await registry.reserve({
      actorUserId: "actor-1",
      workspaceId: "workspace-1",
    });
    await registry.activate(active.id, { close });

    await expect(registry.close(active.id)).resolves.toEqual({
      closed: 1,
      failures: 0,
    });
    await expect(registry.close(active.id)).resolves.toEqual({
      closed: 0,
      failures: 0,
    });
    expect(close).toHaveBeenCalledOnce();

    const initializing = await registry.reserve({
      actorUserId: "actor-2",
      workspaceId: "workspace-1",
    });
    await expect(registry.closeAll()).resolves.toEqual({
      closed: 1,
      failures: 0,
    });
    await expect(
      registry.activate(initializing.id, { close: lateClose }),
    ).resolves.toBe(false);
    expect(lateClose).toHaveBeenCalledOnce();
  });

  it("releases capacity even when resource cleanup fails", async () => {
    const registry = new RemoteMcpSessionRegistry(
      policy,
      () => new Date("2026-01-01T00:00:00.000Z"),
      sequenceIds(),
    );
    const reservation = await registry.reserve({
      actorUserId: "actor-1",
      workspaceId: "workspace-1",
    });
    await registry.activate(reservation.id, {
      close: () => {
        throw new Error("synthetic close failure");
      },
    });

    await expect(registry.closeAll()).resolves.toEqual({
      closed: 1,
      failures: 1,
    });
    await expect(
      registry.reserve({
        actorUserId: "actor-2",
        workspaceId: "workspace-1",
      }),
    ).resolves.toMatchObject({ state: "initializing" });
  });
});
