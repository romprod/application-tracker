import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import type { McpAccessMode } from "./mcp_access.js";
import type { McpAuditReader } from "./mcp_audit.js";
import {
  ApplicationMcpRuntimeStatusProvider,
  McpStatusForbiddenError,
  McpStatusService,
} from "./mcp_status.js";
import type { McpAccessSettingsProvider } from "./mcp_status.js";

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
      access: { mode: "read_only" },
      availability: "available",
      capabilities: {
        auditEvents: true,
        clientCredentials: true,
        oauthVerification: false,
        registeredTools: 8,
      },
      clients: { actors: [], clients: [] },
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
        remote: { state: "disabled", transport: "streamable_http" },
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

  it("updates the administrator-controlled access mode", () => {
    let mode: McpAccessMode = "read_only";
    const accessSettings: McpAccessSettingsProvider = {
      getAdministratorAccessMode: () => mode,
      setAdministratorAccessMode: (_actor, accessMode) => {
        mode = accessMode;
      },
    };
    const service = new McpStatusService(
      policy,
      undefined,
      undefined,
      accessSettings,
    );

    expect(service.setAccessMode(admin, "read_write").access.mode).toBe(
      "read_write",
    );
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
      { isAvailable: () => true },
    );

    expect(provider.snapshot("workspace-1").remoteTransportState).toBe("ready");
  });
});
