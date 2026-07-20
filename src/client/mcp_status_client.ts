export interface McpStatus {
  access: {
    mode: "read_only" | "read_write";
  };
  availability: "available" | "degraded" | "planned";
  capabilities: {
    auditEvents: boolean;
    clientCredentials: boolean;
    oauthVerification: boolean;
    registeredTools: number;
  };
  clients: McpClientDirectory;
  recentAuditEvents: McpAuditEvent[];
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

export interface McpClientActor {
  displayName: string;
  id: string;
  username: string;
}

export interface McpClientRecord {
  actor: McpClientActor;
  clientId: string;
  createdAt: string;
  lastUsedAt: string | null;
  name: string;
  rotatedAt: string | null;
  state: "active" | "revoked" | "unavailable";
}

export interface McpClientDirectory {
  actors: McpClientActor[];
  clients: McpClientRecord[];
}

export interface IssuedMcpClientCredential {
  bearerToken: string;
  client: McpClientRecord;
}

export interface McpCredentialResult {
  credential: IssuedMcpClientCredential;
  status: McpStatus;
}

export interface McpAuditEvent {
  action:
    | "append_document_chunk"
    | "begin_document_import"
    | "cancel_document_import"
    | "complete_document_import"
    | "create_application"
    | "delete_application"
    | "export_document_chunk"
    | "get_application"
    | "get_document_import_capabilities"
    | "get_job_search_summary"
    | "get_reference_data"
    | "get_tracker_context"
    | "list_applications"
    | "list_documents"
    | "update_application";
  actor: {
    displayName: string;
    username: string;
  };
  occurredAt: string;
  result: "denied" | "error" | "not_found" | "success";
  targetType:
    | "application"
    | "application_collection"
    | "document"
    | "document_collection"
    | "document_transfer"
    | "job_search"
    | "reference_data"
    | "workspace";
  transport: "local_stdio" | "remote_http";
}

export interface McpStatusClient {
  createClient(input: {
    actorUserId: string;
    name: string;
  }): Promise<McpCredentialResult>;
  getStatus(): Promise<McpStatus>;
  revokeClient(clientId: string): Promise<McpStatus>;
  rotateClient(clientId: string): Promise<McpCredentialResult>;
  setAccessMode(accessMode: "read_only" | "read_write"): Promise<McpStatus>;
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

function parseAuditEvent(value: unknown): McpAuditEvent {
  if (
    !isRecord(value) ||
    (value.action !== "append_document_chunk" &&
      value.action !== "begin_document_import" &&
      value.action !== "cancel_document_import" &&
      value.action !== "complete_document_import" &&
      value.action !== "create_application" &&
      value.action !== "delete_application" &&
      value.action !== "export_document_chunk" &&
      value.action !== "get_application" &&
      value.action !== "get_document_import_capabilities" &&
      value.action !== "get_job_search_summary" &&
      value.action !== "get_reference_data" &&
      value.action !== "get_tracker_context" &&
      value.action !== "list_applications" &&
      value.action !== "list_documents" &&
      value.action !== "update_application") ||
    !isRecord(value.actor) ||
    typeof value.actor.displayName !== "string" ||
    typeof value.actor.username !== "string" ||
    typeof value.occurredAt !== "string" ||
    Number.isNaN(Date.parse(value.occurredAt)) ||
    (value.result !== "denied" &&
      value.result !== "error" &&
      value.result !== "not_found" &&
      value.result !== "success") ||
    (value.targetType !== "application" &&
      value.targetType !== "application_collection" &&
      value.targetType !== "document" &&
      value.targetType !== "document_collection" &&
      value.targetType !== "document_transfer" &&
      value.targetType !== "job_search" &&
      value.targetType !== "reference_data" &&
      value.targetType !== "workspace") ||
    (value.transport !== "local_stdio" && value.transport !== "remote_http")
  ) {
    throw new McpStatusClientError("invalid_response");
  }
  return {
    action: value.action,
    actor: {
      displayName: value.actor.displayName,
      username: value.actor.username,
    },
    occurredAt: value.occurredAt,
    result: value.result,
    targetType: value.targetType,
    transport: value.transport,
  };
}

function parseClientActor(value: unknown): McpClientActor {
  if (
    !isRecord(value) ||
    typeof value.displayName !== "string" ||
    typeof value.id !== "string" ||
    typeof value.username !== "string"
  ) {
    throw new McpStatusClientError("invalid_response");
  }
  return {
    displayName: value.displayName,
    id: value.id,
    username: value.username,
  };
}

function parseClient(value: unknown): McpClientRecord {
  if (
    !isRecord(value) ||
    !isRecord(value.actor) ||
    typeof value.clientId !== "string" ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    (value.lastUsedAt !== null &&
      (typeof value.lastUsedAt !== "string" ||
        Number.isNaN(Date.parse(value.lastUsedAt)))) ||
    typeof value.name !== "string" ||
    (value.rotatedAt !== null &&
      (typeof value.rotatedAt !== "string" ||
        Number.isNaN(Date.parse(value.rotatedAt)))) ||
    (value.state !== "active" &&
      value.state !== "revoked" &&
      value.state !== "unavailable")
  ) {
    throw new McpStatusClientError("invalid_response");
  }
  return {
    actor: parseClientActor(value.actor),
    clientId: value.clientId,
    createdAt: value.createdAt,
    lastUsedAt: value.lastUsedAt,
    name: value.name,
    rotatedAt: value.rotatedAt,
    state: value.state,
  };
}

function parseStatus(value: unknown): McpStatus {
  if (
    !isRecord(value) ||
    !isRecord(value.access) ||
    (value.access.mode !== "read_only" && value.access.mode !== "read_write") ||
    (value.availability !== "available" &&
      value.availability !== "degraded" &&
      value.availability !== "planned") ||
    !isRecord(value.capabilities) ||
    typeof value.capabilities.auditEvents !== "boolean" ||
    typeof value.capabilities.clientCredentials !== "boolean" ||
    typeof value.capabilities.oauthVerification !== "boolean" ||
    !isNonNegativeInteger(value.capabilities.registeredTools) ||
    !Array.isArray(value.recentAuditEvents) ||
    value.recentAuditEvents.length > 20 ||
    !isRecord(value.clients) ||
    !Array.isArray(value.clients.actors) ||
    !Array.isArray(value.clients.clients) ||
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
    access: { mode: value.access.mode },
    availability: value.availability,
    capabilities: {
      auditEvents: value.capabilities.auditEvents,
      clientCredentials: value.capabilities.clientCredentials,
      oauthVerification: value.capabilities.oauthVerification,
      registeredTools: value.capabilities.registeredTools,
    },
    clients: {
      actors: value.clients.actors.map(parseClientActor),
      clients: value.clients.clients.map(parseClient),
    },
    recentAuditEvents: value.recentAuditEvents.map(parseAuditEvent),
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
  async createClient(input) {
    const response = await fetch("/api/settings/mcp/clients", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = await responseBody(response);
    if (!response.ok) throw new McpStatusClientError("request_failed");
    return parseCredentialResult(body);
  },
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
  async setAccessMode(accessMode) {
    const response = await fetch("/api/settings/mcp", {
      body: JSON.stringify({ accessMode }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const body = await responseBody(response);
    if (!response.ok) throw new McpStatusClientError("request_failed");
    if (!isRecord(body)) throw new McpStatusClientError("invalid_response");
    return parseStatus(body.status);
  },
  async rotateClient(clientId) {
    const response = await fetch(
      `/api/settings/mcp/clients/${encodeURIComponent(clientId)}/rotate`,
      {
        body: "{}",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    const body = await responseBody(response);
    if (!response.ok) throw new McpStatusClientError("request_failed");
    return parseCredentialResult(body);
  },
  async revokeClient(clientId) {
    const response = await fetch(
      `/api/settings/mcp/clients/${encodeURIComponent(clientId)}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
    const body = await responseBody(response);
    if (!response.ok) throw new McpStatusClientError("request_failed");
    if (!isRecord(body)) throw new McpStatusClientError("invalid_response");
    return parseStatus(body.status);
  },
};

function parseCredentialResult(value: unknown): McpCredentialResult {
  if (
    !isRecord(value) ||
    !isRecord(value.credential) ||
    typeof value.credential.bearerToken !== "string"
  ) {
    throw new McpStatusClientError("invalid_response");
  }
  return {
    credential: {
      bearerToken: value.credential.bearerToken,
      client: parseClient(value.credential.client),
    },
    status: parseStatus(value.status),
  };
}
