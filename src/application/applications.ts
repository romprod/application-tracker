import type { AuthenticatedActor } from "./auth.js";
import type {
  ApplicationContactInput,
  ApplicationLinkInput,
  ApplicationMergeField,
  ApplicationMergeResolutions,
  AuditDuplicateApplicationsInput,
  CreateApplicationInput,
  MergeApplicationsInput,
  UpdateApplicationInput,
  WorkArrangement,
} from "../domain/applications.js";
import type { DocumentRecord } from "./documents.js";
import type {
  ApplicationEmailEvidence,
  ApplicationJobPosting,
} from "./job_email_reconciliation.js";

export interface ApplicationContact {
  email: string | null;
  name: string;
  phone: string | null;
  role: string | null;
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
  status: string;
  statusId: string;
  statusIsTerminal: boolean;
  updatedAt: string;
  workArrangement: WorkArrangement | null;
}

export interface CreateApplicationRecord {
  agency: string | null;
  appliedOn: string | null;
  companyName: string;
  contacts?: ApplicationContact[];
  createdAt: string;
  createdByUserId: string;
  location: string | null;
  links?: ApplicationLink[];
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  rating: number | null;
  roleTypeId: string | null;
  roleTitle: string;
  salary: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  statusId: string;
  workspaceId: string;
  workArrangement: WorkArrangement | null;
}

export interface DeleteApplicationRecord {
  actorUserId: string;
  applicationId: string;
  deletedAt: string;
  workspaceId: string;
}

export type ApplicationEventType = "application_created" | "status_changed";

export interface ApplicationEvent {
  actorDisplayName: string;
  fromStatus: string | null;
  id: string;
  occurredAt: string;
  processedAt: string;
  sourceEmailMessageId: string | null;
  statusOverrideReason: string | null;
  toStatus: string;
  type: ApplicationEventType;
}

export interface ApplicationStatusEventInput {
  effectiveAt: string;
  overrideReason: string | null;
  sourceEmailMessageId: string;
}

export type ApplicationDuplicateConfidence =
  "definite" | "possible" | "probable";

export type ApplicationDuplicateReasonKind =
  | "agency"
  | "applied_date"
  | "canonical_url"
  | "company_title"
  | "contact"
  | "email_message_id"
  | "location"
  | "posting_id";

export interface ApplicationDuplicateReason {
  detail: string;
  kind: ApplicationDuplicateReasonKind;
}

export interface ApplicationDuplicateCandidate {
  applications: [ApplicationRecord, ApplicationRecord];
  confidence: ApplicationDuplicateConfidence;
  reasons: ApplicationDuplicateReason[];
}

export interface ApplicationDuplicateAudit {
  candidates: ApplicationDuplicateCandidate[];
  nextOffset: number | null;
  offset: number;
  returned: number;
  total: number;
}

export type ApplicationMergeFieldValue = number | string | null;

export interface ApplicationMergeFieldConflict {
  field: ApplicationMergeField;
  resolution: "source" | "target" | null;
  resolvedValue: ApplicationMergeFieldValue;
  sourceValue: ApplicationMergeFieldValue;
  targetValue: ApplicationMergeFieldValue;
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

export interface ApplicationMergeLineage {
  actorDisplayName: string;
  id: string;
  mergedAt: string;
  sourceApplicationId: string;
  sourceUpdatedAt: string;
  targetApplicationId: string;
  targetUpdatedAt: string;
}

export interface ApplicationMergePreview {
  contacts: ApplicationMergeRelationshipPreview<ApplicationContact>;
  documents: ApplicationMergeRelationshipPreview<DocumentRecord>;
  emailEvidence: ApplicationMergeRelationshipPreview<ApplicationEmailEvidence>;
  fieldConflicts: ApplicationMergeFieldConflict[];
  history: {
    sourceEvents: ApplicationEvent[];
    targetEvents: ApplicationEvent[];
  };
  informationNotRetained: string[];
  jobPostings: ApplicationMergeRelationshipPreview<ApplicationJobPosting>;
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
  lineage: ApplicationMergeLineage | null;
  preview: ApplicationMergePreview;
}

export interface ApplyApplicationMergeRecord {
  actorUserId: string;
  expectedSourceUpdatedAt: string;
  expectedTargetUpdatedAt: string;
  mergedAt: string;
  resolutions: ApplicationMergeResolutions;
  sourceApplicationId: string;
  targetApplicationId: string;
  workspaceId: string;
}

export type UpdateApplicationRecord = Omit<
  UpdateApplicationInput,
  "contacts" | "links"
> & {
  actorUserId: string;
  applicationId: string;
  contacts?: ApplicationContact[];
  links?: ApplicationLink[];
  statusEvent?: ApplicationStatusEventInput;
  updatedAt: string;
  workspaceId: string;
};

function contactRecord(contact: ApplicationContactInput): ApplicationContact {
  return {
    email: contact.email ?? null,
    name: contact.name,
    phone: contact.phone ?? null,
    role: contact.role ?? null,
  };
}

function linkRecord(link: ApplicationLinkInput): ApplicationLink {
  return { label: link.label, url: link.url };
}

export interface ApplicationsRepository {
  auditDuplicateApplications(
    workspaceId: string,
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit;
  createApplication(input: CreateApplicationRecord): ApplicationRecord;
  deleteApplication(input: DeleteApplicationRecord): boolean;
  mergeApplications(input: ApplyApplicationMergeRecord): ApplicationMergeResult;
  previewApplicationMerge(
    workspaceId: string,
    sourceApplicationId: string,
    targetApplicationId: string,
    resolutions?: ApplicationMergeResolutions,
  ): ApplicationMergePreview;
  listApplicationEvents(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEvent[] | undefined;
  listApplications(workspaceId: string): ApplicationRecord[];
  updateApplication(
    input: UpdateApplicationRecord,
  ): ApplicationRecord | undefined;
}

export class ApplicationNotFoundError extends Error {
  public constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundError";
  }
}

export class InvalidApplicationReferenceError extends Error {
  public constructor() {
    super("Invalid application reference value");
    this.name = "InvalidApplicationReferenceError";
  }
}

export class ApplicationConflictError extends Error {
  public constructor(public readonly application: ApplicationRecord) {
    super("Application changed since it was read");
    this.name = "ApplicationConflictError";
  }
}

export class ApplicationStatusEventConflictError extends Error {
  public constructor() {
    super("The email status event conflicts with an existing event");
    this.name = "ApplicationStatusEventConflictError";
  }
}

export class ApplicationStatusRegressionError extends Error {
  public constructor() {
    super(
      "The email status event would regress the current application status",
    );
    this.name = "ApplicationStatusRegressionError";
  }
}

export class ApplicationStatusStaleError extends Error {
  public constructor() {
    super("The email status event is older than the current status event");
    this.name = "ApplicationStatusStaleError";
  }
}

export class ApplicationMergeNotFoundError extends Error {
  public constructor() {
    super("One or both applications could not be found");
    this.name = "ApplicationMergeNotFoundError";
  }
}

export class ApplicationMergeStateError extends Error {
  public constructor(
    public readonly code:
      | "application_already_merged"
      | "application_merge_deleted"
      | "application_merge_target_unavailable",
  ) {
    super(code);
    this.name = "ApplicationMergeStateError";
  }
}

export class ApplicationMergeVersionConflictError extends Error {
  public constructor(
    public readonly source: ApplicationRecord,
    public readonly target: ApplicationRecord,
  ) {
    super("One or both applications changed since the merge was previewed");
    this.name = "ApplicationMergeVersionConflictError";
  }
}

export class ApplicationMergeUnsafeError extends Error {
  public constructor(public readonly preview: ApplicationMergePreview) {
    super("The merge has unresolved conflicts");
    this.name = "ApplicationMergeUnsafeError";
  }
}

function nextUpdatedAt(expectedUpdatedAt: string, now: Date): string {
  const expectedMilliseconds = new Date(expectedUpdatedAt).getTime();
  return new Date(
    Math.max(now.getTime(), expectedMilliseconds + 1),
  ).toISOString();
}

function nextMergeTimestamp(
  sourceUpdatedAt: string,
  targetUpdatedAt: string,
  now: Date,
): string {
  const latest =
    sourceUpdatedAt > targetUpdatedAt ? sourceUpdatedAt : targetUpdatedAt;
  return nextUpdatedAt(latest, now);
}

export class ApplicationLedgerService {
  public constructor(
    private readonly repository: ApplicationsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public createApplication(
    actor: AuthenticatedActor,
    input: CreateApplicationInput,
  ): ApplicationRecord {
    return this.repository.createApplication({
      agency: input.agency ?? null,
      appliedOn: input.appliedOn ?? null,
      companyName: input.companyName,
      contacts: (input.contacts ?? []).map(contactRecord),
      createdAt: this.clock().toISOString(),
      createdByUserId: actor.userId,
      location: input.location ?? null,
      links: (input.links ?? []).map(linkRecord),
      nextAction: input.nextAction ?? null,
      nextActionDue: input.nextActionDue ?? null,
      notes: input.notes ?? null,
      rating: input.rating ?? null,
      roleTypeId: input.roleTypeId ?? null,
      roleTitle: input.roleTitle,
      salary: input.salary ?? null,
      sourceId: input.sourceId ?? null,
      sourceUrl: input.sourceUrl ?? null,
      statusId: input.statusId,
      workspaceId: actor.workspaceId,
      workArrangement: input.workArrangement ?? null,
    });
  }

  public auditDuplicateApplications(
    actor: AuthenticatedActor,
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit {
    return this.repository.auditDuplicateApplications(actor.workspaceId, input);
  }

  public listApplications(actor: AuthenticatedActor): ApplicationRecord[] {
    return this.repository.listApplications(actor.workspaceId);
  }

  public mergeApplications(
    actor: AuthenticatedActor,
    input: MergeApplicationsInput,
  ): ApplicationMergeResult {
    if (input.mode === "preview") {
      return {
        alreadyApplied: false,
        applied: false,
        lineage: null,
        preview: this.repository.previewApplicationMerge(
          actor.workspaceId,
          input.sourceApplicationId,
          input.targetApplicationId,
          input.resolutions,
        ),
      };
    }
    return this.repository.mergeApplications({
      actorUserId: actor.userId,
      expectedSourceUpdatedAt: input.expectedSourceUpdatedAt,
      expectedTargetUpdatedAt: input.expectedTargetUpdatedAt,
      mergedAt: nextMergeTimestamp(
        input.expectedSourceUpdatedAt,
        input.expectedTargetUpdatedAt,
        this.clock(),
      ),
      resolutions: input.resolutions,
      sourceApplicationId: input.sourceApplicationId,
      targetApplicationId: input.targetApplicationId,
      workspaceId: actor.workspaceId,
    });
  }

  public deleteApplication(
    actor: AuthenticatedActor,
    applicationId: string,
  ): void {
    const deleted = this.repository.deleteApplication({
      actorUserId: actor.userId,
      applicationId,
      deletedAt: this.clock().toISOString(),
      workspaceId: actor.workspaceId,
    });
    if (!deleted) throw new ApplicationNotFoundError();
  }

  public listApplicationEvents(
    actor: AuthenticatedActor,
    applicationId: string,
  ): ApplicationEvent[] {
    const events = this.repository.listApplicationEvents(
      actor.workspaceId,
      applicationId,
    );
    if (!events) throw new ApplicationNotFoundError();
    return events;
  }

  public updateApplication(
    actor: AuthenticatedActor,
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord {
    const { contacts, links, ...fields } = input;
    const application = this.repository.updateApplication({
      ...fields,
      actorUserId: actor.userId,
      applicationId,
      ...(contacts ? { contacts: contacts.map(contactRecord) } : {}),
      ...(links ? { links: links.map(linkRecord) } : {}),
      updatedAt: nextUpdatedAt(input.expectedUpdatedAt, this.clock()),
      workspaceId: actor.workspaceId,
    });
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }

  public updateApplicationFromEmail(
    actor: AuthenticatedActor,
    applicationId: string,
    input: UpdateApplicationInput,
    statusEvent: ApplicationStatusEventInput,
  ): ApplicationRecord {
    const { contacts, links, ...fields } = input;
    const application = this.repository.updateApplication({
      ...fields,
      actorUserId: actor.userId,
      applicationId,
      ...(contacts ? { contacts: contacts.map(contactRecord) } : {}),
      ...(links ? { links: links.map(linkRecord) } : {}),
      statusEvent,
      updatedAt: nextUpdatedAt(input.expectedUpdatedAt, this.clock()),
      workspaceId: actor.workspaceId,
    });
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }
}
