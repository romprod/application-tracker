import { browserApiFetch } from "./browser_api_fetch";

export interface OutlookGraphConnection {
  assignedApplicationCount: number;
  clientId: string;
  createdAt: string;
  enabled: boolean;
  folderPath: string;
  id: string;
  lastErrorCode: string | null;
  lastTestedAt: string;
  mailbox: string;
  name: string;
  secretConfigured: true;
  tenantId: string;
  updatedAt: string;
  verifiedAt: string;
}

export interface OutlookGraphConnectionOption {
  enabled: boolean;
  id: string;
  mailbox: string;
  name: string;
}

export interface OutlookGraphConnectionStatus {
  connections: OutlookGraphConnection[];
  secureStorageConfigured: boolean;
}

export interface CreateOutlookGraphConnectionInput {
  clientId: string;
  clientSecret: string;
  folderPath: string;
  mailbox: string;
  name: string;
  tenantId: string;
}

export interface UpdateOutlookGraphConnectionInput {
  clientId: string;
  clientSecret?: string;
  folderPath: string;
  mailbox: string;
  name: string;
  tenantId: string;
}

export interface OutlookConnectionsClient {
  create(
    input: CreateOutlookGraphConnectionInput,
  ): Promise<OutlookGraphConnectionStatus>;
  deleteConnection(
    connectionId: string,
    expectedAssignedApplicationCount: number,
  ): Promise<OutlookGraphConnectionStatus>;
  getStatus(): Promise<OutlookGraphConnectionStatus>;
  listOptions(): Promise<OutlookGraphConnectionOption[]>;
  setEnabled(
    connectionId: string,
    enabled: boolean,
  ): Promise<OutlookGraphConnectionStatus>;
  update(
    connectionId: string,
    input: UpdateOutlookGraphConnectionInput,
  ): Promise<OutlookGraphConnectionStatus>;
  verify(connectionId: string): Promise<OutlookGraphConnectionStatus>;
}

export class OutlookConnectionsClientError extends Error {
  public constructor(
    public readonly code: string,
    public readonly assignedApplicationCount?: number,
  ) {
    super(code);
    this.name = "OutlookConnectionsClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseConnection(value: unknown): OutlookGraphConnection {
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.assignedApplicationCount) ||
    typeof value.clientId !== "string" ||
    !validTimestamp(value.createdAt) ||
    typeof value.enabled !== "boolean" ||
    typeof value.folderPath !== "string" ||
    typeof value.id !== "string" ||
    (value.lastErrorCode !== null && typeof value.lastErrorCode !== "string") ||
    !validTimestamp(value.lastTestedAt) ||
    typeof value.mailbox !== "string" ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.secretConfigured !== true ||
    typeof value.tenantId !== "string" ||
    !validTimestamp(value.updatedAt) ||
    !validTimestamp(value.verifiedAt)
  ) {
    throw new OutlookConnectionsClientError("invalid_response");
  }
  return {
    assignedApplicationCount: value.assignedApplicationCount,
    clientId: value.clientId,
    createdAt: value.createdAt,
    enabled: value.enabled,
    folderPath: value.folderPath,
    id: value.id,
    lastErrorCode: value.lastErrorCode,
    lastTestedAt: value.lastTestedAt,
    mailbox: value.mailbox,
    name: value.name,
    secretConfigured: true,
    tenantId: value.tenantId,
    updatedAt: value.updatedAt,
    verifiedAt: value.verifiedAt,
  };
}

function parseStatusResponse(value: unknown): OutlookGraphConnectionStatus {
  if (!isRecord(value) || !isRecord(value.status)) {
    throw new OutlookConnectionsClientError("invalid_response");
  }
  const status = value.status;
  if (
    typeof status.secureStorageConfigured !== "boolean" ||
    !Array.isArray(status.connections)
  ) {
    throw new OutlookConnectionsClientError("invalid_response");
  }
  return {
    connections: status.connections.map(parseConnection),
    secureStorageConfigured: status.secureStorageConfigured,
  };
}

function parseOption(value: unknown): OutlookGraphConnectionOption {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.id !== "string" ||
    typeof value.mailbox !== "string" ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0
  ) {
    throw new OutlookConnectionsClientError("invalid_response");
  }
  return {
    enabled: value.enabled,
    id: value.id,
    mailbox: value.mailbox,
    name: value.name,
  };
}

function parseOptionsResponse(value: unknown): OutlookGraphConnectionOption[] {
  if (!isRecord(value) || !Array.isArray(value.connections)) {
    throw new OutlookConnectionsClientError("invalid_response");
  }
  return value.connections.map(parseOption);
}

function errorDetails(value: unknown): {
  assignedApplicationCount?: number;
  code: string;
} {
  const code =
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
      ? value.error.code
      : "request_failed";
  const assignedApplicationCount =
    isRecord(value) && nonNegativeInteger(value.assignedApplicationCount)
      ? value.assignedApplicationCount
      : undefined;
  return {
    code,
    ...(assignedApplicationCount === undefined
      ? {}
      : { assignedApplicationCount }),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new OutlookConnectionsClientError("invalid_response");
  }
}

async function readStatus(
  response: Response,
): Promise<OutlookGraphConnectionStatus> {
  const body = await readJson(response);
  if (!response.ok) {
    const details = errorDetails(body);
    throw new OutlookConnectionsClientError(
      details.code,
      details.assignedApplicationCount,
    );
  }
  return parseStatusResponse(body);
}

async function readOptions(
  response: Response,
): Promise<OutlookGraphConnectionOption[]> {
  const body = await readJson(response);
  if (!response.ok) {
    const details = errorDetails(body);
    throw new OutlookConnectionsClientError(details.code);
  }
  return parseOptionsResponse(body);
}

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

function connectionPath(connectionId: string): string {
  return `/api/settings/outlook/${encodeURIComponent(connectionId)}`;
}

export const browserOutlookConnectionsClient: OutlookConnectionsClient = {
  async getStatus() {
    return readStatus(
      await browserApiFetch("/api/settings/outlook", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    );
  },

  async listOptions() {
    return readOptions(
      await browserApiFetch("/api/settings/outlook/options", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    );
  },

  async create(input) {
    return readStatus(
      await browserApiFetch("/api/settings/outlook", {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: jsonHeaders,
        method: "POST",
      }),
    );
  },

  async update(connectionId, input) {
    return readStatus(
      await browserApiFetch(connectionPath(connectionId), {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: jsonHeaders,
        method: "PUT",
      }),
    );
  },

  async verify(connectionId) {
    return readStatus(
      await browserApiFetch(`${connectionPath(connectionId)}/verify`, {
        body: "{}",
        credentials: "same-origin",
        headers: jsonHeaders,
        method: "POST",
      }),
    );
  },

  async setEnabled(connectionId, enabled) {
    return readStatus(
      await browserApiFetch(`${connectionPath(connectionId)}/state`, {
        body: JSON.stringify({ enabled }),
        credentials: "same-origin",
        headers: jsonHeaders,
        method: "PATCH",
      }),
    );
  },

  async deleteConnection(connectionId, expectedAssignedApplicationCount) {
    return readStatus(
      await browserApiFetch(connectionPath(connectionId), {
        body: JSON.stringify({
          confirm: true,
          expectedAssignedApplicationCount,
        }),
        credentials: "same-origin",
        headers: jsonHeaders,
        method: "DELETE",
      }),
    );
  },
};
