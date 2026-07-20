import type { AuthenticatedActor } from "./auth.js";
import type {
  McpClientDirectory,
  McpClientCredentialsService,
} from "./mcp_clients.js";
import type {
  McpBuiltInOAuthService,
  McpOAuthConnection,
} from "./mcp_builtin_oauth.js";
import { applicationMcpToolNames } from "./mcp.js";
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
  clientCredentialsAvailable: boolean;
  oauthVerificationAvailable: boolean;
  registeredTools: number;
  remoteEndpoint: string | null;
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
  authorize(token: string): unknown;
}

export interface McpRemoteTransportCapability {
  isAvailable(): boolean;
  resourceUrl(): string;
}

export interface McpStatus {
  availability: McpRuntimeSnapshot["availability"];
  capabilities: {
    auditEvents: boolean;
    clientCredentials: boolean;
    oauthVerification: boolean;
    registeredTools: number;
  };
  clients: McpClientDirectory & { oauthClients: McpOAuthConnection[] };
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
      endpoint: string | null;
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

export class ApplicationMcpRuntimeStatusProvider implements McpRuntimeStatusProvider {
  public constructor(
    private readonly sessions: McpSessionCountsProvider = {
      sessionCounts: () => ({ active: 0, initializing: 0 }),
    },
    private readonly oauthAuthorization?: McpOAuthAuthorizationProvider,
    private readonly remoteTransport?: McpRemoteTransportCapability,
    private readonly clientCredentialsAvailable = true,
  ) {}

  public snapshot(workspaceId: string): McpRuntimeSnapshot {
    const sessions = this.sessions.sessionCounts(workspaceId);
    return {
      activeSessions: sessions.active,
      auditEventsAvailable: true,
      availability: "available",
      clientCredentialsAvailable: this.clientCredentialsAvailable,
      initializingSessions: sessions.initializing,
      localTransportState: "ready",
      oauthVerificationAvailable: this.oauthAuthorization !== undefined,
      registeredTools: applicationMcpToolNames.length,
      remoteEndpoint: this.remoteTransport?.resourceUrl() ?? null,
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
    private readonly clientCredentials?: Pick<
      McpClientCredentialsService,
      "getDirectory"
    >,
    private readonly oauthConnections?: Pick<
      McpBuiltInOAuthService,
      "listConnections"
    >,
  ) {}

  public getStatus(actor: AuthenticatedActor): McpStatus {
    this.requireAdministrator(actor);

    const runtime = this.provider.snapshot(actor.workspaceId);
    return {
      availability: runtime.availability,
      capabilities: {
        auditEvents: runtime.auditEventsAvailable,
        clientCredentials: runtime.clientCredentialsAvailable,
        oauthVerification: runtime.oauthVerificationAvailable,
        registeredTools: runtime.registeredTools,
      },
      clients: {
        ...(this.clientCredentials?.getDirectory(actor) ?? {
          actors: [],
          clients: [],
        }),
        oauthClients: this.oauthConnections?.listConnections(actor) ?? [],
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
          endpoint: runtime.remoteEndpoint,
          state: runtime.remoteTransportState,
          transport: "streamable_http",
        },
      },
    };
  }

  private requireAdministrator(actor: AuthenticatedActor): void {
    if (actor.user.role !== "admin") throw new McpStatusForbiddenError();
  }
}
