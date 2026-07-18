import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  McpStatusForbiddenError,
  McpStatusService,
  LocalMcpRuntimeStatusProvider,
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
  it("reports the available local runtime without claiming remote controls", () => {
    const provider = new LocalMcpRuntimeStatusProvider();
    const snapshot = vi.spyOn(provider, "snapshot");
    const service = new McpStatusService(policy, provider);

    expect(service.getStatus(admin)).toEqual({
      availability: "available",
      capabilities: {
        auditEvents: false,
        oauthVerification: false,
        registeredTools: 5,
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
        local: { state: "ready", transport: "stdio" },
        remote: { state: "disabled", transport: "streamable_http" },
      },
    });
    expect(snapshot).toHaveBeenCalledWith("workspace-1");
  });

  it("requires an administrator", () => {
    const service = new McpStatusService(policy);
    const member: AuthenticatedActor = {
      ...admin,
      user: { ...admin.user, role: "member" },
    };

    expect(() => service.getStatus(member)).toThrow(McpStatusForbiddenError);
  });
});
