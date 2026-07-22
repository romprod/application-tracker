import { browserApiFetch } from "./browser_api_fetch";

export type ApplicationStatus = string;

export interface ApplicationContact {
  email: string | null;
  name: string;
  phone: string | null;
  role: string | null;
}

export interface ApplicationContactInput {
  email?: string;
  name: string;
  phone?: string;
  role?: string;
}

export interface ApplicationLink {
  label: string;
  url: string;
}

export interface ApplicationRecord {
  appliedOn: string | null;
  companyName: string;
  contacts: ApplicationContact[];
  createdAt: string;
  id: string;
  location: string | null;
  links: ApplicationLink[];
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  roleType: string | null;
  roleTypeId: string | null;
  roleTitle: string;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  status: ApplicationStatus;
  statusId: string;
  statusIsTerminal: boolean;
  updatedAt: string;
}

export interface CreateApplicationInput {
  appliedOn?: string;
  companyName: string;
  contacts?: ApplicationContactInput[];
  location?: string;
  links?: ApplicationLink[];
  nextAction?: string;
  nextActionDue?: string;
  notes?: string;
  roleTypeId?: string;
  roleTitle: string;
  sourceId?: string;
  sourceUrl?: string;
  statusId: string;
}

export interface UpdateApplicationInput {
  appliedOn?: string | null;
  companyName?: string;
  contacts?: ApplicationContactInput[];
  location?: string | null;
  links?: ApplicationLink[];
  nextAction?: string | null;
  nextActionDue?: string | null;
  notes?: string | null;
  roleTypeId?: string | null;
  roleTitle?: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  statusId?: string;
}

export interface ApplicationEvent {
  actorDisplayName: string;
  fromStatus: ApplicationStatus | null;
  id: string;
  occurredAt: string;
  toStatus: ApplicationStatus;
  type: "application_created" | "status_changed";
}

export interface ApplicationsClient {
  createApplication(input: CreateApplicationInput): Promise<ApplicationRecord>;
  deleteApplication(applicationId: string): Promise<void>;
  listApplicationEvents(applicationId: string): Promise<ApplicationEvent[]>;
  listApplications(): Promise<ApplicationRecord[]>;
  updateApplication(
    applicationId: string,
    input: UpdateApplicationInput,
  ): Promise<ApplicationRecord>;
}

export class ApplicationsClientError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "ApplicationsClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isReferenceValueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(
      value,
    )
  );
}

function isReferenceLabel(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 80
  );
}

function isNullableReferenceLabel(value: unknown): value is string | null {
  return value === null || isReferenceLabel(value);
}

function isNullableReferenceValueId(value: unknown): value is string | null {
  return value === null || isReferenceValueId(value);
}

function isNullableIsoDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isNullableHttpUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function parseContact(value: unknown): ApplicationContact {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.length > 160 ||
    !isNullableString(value.role) ||
    (value.role !== null &&
      (value.role.trim().length === 0 || value.role.length > 160)) ||
    !isNullableString(value.email) ||
    (value.email !== null && value.email.length > 254) ||
    !isNullableString(value.phone) ||
    (value.phone !== null &&
      (value.phone.trim().length === 0 || value.phone.length > 50)) ||
    (value.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    email: value.email,
    name: value.name,
    phone: value.phone,
    role: value.role,
  };
}

function parseLink(value: unknown): ApplicationLink {
  if (
    !isRecord(value) ||
    typeof value.label !== "string" ||
    value.label.trim().length === 0 ||
    value.label.length > 80 ||
    !isNullableHttpUrl(value.url) ||
    value.url === null ||
    value.url.length > 2048
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return { label: value.label, url: value.url };
}

function parseApplication(value: unknown): ApplicationRecord {
  if (
    !isRecord(value) ||
    !isNullableString(value.appliedOn) ||
    typeof value.companyName !== "string" ||
    !Array.isArray(value.contacts) ||
    value.contacts.length > 10 ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string" ||
    !isNullableString(value.location) ||
    !Array.isArray(value.links) ||
    value.links.length > 10 ||
    !isNullableString(value.nextAction) ||
    !isNullableIsoDate(value.nextActionDue) ||
    !isNullableString(value.notes) ||
    !isNullableReferenceLabel(value.roleType) ||
    !isNullableReferenceValueId(value.roleTypeId) ||
    (value.roleType === null) !== (value.roleTypeId === null) ||
    typeof value.roleTitle !== "string" ||
    !isNullableReferenceLabel(value.source) ||
    !isNullableReferenceValueId(value.sourceId) ||
    (value.source === null) !== (value.sourceId === null) ||
    !isNullableHttpUrl(value.sourceUrl) ||
    !isReferenceLabel(value.status) ||
    !isReferenceValueId(value.statusId) ||
    typeof value.statusIsTerminal !== "boolean" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    appliedOn: value.appliedOn,
    companyName: value.companyName,
    contacts: value.contacts.map(parseContact),
    createdAt: value.createdAt,
    id: value.id,
    location: value.location,
    links: value.links.map(parseLink),
    nextAction: value.nextAction,
    nextActionDue: value.nextActionDue,
    notes: value.notes,
    roleType: value.roleType,
    roleTypeId: value.roleTypeId,
    roleTitle: value.roleTitle,
    source: value.source,
    sourceId: value.sourceId,
    sourceUrl: value.sourceUrl,
    status: value.status,
    statusId: value.statusId,
    statusIsTerminal: value.statusIsTerminal,
    updatedAt: value.updatedAt,
  };
}

function parseApplicationEvent(value: unknown): ApplicationEvent {
  if (
    !isRecord(value) ||
    typeof value.actorDisplayName !== "string" ||
    typeof value.id !== "string" ||
    typeof value.occurredAt !== "string" ||
    !isReferenceLabel(value.toStatus) ||
    (value.type !== "application_created" && value.type !== "status_changed")
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  const fromStatus = value.fromStatus;
  if (fromStatus !== null && !isReferenceLabel(fromStatus)) {
    throw new ApplicationsClientError("invalid_response");
  }
  if (
    (value.type === "application_created" && fromStatus !== null) ||
    (value.type === "status_changed" &&
      (fromStatus === null || fromStatus === value.toStatus))
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    actorDisplayName: value.actorDisplayName,
    fromStatus,
    id: value.id,
    occurredAt: value.occurredAt,
    toStatus: value.toStatus,
    type: value.type,
  };
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApplicationsClientError("invalid_response");
  }
}

function errorCode(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }
  return "request_failed";
}

async function successfulBody(response: Response): Promise<unknown> {
  const body = await readResponse(response);
  if (!response.ok) throw new ApplicationsClientError(errorCode(body));
  return body;
}

export const browserApplicationsClient: ApplicationsClient = {
  async listApplications() {
    const response = await browserApiFetch("/api/applications", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await successfulBody(response);
    if (!isRecord(body) || !Array.isArray(body.applications)) {
      throw new ApplicationsClientError("invalid_response");
    }
    return body.applications.map(parseApplication);
  },

  async createApplication(input) {
    const response = await browserApiFetch("/api/applications", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = await successfulBody(response);
    if (!isRecord(body)) throw new ApplicationsClientError("invalid_response");
    return parseApplication(body.application);
  },

  async deleteApplication(applicationId) {
    const encodedId = encodeURIComponent(applicationId);
    const response = await browserApiFetch(`/api/applications/${encodedId}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "DELETE",
    });
    if (response.ok) return;
    const body = await readResponse(response);
    throw new ApplicationsClientError(errorCode(body));
  },

  async listApplicationEvents(applicationId) {
    const encodedId = encodeURIComponent(applicationId);
    const response = await browserApiFetch(
      `/api/applications/${encodedId}/events`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
    const body = await successfulBody(response);
    if (!isRecord(body) || !Array.isArray(body.events)) {
      throw new ApplicationsClientError("invalid_response");
    }
    return body.events.map(parseApplicationEvent);
  },

  async updateApplication(applicationId, input) {
    const encodedId = encodeURIComponent(applicationId);
    const response = await browserApiFetch(`/api/applications/${encodedId}`, {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const body = await successfulBody(response);
    if (!isRecord(body)) throw new ApplicationsClientError("invalid_response");
    return parseApplication(body.application);
  },
};
