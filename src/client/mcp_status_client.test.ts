import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserMcpStatusClient,
  McpStatusClientError,
} from "./mcp_status_client";

const status = {
  access: { mode: "read_only" },
  availability: "planned",
  capabilities: {
    auditEvents: true,
    oauthVerification: false,
    registeredTools: 0,
  },
  recentAuditEvents: [
    {
      action: "get_tracker_context",
      actor: { displayName: "Alex Example", username: "alex" },
      occurredAt: "2026-01-01T10:00:00.000Z",
      result: "success",
      targetType: "workspace",
      transport: "local_stdio",
    },
  ],
  sessions: {
    absoluteLifetimeSeconds: 14_400,
    active: 0,
    enforcement: "active",
    globalLimit: 6,
    idleTimeoutSeconds: 900,
    initializing: 0,
    perActorLimit: 2,
  },
  transports: {
    local: { state: "unavailable", transport: "stdio" },
    remote: { state: "disabled", transport: "streamable_http" },
  },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserMcpStatusClient", () => {
  it("loads the administrator status without caching it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(browserMcpStatusClient.getStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/mcp", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("rejects a malformed status instead of guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: { availability: "ready" } }), {
          status: 200,
        }),
      ),
    );

    await expect(browserMcpStatusClient.getStatus()).rejects.toEqual(
      new McpStatusClientError("invalid_response"),
    );
  });

  it("updates the workspace access mode with a same-origin JSON request", async () => {
    const writable = { ...status, access: { mode: "read_write" as const } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: writable }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserMcpStatusClient.setAccessMode("read_write"),
    ).resolves.toEqual(writable);
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/mcp", {
      body: JSON.stringify({ accessMode: "read_write" }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
  });

  it("rejects malformed audit events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: {
              ...status,
              recentAuditEvents: [{ actor: { username: "alex" } }],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(browserMcpStatusClient.getStatus()).rejects.toEqual(
      new McpStatusClientError("invalid_response"),
    );
  });
});
