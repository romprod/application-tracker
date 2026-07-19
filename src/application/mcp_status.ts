import type { AuthenticatedActor } from "./auth.js";
import { applicationMcpToolNames } from "./mcp.js";
import type { McpAccessMode } from "./mcp_access.js";
import {
  emptyMcpAuditReader,
  type McpAuditEvent,
  type McpAuditReader,
} from "./mcp_audit.js";
import type { McpSessionCounts, McpSessionPolicy } from "./mcp_sessions.js";

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

export interface McpSessionCountsProvider {
  sessionCounts(workspaceId: string): McpSessionCounts;
}

export interface McpOAuthAuthorizationProvider {
  authorize(token: string): Promise<AuthenticatedActor>;
}

export interface McpRemoteTransportCapability {
  isAvailable(): boolean;
}

export interface McpStatus {
  access: {
    mode: McpAccessMode;
  };
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

export interface McpAccessSettingsProvider {
  getAdministratorAccessMode(actor: AuthenticatedActor): McpAccessMode;
  setAdministratorAccessMode(
    actor: AuthenticatedActor,
    accessMode: McpAccessMode,
  ): void;
}

const defaultReadOnlyAccessSettings: McpAccessSettingsProvider = {
  getAdministratorAccessMode: () => "read_only",
  setAdministratorAccessMode: () => {
    throw new Error("MCP access settings are unavailable");
  },
};

export class McpStatusForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "McpStatusForbiddenError";
  }
}

export class ApplicationMcpRuntimeStatusProvider implements McpRuntimeStatusProvider {
  public constructor(
    private readonly sessions: McpSessionCountsProvider = {
      sessionCounts: () => ({ active: 0, initializing: 0 }),
    },
    private readonly oauthAuthorization?: McpOAuthAuthorizationProvider,
    private readonly remoteTransport?: McpRemoteTransportCapability,
  ) {}

  public snapshot(workspaceId: string): McpRuntimeSnapshot {
    const sessions = this.sessions.sessionCounts(workspaceId);
    return {
      activeSessions: sessions.active,
      auditEventsAvailable: true,
      availability: "available",
      initializingSessions: sessions.initializing,
      localTransportState: "ready",
      oauthVerificationAvailable: this.oauthAuthorization !== undefined,
      registeredTools: applicationMcpToolNames.length,
      remoteTransportState: this.remoteTransport?.isAvailable()
        ? "ready"
        : "disabled",
      sessionEnforcement: "active",
    };
  }
}

export class McpStatusService {
  public constructor(
    private readonly policy: McpSessionPolicy,
    private readonly provider: McpRuntimeStatusProvider = new ApplicationMcpRuntimeStatusProvider(),
    private readonly auditReader: McpAuditReader = emptyMcpAuditReader,
    private readonly accessSettings: McpAccessSettingsProvider = defaultReadOnlyAccessSettings,
  ) {}

  public getStatus(actor: AuthenticatedActor): McpStatus {
    this.requireAdministrator(actor);

    const runtime = this.provider.snapshot(actor.workspaceId);
    return {
      access: {
        mode: this.accessSettings.getAdministratorAccessMode(actor),
      },
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

  public setAccessMode(
    actor: AuthenticatedActor,
    accessMode: McpAccessMode,
  ): McpStatus {
    this.requireAdministrator(actor);
    this.accessSettings.setAdministratorAccessMode(actor, accessMode);
    return this.getStatus(actor);
  }

  private requireAdministrator(actor: AuthenticatedActor): void {
    if (actor.user.role !== "admin") throw new McpStatusForbiddenError();
  }
}
