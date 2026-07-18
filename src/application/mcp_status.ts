import type { AuthenticatedActor } from "./auth.js";
import { localMcpToolNames } from "./mcp.js";
import {
  emptyMcpAuditReader,
  type McpAuditEvent,
  type McpAuditReader,
} from "./mcp_audit.js";

export interface McpSessionPolicy {
  absoluteDurationMs: number;
  globalLimit: number;
  idleDurationMs: number;
  perActorLimit: number;
}

export interface McpRuntimeSnapshot {
  activeSessions: number;
  auditEventsAvailable: boolean;
  availability: "available" | "degraded" | "planned";
  initializingSessions: number;
  localTransportState: "ready" | "unavailable";
  oauthVerificationAvailable: boolean;
  registeredTools: number;
  remoteTransportState: "disabled" | "ready" | "unavailable";
  sessionEnforcement: "active" | "inactive";
}

export interface McpRuntimeStatusProvider {
  snapshot(workspaceId: string): McpRuntimeSnapshot;
}

export interface McpStatus {
  availability: McpRuntimeSnapshot["availability"];
  capabilities: {
    auditEvents: boolean;
    oauthVerification: boolean;
    registeredTools: number;
  };
  recentAuditEvents: McpAuditEvent[];
  sessions: {
    absoluteLifetimeSeconds: number;
    active: number;
    enforcement: McpRuntimeSnapshot["sessionEnforcement"];
    globalLimit: number;
    idleTimeoutSeconds: number;
    initializing: number;
    perActorLimit: number;
  };
  transports: {
    local: {
      state: McpRuntimeSnapshot["localTransportState"];
      transport: "stdio";
    };
    remote: {
      state: McpRuntimeSnapshot["remoteTransportState"];
      transport: "streamable_http";
    };
  };
}

export class McpStatusForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "McpStatusForbiddenError";
  }
}

export class LocalMcpRuntimeStatusProvider implements McpRuntimeStatusProvider {
  public snapshot(workspaceId: string): McpRuntimeSnapshot {
    void workspaceId;
    return {
      activeSessions: 0,
      auditEventsAvailable: true,
      availability: "available",
      initializingSessions: 0,
      localTransportState: "ready",
      oauthVerificationAvailable: false,
      registeredTools: localMcpToolNames.length,
      remoteTransportState: "disabled",
      sessionEnforcement: "inactive",
    };
  }
}

export class McpStatusService {
  public constructor(
    private readonly policy: McpSessionPolicy,
    private readonly provider: McpRuntimeStatusProvider = new LocalMcpRuntimeStatusProvider(),
    private readonly auditReader: McpAuditReader = emptyMcpAuditReader,
  ) {}

  public getStatus(actor: AuthenticatedActor): McpStatus {
    if (actor.user.role !== "admin") throw new McpStatusForbiddenError();

    const runtime = this.provider.snapshot(actor.workspaceId);
    return {
      availability: runtime.availability,
      capabilities: {
        auditEvents: runtime.auditEventsAvailable,
        oauthVerification: runtime.oauthVerificationAvailable,
        registeredTools: runtime.registeredTools,
      },
      recentAuditEvents: this.auditReader.listRecent(actor.workspaceId, 20),
      sessions: {
        absoluteLifetimeSeconds: this.policy.absoluteDurationMs / 1000,
        active: runtime.activeSessions,
        enforcement: runtime.sessionEnforcement,
        globalLimit: this.policy.globalLimit,
        idleTimeoutSeconds: this.policy.idleDurationMs / 1000,
        initializing: runtime.initializingSessions,
        perActorLimit: this.policy.perActorLimit,
      },
      transports: {
        local: { state: runtime.localTransportState, transport: "stdio" },
        remote: {
          state: runtime.remoteTransportState,
          transport: "streamable_http",
        },
      },
    };
  }
}
