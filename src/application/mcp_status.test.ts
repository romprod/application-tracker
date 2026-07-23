import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import type { McpAuditReader } from "./mcp_audit.js";
import {
  ApplicationMcpRuntimeStatusProvider,
  McpStatusForbiddenError,
  McpStatusService,
} from "./mcp_status.js";

const admin: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};

const policy = {
  absoluteDurationMs: 14_400_000,
  globalLimit: 6,
  idleDurationMs: 900_000,
  perActorLimit: 2,
};

describe("McpStatusService", () => {
  it("reports enforced registry counts without claiming a remote transport", () => {
    const sessionCounts = vi.fn(() => ({ active: 2, initializing: 1 }));
    const provider = new ApplicationMcpRuntimeStatusProvider({ sessionCounts });
    const snapshot = vi.spyOn(provider, "snapshot");
    const listRecent = vi.fn(() => [
      {
        action: "get_tracker_context" as const,
        actor: { displayName: "Alex", username: "alex" },
        occurredAt: "2026-01-01T10:00:00.000Z",
        result: "success" as const,
        targetType: "workspace" as const,
        transport: "local_stdio" as const,
      },
    ]);
    const auditReader: McpAuditReader = {
      listRecent,
    };
    const service = new McpStatusService(policy, provider, auditReader);

    expect(service.getStatus(admin)).toEqual({
      availability: "available",
      capabilities: {
        auditEvents: true,
        clientCredentials: true,
        oauthVerification: false,
        registeredTools: 19,
      },
      clients: { actors: [], clients: [], oauthClients: [] },
      recentAuditEvents: [
        {
          action: "get_tracker_context",
          actor: { displayName: "Alex", username: "alex" },
          occurredAt: "2026-01-01T10:00:00.000Z",
          result: "success",
          targetType: "workspace",
          transport: "local_stdio",
        },
      ],
      sessions: {
        absoluteLifetimeSeconds: 14_400,
        active: 2,
        enforcement: "active",
        globalLimit: 6,
        idleTimeoutSeconds: 900,
        initializing: 1,
        perActorLimit: 2,
      },
      transports: {
        local: { state: "ready", transport: "stdio" },
        remote: {
          endpoint: null,
          state: "disabled",
          transport: "streamable_http",
        },
      },
    });
    expect(snapshot).toHaveBeenCalledWith("workspace-1");
    expect(sessionCounts).toHaveBeenCalledWith("workspace-1");
    expect(listRecent).toHaveBeenCalledWith("workspace-1", 20);
  });

  it("requires an administrator", () => {
    const service = new McpStatusService(policy);
    const member: AuthenticatedActor = {
      ...admin,
      user: { ...admin.user, role: "member" },
    };

    expect(() => service.getStatus(member)).toThrow(McpStatusForbiddenError);
  });

  it("includes authorized OAuth connections in the issued-client register", () => {
    const listConnections = vi.fn(() => [
      {
        accessMode: "read_write" as const,
        actor: { displayName: "Alex", id: "user-1", username: "alex" },
        clientId: "atoc_abcdefghijklmnopqrstuvwx",
        createdAt: "2026-01-01T10:00:00.000Z",
        lastUsedAt: "2026-01-01T10:01:00.000Z",
        name: "Claude",
        state: "active" as const,
      },
    ]);
    const service = new McpStatusService(
      policy,
      undefined,
      undefined,
      undefined,
      { listConnections },
    );

    expect(service.getStatus(admin).clients.oauthClients).toMatchObject([
      { clientId: "atoc_abcdefghijklmnopqrstuvwx", name: "Claude" },
    ]);
    expect(listConnections).toHaveBeenCalledWith(admin);
  });

  it("reports OAuth verification only when an authorization service exists", () => {
    const provider = new ApplicationMcpRuntimeStatusProvider(undefined, {
      authorize: vi.fn(() => Promise.resolve(admin)),
    });

    expect(provider.snapshot("workspace-1").oauthVerificationAvailable).toBe(
      true,
    );
  });

  it("reports the remote transport ready only when its endpoint is available", () => {
    const provider = new ApplicationMcpRuntimeStatusProvider(
      undefined,
      undefined,
      {
        isAvailable: () => true,
        resourceUrl: () => "https://tracker.example/mcp",
      },
    );

    expect(provider.snapshot("workspace-1").remoteTransportState).toBe("ready");
    expect(provider.snapshot("workspace-1").remoteEndpoint).toBe(
      "https://tracker.example/mcp",
    );
  });
});
