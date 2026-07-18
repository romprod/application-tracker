export interface McpStatus {
  availability: "available" | "degraded" | "planned";
  capabilities: {
    auditEvents: boolean;
    oauthVerification: boolean;
    registeredTools: number;
  };
  sessions: {
    absoluteLifetimeSeconds: number;
    active: number;
    enforcement: "active" | "inactive";
    globalLimit: number;
    idleTimeoutSeconds: number;
    initializing: number;
    perActorLimit: number;
  };
  transports: {
    local: {
      state: "ready" | "unavailable";
      transport: "stdio";
    };
    remote: {
      state: "disabled" | "ready" | "unavailable";
      transport: "streamable_http";
    };
  };
}

export interface McpStatusClient {
  getStatus(): Promise<McpStatus>;
}

export class McpStatusClientError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "McpStatusClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseStatus(value: unknown): McpStatus {
  if (
    !isRecord(value) ||
    (value.availability !== "available" &&
      value.availability !== "degraded" &&
      value.availability !== "planned") ||
    !isRecord(value.capabilities) ||
    typeof value.capabilities.auditEvents !== "boolean" ||
    typeof value.capabilities.oauthVerification !== "boolean" ||
    !isNonNegativeInteger(value.capabilities.registeredTools) ||
    !isRecord(value.sessions) ||
    !isNonNegativeInteger(value.sessions.absoluteLifetimeSeconds) ||
    !isNonNegativeInteger(value.sessions.active) ||
    (value.sessions.enforcement !== "active" &&
      value.sessions.enforcement !== "inactive") ||
    !isNonNegativeInteger(value.sessions.globalLimit) ||
    !isNonNegativeInteger(value.sessions.idleTimeoutSeconds) ||
    !isNonNegativeInteger(value.sessions.initializing) ||
    !isNonNegativeInteger(value.sessions.perActorLimit) ||
    !isRecord(value.transports) ||
    !isRecord(value.transports.local) ||
    (value.transports.local.state !== "ready" &&
      value.transports.local.state !== "unavailable") ||
    value.transports.local.transport !== "stdio" ||
    !isRecord(value.transports.remote) ||
    (value.transports.remote.state !== "disabled" &&
      value.transports.remote.state !== "ready" &&
      value.transports.remote.state !== "unavailable") ||
    value.transports.remote.transport !== "streamable_http"
  ) {
    throw new McpStatusClientError("invalid_response");
  }

  return {
    availability: value.availability,
    capabilities: {
      auditEvents: value.capabilities.auditEvents,
      oauthVerification: value.capabilities.oauthVerification,
      registeredTools: value.capabilities.registeredTools,
    },
    sessions: {
      absoluteLifetimeSeconds: value.sessions.absoluteLifetimeSeconds,
      active: value.sessions.active,
      enforcement: value.sessions.enforcement,
      globalLimit: value.sessions.globalLimit,
      idleTimeoutSeconds: value.sessions.idleTimeoutSeconds,
      initializing: value.sessions.initializing,
      perActorLimit: value.sessions.perActorLimit,
    },
    transports: {
      local: {
        state: value.transports.local.state,
        transport: value.transports.local.transport,
      },
      remote: {
        state: value.transports.remote.state,
        transport: value.transports.remote.transport,
      },
    },
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new McpStatusClientError("invalid_response");
  }
}

export const browserMcpStatusClient: McpStatusClient = {
  async getStatus() {
    const response = await fetch("/api/settings/mcp", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await responseBody(response);
    if (!response.ok) throw new McpStatusClientError("request_failed");
    if (!isRecord(body)) throw new McpStatusClientError("invalid_response");
    return parseStatus(body.status);
  },
};
