export type ApplicationStatus =
  "prospect" | "applied" | "interview" | "offer" | "closed";

export interface ApplicationRecord {
  appliedOn: string | null;
  companyName: string;
  createdAt: string;
  id: string;
  location: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  roleTitle: string;
  sourceUrl: string | null;
  status: ApplicationStatus;
  updatedAt: string;
}

export interface CreateApplicationInput {
  appliedOn?: string;
  companyName: string;
  location?: string;
  nextAction?: string;
  nextActionDue?: string;
  notes?: string;
  roleTitle: string;
  sourceUrl?: string;
  status: ApplicationStatus;
}

export interface UpdateApplicationInput {
  appliedOn?: string | null;
  companyName?: string;
  location?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  notes?: string | null;
  roleTitle?: string;
  sourceUrl?: string | null;
  status?: ApplicationStatus;
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

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return (
    value === "prospect" ||
    value === "applied" ||
    value === "interview" ||
    value === "offer" ||
    value === "closed"
  );
}

function parseApplication(value: unknown): ApplicationRecord {
  if (
    !isRecord(value) ||
    !isNullableString(value.appliedOn) ||
    typeof value.companyName !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string" ||
    !isNullableString(value.location) ||
    !isNullableString(value.nextAction) ||
    !isNullableIsoDate(value.nextActionDue) ||
    !isNullableString(value.notes) ||
    typeof value.roleTitle !== "string" ||
    !isNullableHttpUrl(value.sourceUrl) ||
    !isApplicationStatus(value.status) ||
    typeof value.updatedAt !== "string"
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    appliedOn: value.appliedOn,
    companyName: value.companyName,
    createdAt: value.createdAt,
    id: value.id,
    location: value.location,
    nextAction: value.nextAction,
    nextActionDue: value.nextActionDue,
    notes: value.notes,
    roleTitle: value.roleTitle,
    sourceUrl: value.sourceUrl,
    status: value.status,
    updatedAt: value.updatedAt,
  };
}

function parseApplicationEvent(value: unknown): ApplicationEvent {
  if (
    !isRecord(value) ||
    typeof value.actorDisplayName !== "string" ||
    typeof value.id !== "string" ||
    typeof value.occurredAt !== "string" ||
    !isApplicationStatus(value.toStatus) ||
    (value.type !== "application_created" && value.type !== "status_changed")
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  const fromStatus = value.fromStatus;
  if (fromStatus !== null && !isApplicationStatus(fromStatus)) {
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
    const response = await fetch("/api/applications", {
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
    const response = await fetch("/api/applications", {
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

  async listApplicationEvents(applicationId) {
    const encodedId = encodeURIComponent(applicationId);
    const response = await fetch(`/api/applications/${encodedId}/events`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await successfulBody(response);
    if (!isRecord(body) || !Array.isArray(body.events)) {
      throw new ApplicationsClientError("invalid_response");
    }
    return body.events.map(parseApplicationEvent);
  },

  async updateApplication(applicationId, input) {
    const encodedId = encodeURIComponent(applicationId);
    const response = await fetch(`/api/applications/${encodedId}`, {
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
