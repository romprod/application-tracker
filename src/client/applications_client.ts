import { browserApiFetch } from "./browser_api_fetch";

export type ApplicationStatus = string;
export type WorkArrangement = "hybrid" | "remote" | "office";

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
  agency: string | null;
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
  rating: number | null;
  roleType: string | null;
  roleTypeId: string | null;
  roleTitle: string;
  salary: string | null;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  status: ApplicationStatus;
  statusId: string;
  statusIsTerminal: boolean;
  updatedAt: string;
  workArrangement: WorkArrangement | null;
}

export interface CreateApplicationInput {
  agency?: string;
  appliedOn?: string;
  companyName: string;
  contacts?: ApplicationContactInput[];
  location?: string;
  links?: ApplicationLink[];
  nextAction?: string;
  nextActionDue?: string;
  notes?: string;
  rating?: number;
  roleTypeId?: string;
  roleTitle: string;
  salary?: string;
  sourceId?: string;
  sourceUrl?: string;
  statusId: string;
  workArrangement?: WorkArrangement;
}

export interface UpdateApplicationInput {
  agency?: string | null;
  appliedOn?: string | null;
  companyName?: string;
  contacts?: ApplicationContactInput[];
  expectedUpdatedAt: string;
  location?: string | null;
  links?: ApplicationLink[];
  nextAction?: string | null;
  nextActionDue?: string | null;
  notes?: string | null;
  rating?: number | null;
  roleTypeId?: string | null;
  roleTitle?: string;
  salary?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  statusId?: string;
  workArrangement?: WorkArrangement | null;
}

export interface ApplicationEvent {
  actorDisplayName: string;
  fromStatus: ApplicationStatus | null;
  id: string;
  occurredAt: string;
  processedAt: string;
  sourceEmailMessageId: string | null;
  statusOverrideReason: string | null;
  toStatus: ApplicationStatus;
  type: "application_created" | "status_changed";
}

export type ApplicationMergeField =
  | "agency"
  | "appliedOn"
  | "companyName"
  | "location"
  | "nextAction"
  | "nextActionDue"
  | "notes"
  | "rating"
  | "roleTypeId"
  | "roleTitle"
  | "salary"
  | "sourceId"
  | "sourceUrl"
  | "statusId"
  | "workArrangement";

export interface ApplicationDuplicateReason {
  detail: string;
  kind:
    | "agency"
    | "applied_date"
    | "canonical_url"
    | "company_title"
    | "contact"
    | "email_message_id"
    | "location"
    | "posting_id";
}

export interface ApplicationDuplicateCandidate {
  applications: [ApplicationRecord, ApplicationRecord];
  confidence: "definite" | "possible" | "probable";
  reasons: ApplicationDuplicateReason[];
}

export interface ApplicationDuplicateAudit {
  candidates: ApplicationDuplicateCandidate[];
  nextOffset: number | null;
  offset: number;
  returned: number;
  total: number;
}

export interface ApplicationMergeResolutions {
  contacts?: ApplicationContactInput[];
  fields?: Partial<Record<ApplicationMergeField, "source" | "target">>;
  links?: ApplicationLink[];
}

export interface ApplicationMergeFieldConflict {
  field: ApplicationMergeField;
  resolution: "source" | "target" | null;
  resolvedValue: number | string | null;
  sourceValue: number | string | null;
  targetValue: number | string | null;
}

export interface ApplicationMergeRelationshipPreview<Record> {
  additions: Record[];
  conflicts: {
    key: string;
    source: Record;
    target: Record;
  }[];
  requiresResolution: boolean;
  result: Record[];
  source: Record[];
  target: Record[];
}

export interface ApplicationMergePreview {
  contacts: ApplicationMergeRelationshipPreview<ApplicationContact>;
  documents: ApplicationMergeRelationshipPreview<Record<string, unknown>>;
  emailEvidence: ApplicationMergeRelationshipPreview<Record<string, unknown>>;
  fieldConflicts: ApplicationMergeFieldConflict[];
  history: {
    sourceEvents: ApplicationEvent[];
    targetEvents: ApplicationEvent[];
  };
  informationNotRetained: string[];
  jobPostings: ApplicationMergeRelationshipPreview<Record<string, unknown>>;
  links: ApplicationMergeRelationshipPreview<ApplicationLink>;
  safeToApply: boolean;
  source: ApplicationRecord;
  survivor: ApplicationRecord;
  target: ApplicationRecord;
  unresolvedConflicts: string[];
}

export interface ApplicationMergeResult {
  alreadyApplied: boolean;
  applied: boolean;
  lineage: {
    actorDisplayName: string;
    id: string;
    mergedAt: string;
    sourceApplicationId: string;
    sourceUpdatedAt: string;
    targetApplicationId: string;
    targetUpdatedAt: string;
  } | null;
  preview: ApplicationMergePreview;
}

export type MergeApplicationsInput =
  | {
      mode: "preview";
      resolutions?: ApplicationMergeResolutions;
      sourceApplicationId: string;
      targetApplicationId: string;
    }
  | {
      confirm: true;
      expectedSourceUpdatedAt: string;
      expectedTargetUpdatedAt: string;
      mode: "apply";
      resolutions: ApplicationMergeResolutions;
      sourceApplicationId: string;
      targetApplicationId: string;
    };

export interface ApplicationsClient {
  auditDuplicateApplications(input: {
    limit: number;
    offset: number;
  }): Promise<ApplicationDuplicateAudit>;
  createApplication(input: CreateApplicationInput): Promise<ApplicationRecord>;
  deleteApplication(applicationId: string): Promise<void>;
  listApplicationEvents(applicationId: string): Promise<ApplicationEvent[]>;
  listApplications(): Promise<ApplicationRecord[]>;
  mergeApplications(
    input: MergeApplicationsInput,
  ): Promise<ApplicationMergeResult>;
  updateApplication(
    applicationId: string,
    input: UpdateApplicationInput,
  ): Promise<ApplicationRecord>;
}

export class ApplicationsClientError extends Error {
  public constructor(
    public readonly code: string,
    public readonly application?: ApplicationRecord,
    public readonly mergePreview?: ApplicationMergePreview,
  ) {
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

function isNullableBoundedText(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= maximumLength)
  );
}

function isNullableWorkArrangement(
  value: unknown,
): value is WorkArrangement | null {
  return (
    value === null ||
    value === "hybrid" ||
    value === "remote" ||
    value === "office"
  );
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
    !isNullableBoundedText(value.agency, 160) ||
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
    (value.rating !== null &&
      (typeof value.rating !== "number" ||
        !Number.isInteger(value.rating) ||
        value.rating < 1 ||
        value.rating > 5)) ||
    !isNullableReferenceLabel(value.roleType) ||
    !isNullableReferenceValueId(value.roleTypeId) ||
    (value.roleType === null) !== (value.roleTypeId === null) ||
    typeof value.roleTitle !== "string" ||
    !isNullableBoundedText(value.salary, 160) ||
    !isNullableReferenceLabel(value.source) ||
    !isNullableReferenceValueId(value.sourceId) ||
    (value.source === null) !== (value.sourceId === null) ||
    !isNullableHttpUrl(value.sourceUrl) ||
    !isReferenceLabel(value.status) ||
    !isReferenceValueId(value.statusId) ||
    typeof value.statusIsTerminal !== "boolean" ||
    typeof value.updatedAt !== "string" ||
    !isNullableWorkArrangement(value.workArrangement)
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    agency: value.agency,
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
    rating: value.rating,
    roleType: value.roleType,
    roleTypeId: value.roleTypeId,
    roleTitle: value.roleTitle,
    salary: value.salary,
    source: value.source,
    sourceId: value.sourceId,
    sourceUrl: value.sourceUrl,
    status: value.status,
    statusId: value.statusId,
    statusIsTerminal: value.statusIsTerminal,
    updatedAt: value.updatedAt,
    workArrangement: value.workArrangement,
  };
}

function parseApplicationEvent(value: unknown): ApplicationEvent {
  if (
    !isRecord(value) ||
    typeof value.actorDisplayName !== "string" ||
    typeof value.id !== "string" ||
    typeof value.occurredAt !== "string" ||
    typeof value.processedAt !== "string" ||
    (value.sourceEmailMessageId !== null &&
      typeof value.sourceEmailMessageId !== "string") ||
    (value.statusOverrideReason !== null &&
      typeof value.statusOverrideReason !== "string") ||
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
    processedAt: value.processedAt,
    sourceEmailMessageId: value.sourceEmailMessageId,
    statusOverrideReason: value.statusOverrideReason,
    toStatus: value.toStatus,
    type: value.type,
  };
}

const applicationMergeFields = new Set<ApplicationMergeField>([
  "agency",
  "appliedOn",
  "companyName",
  "location",
  "nextAction",
  "nextActionDue",
  "notes",
  "rating",
  "roleTypeId",
  "roleTitle",
  "salary",
  "sourceId",
  "sourceUrl",
  "statusId",
  "workArrangement",
]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseDuplicateReason(value: unknown): ApplicationDuplicateReason {
  const kinds = new Set<ApplicationDuplicateReason["kind"]>([
    "agency",
    "applied_date",
    "canonical_url",
    "company_title",
    "contact",
    "email_message_id",
    "location",
    "posting_id",
  ]);
  if (
    !isRecord(value) ||
    typeof value.detail !== "string" ||
    typeof value.kind !== "string" ||
    !kinds.has(value.kind as ApplicationDuplicateReason["kind"])
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    detail: value.detail,
    kind: value.kind as ApplicationDuplicateReason["kind"],
  };
}

function parseDuplicateAudit(value: unknown): ApplicationDuplicateAudit {
  if (
    !isRecord(value) ||
    !Array.isArray(value.candidates) ||
    !isNonNegativeInteger(value.offset) ||
    !isNonNegativeInteger(value.returned) ||
    !isNonNegativeInteger(value.total) ||
    (value.nextOffset !== null && !isNonNegativeInteger(value.nextOffset))
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  const candidates = value.candidates.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !Array.isArray(candidate.applications) ||
      candidate.applications.length !== 2 ||
      (candidate.confidence !== "definite" &&
        candidate.confidence !== "possible" &&
        candidate.confidence !== "probable") ||
      !Array.isArray(candidate.reasons) ||
      candidate.reasons.length === 0
    ) {
      throw new ApplicationsClientError("invalid_response");
    }
    return {
      applications: [
        parseApplication(candidate.applications[0]),
        parseApplication(candidate.applications[1]),
      ],
      confidence: candidate.confidence,
      reasons: candidate.reasons.map(parseDuplicateReason),
    } satisfies ApplicationDuplicateCandidate;
  });
  if (value.returned !== candidates.length || value.total < candidates.length) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    candidates,
    nextOffset: value.nextOffset,
    offset: value.offset,
    returned: value.returned,
    total: value.total,
  };
}

function parseMergeFieldConflict(
  value: unknown,
): ApplicationMergeFieldConflict {
  if (
    !isRecord(value) ||
    typeof value.field !== "string" ||
    !applicationMergeFields.has(value.field as ApplicationMergeField) ||
    (value.resolution !== null &&
      value.resolution !== "source" &&
      value.resolution !== "target")
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  for (const field of [
    "resolvedValue",
    "sourceValue",
    "targetValue",
  ] as const) {
    const fieldValue = value[field];
    if (
      fieldValue !== null &&
      typeof fieldValue !== "string" &&
      typeof fieldValue !== "number"
    ) {
      throw new ApplicationsClientError("invalid_response");
    }
  }
  return {
    field: value.field as ApplicationMergeField,
    resolution: value.resolution,
    resolvedValue: value.resolvedValue as number | string | null,
    sourceValue: value.sourceValue as number | string | null,
    targetValue: value.targetValue as number | string | null,
  };
}

function parseUnknownRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ApplicationsClientError("invalid_response");
  return value;
}

function parseMergeRelationship<RecordValue>(
  value: unknown,
  parse: (record: unknown) => RecordValue,
): ApplicationMergeRelationshipPreview<RecordValue> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.additions) ||
    !Array.isArray(value.conflicts) ||
    typeof value.requiresResolution !== "boolean" ||
    !Array.isArray(value.result) ||
    !Array.isArray(value.source) ||
    !Array.isArray(value.target)
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    additions: value.additions.map(parse),
    conflicts: value.conflicts.map((conflict) => {
      if (
        !isRecord(conflict) ||
        typeof conflict.key !== "string" ||
        conflict.source === undefined ||
        conflict.target === undefined
      ) {
        throw new ApplicationsClientError("invalid_response");
      }
      return {
        key: conflict.key,
        source: parse(conflict.source),
        target: parse(conflict.target),
      };
    }),
    requiresResolution: value.requiresResolution,
    result: value.result.map(parse),
    source: value.source.map(parse),
    target: value.target.map(parse),
  };
}

function parseMergePreview(value: unknown): ApplicationMergePreview {
  if (
    !isRecord(value) ||
    !Array.isArray(value.fieldConflicts) ||
    !isRecord(value.history) ||
    !Array.isArray(value.history.sourceEvents) ||
    !Array.isArray(value.history.targetEvents) ||
    !Array.isArray(value.informationNotRetained) ||
    !value.informationNotRetained.every(
      (detail) => typeof detail === "string",
    ) ||
    typeof value.safeToApply !== "boolean" ||
    !Array.isArray(value.unresolvedConflicts) ||
    !value.unresolvedConflicts.every((conflict) => typeof conflict === "string")
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  return {
    contacts: parseMergeRelationship(value.contacts, parseContact),
    documents: parseMergeRelationship(value.documents, parseUnknownRecord),
    emailEvidence: parseMergeRelationship(
      value.emailEvidence,
      parseUnknownRecord,
    ),
    fieldConflicts: value.fieldConflicts.map(parseMergeFieldConflict),
    history: {
      sourceEvents: value.history.sourceEvents.map(parseApplicationEvent),
      targetEvents: value.history.targetEvents.map(parseApplicationEvent),
    },
    informationNotRetained: value.informationNotRetained,
    jobPostings: parseMergeRelationship(value.jobPostings, parseUnknownRecord),
    links: parseMergeRelationship(value.links, parseLink),
    safeToApply: value.safeToApply,
    source: parseApplication(value.source),
    survivor: parseApplication(value.survivor),
    target: parseApplication(value.target),
    unresolvedConflicts: value.unresolvedConflicts,
  };
}

function parseMergeResult(value: unknown): ApplicationMergeResult {
  if (
    !isRecord(value) ||
    typeof value.alreadyApplied !== "boolean" ||
    typeof value.applied !== "boolean" ||
    (value.lineage !== null && !isRecord(value.lineage))
  ) {
    throw new ApplicationsClientError("invalid_response");
  }
  let lineage: ApplicationMergeResult["lineage"] = null;
  if (value.lineage !== null) {
    const candidate = value.lineage;
    if (
      typeof candidate.actorDisplayName !== "string" ||
      typeof candidate.id !== "string" ||
      typeof candidate.mergedAt !== "string" ||
      typeof candidate.sourceApplicationId !== "string" ||
      typeof candidate.sourceUpdatedAt !== "string" ||
      typeof candidate.targetApplicationId !== "string" ||
      typeof candidate.targetUpdatedAt !== "string"
    ) {
      throw new ApplicationsClientError("invalid_response");
    }
    lineage = {
      actorDisplayName: candidate.actorDisplayName,
      id: candidate.id,
      mergedAt: candidate.mergedAt,
      sourceApplicationId: candidate.sourceApplicationId,
      sourceUpdatedAt: candidate.sourceUpdatedAt,
      targetApplicationId: candidate.targetApplicationId,
      targetUpdatedAt: candidate.targetUpdatedAt,
    };
  }
  return {
    alreadyApplied: value.alreadyApplied,
    applied: value.applied,
    lineage,
    preview: parseMergePreview(value.preview),
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
  async auditDuplicateApplications(input) {
    const query = new URLSearchParams({
      limit: String(input.limit),
      offset: String(input.offset),
    });
    const response = await browserApiFetch(
      `/api/applications/duplicates?${query.toString()}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
    const body = await successfulBody(response);
    if (!isRecord(body)) throw new ApplicationsClientError("invalid_response");
    return parseDuplicateAudit(body.audit);
  },

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

  async mergeApplications(input) {
    const response = await browserApiFetch("/api/applications/merge", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = await readResponse(response);
    if (!response.ok) {
      const code = errorCode(body);
      throw new ApplicationsClientError(
        code,
        undefined,
        code === "application_merge_unresolved_conflicts" &&
          isRecord(body) &&
          body.preview !== undefined
          ? parseMergePreview(body.preview)
          : undefined,
      );
    }
    if (!isRecord(body)) throw new ApplicationsClientError("invalid_response");
    return parseMergeResult(body.merge);
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
    const body = await readResponse(response);
    if (!response.ok) {
      const code = errorCode(body);
      if (code === "application_conflict" && isRecord(body)) {
        throw new ApplicationsClientError(
          code,
          parseApplication(body.application),
        );
      }
      throw new ApplicationsClientError(code);
    }
    if (!isRecord(body)) throw new ApplicationsClientError("invalid_response");
    return parseApplication(body.application);
  },
};
