import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserMcpStatusClient,
  McpStatusClientError,
} from "./mcp_status_client";

const status = {
  availability: "planned",
  capabilities: {
    auditEvents: true,
    clientCredentials: true,
    oauthVerification: false,
    registeredTools: 0,
  },
  clients: {
    actors: [
      {
        displayName: "Alex Example",
        id: "user-0000000001",
        username: "alex",
      },
    ],
    clients: [],
    oauthClients: [],
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
    remote: {
      endpoint: null,
      state: "disabled",
      transport: "streamable_http",
    },
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

  it("accepts authorized OAuth connections in the issued-client register", async () => {
    const oauthStatus = {
      ...status,
      clients: {
        ...status.clients,
        oauthClients: [
          {
            accessMode: "read_write" as const,
            actor: status.clients.actors[0],
            clientId: "atoc_abcdefghijklmnopqrstuvwx",
            createdAt: "2026-01-01T10:00:00.000Z",
            lastUsedAt: "2026-01-01T10:01:00.000Z",
            name: "Claude",
            state: "active" as const,
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: oauthStatus }), {
          status: 200,
        }),
      ),
    );

    await expect(browserMcpStatusClient.getStatus()).resolves.toEqual(
      oauthStatus,
    );
  });

  it("accepts document-transfer audit actions and targets", async () => {
    const transferred = {
      ...status,
      recentAuditEvents: [
        {
          ...status.recentAuditEvents[0],
          action: "complete_document_import",
          targetType: "document",
        },
      ],
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: transferred }), {
          status: 200,
        }),
      ),
    );

    await expect(browserMcpStatusClient.getStatus()).resolves.toEqual(
      transferred,
    );
  });

  it("accepts job-email audit actions and targets", async () => {
    const reconciled = {
      ...status,
      recentAuditEvents: [
        {
          ...status.recentAuditEvents[0],
          action: "upsert_application_from_email",
          targetType: "job_email",
        },
      ],
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: reconciled }), {
          status: 200,
        }),
      ),
    );

    await expect(browserMcpStatusClient.getStatus()).resolves.toEqual(
      reconciled,
    );
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

  it("updates one client's access mode with a same-origin JSON request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserMcpStatusClient.updateClientAccessMode(
        "atmcp_abcdefghijklmnopqrstuvwx",
        "read_write",
      ),
    ).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/mcp/clients/atmcp_abcdefghijklmnopqrstuvwx",
      {
        body: JSON.stringify({ accessMode: "read_write" }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      },
    );
  });

  it("creates a client and accepts the one-time bearer token response", async () => {
    const client = {
      accessMode: "read_only",
      actor: status.clients.actors[0],
      clientId: "atmcp_abcdefghijklmnopqrstuvwx",
      createdAt: "2026-01-01T11:00:00.000Z",
      lastUsedAt: null,
      name: "Codex on laptop",
      rotatedAt: null,
      state: "active",
    } as const;
    const credential = {
      bearerToken:
        "atmcp_abcdefghijklmnopqrstuvwx.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
      client,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ credential, status }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserMcpStatusClient.createClient({
        accessMode: "read_only",
        actorUserId: "user-0000000001",
        name: "Codex on laptop",
      }),
    ).resolves.toEqual({ credential, status });
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/mcp/clients", {
      body: JSON.stringify({
        accessMode: "read_only",
        actorUserId: "user-0000000001",
        name: "Codex on laptop",
      }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("revokes a client with an encoded same-origin request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ client: {}, status }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserMcpStatusClient.revokeClient("atmcp_abcdefghijklmnopqrstuvwx"),
    ).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/mcp/clients/atmcp_abcdefghijklmnopqrstuvwx",
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
  });

  it("deletes an issued bearer client with an encoded same-origin request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserMcpStatusClient.deleteClient("atmcp_abcdefghijklmnopqrstuvwx"),
    ).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/mcp/clients/atmcp_abcdefghijklmnopqrstuvwx/permanent",
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
  });

  it("deletes an OAuth connection for its bound local user", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserMcpStatusClient.deleteOAuthClient(
        "atoc_abcdefghijklmnopqrstuvwx",
        "user-0000000001",
      ),
    ).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/mcp/oauth-clients/atoc_abcdefghijklmnopqrstuvwx/users/user-0000000001",
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
  });

  it("accepts the configured public MCP endpoint", async () => {
    const configured = {
      ...status,
      transports: {
        ...status.transports,
        remote: {
          endpoint: "https://tracker.example/mcp",
          state: "ready" as const,
          transport: "streamable_http" as const,
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ status: configured }), { status: 200 }),
        ),
    );

    await expect(browserMcpStatusClient.getStatus()).resolves.toEqual(
      configured,
    );
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
