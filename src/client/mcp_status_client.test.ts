import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserMcpStatusClient,
  McpStatusClientError,
} from "./mcp_status_client";

const status = {
  availability: "planned",
  capabilities: {
    auditEvents: false,
    oauthVerification: false,
    registeredTools: 0,
  },
  sessions: {
    absoluteLifetimeSeconds: 14_400,
    active: 0,
    enforcement: "inactive",
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
});
