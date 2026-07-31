import type { AuthenticatedActor } from "./auth.js";
import type {
  AddApplicationActivityInput,
  AddApplicationEventInput,
  ApplicationActivityType,
  ApplicationContactInput,
  ApplicationLinkInput,
  ApplicationMergeField,
  ApplicationMergeResolutions,
  AuditDuplicateApplicationsInput,
  ApplicationFieldName,
  ApplicationFieldProvenanceSource,
  ApplicationFieldState,
  CreateApplicationInput,
  MergeApplicationsInput,
  RecordApplicationFieldProvenanceInput,
  SalaryDetails,
  UpdateApplicationInput,
  VerifyApplicationFieldProvenanceInput,
  WorkArrangement,
  WorkArrangementDetails,
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
  outlookGraphConnectionId: string | null;
  outlookGraphConnectionName: string | null;
  rating: number | null;
  roleType: string | null;
  roleTypeId: string | null;
  roleTitle: string;
  salary: string | null;
  salaryDetails: SalaryDetails | null;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  status: string;
  statusId: string;
  statusIsTerminal: boolean;
  updatedAt: string;
  workArrangement: WorkArrangement | null;
  workArrangementDetails: WorkArrangementDetails | null;
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
  outlookGraphConnectionId?: string | null;
  rating: number | null;
  roleTypeId: string | null;
  roleTitle: string;
  salary: string | null;
  salaryDetails: SalaryDetails | null;
  sourceId: string | null;
  sourceUrl: string | null;
  statusId: string;
  workspaceId: string;
  workArrangement: WorkArrangement | null;
  workArrangementDetails: WorkArrangementDetails | null;
}

export type ApplicationFieldProvenanceRelationship =
  "conflicting" | "corroborating" | "selected" | "stale";

export interface ApplicationFieldProvenanceRecord {
  applicationId: string;
  confidence: number;
  createdAt: string;
  field: ApplicationFieldName;
  fieldState: ApplicationFieldState;
  id: string;
  idempotencyKey: string | null;
  observedAt: string;
  relationship: ApplicationFieldProvenanceRelationship;
  source: ApplicationFieldProvenanceSource;
  value: boolean | number | string | null;
  verifiedAt: string | null;
  verifiedByDisplayName: string | null;
  verifiedByUserId: string | null;
}

export interface ApplicationFieldProvenanceAssessment {
  conflicting: number;
  field: ApplicationFieldName;
  records: ApplicationFieldProvenanceRecord[];
  selected: ApplicationFieldProvenanceRecord | null;
  stale: number;
}

export interface RecordApplicationFieldProvenanceRecord extends RecordApplicationFieldProvenanceInput {
  createdAt: string;
  workspaceId: string;
}

export interface VerifyApplicationFieldProvenanceRecord extends VerifyApplicationFieldProvenanceInput {
  verifiedAt: string;
  verifiedByUserId: string;
  workspaceId: string;
}

export interface DeleteApplicationRecord {
  actorUserId: string;
  applicationId: string;
  deletedAt: string;
  workspaceId: string;
}

interface ApplicationEventBase {
  actorDisplayName: string;
  id: string;
  occurredAt: string;
  processedAt: string;
  sourceEmailMessageId: string | null;
}

export interface ApplicationCreatedEvent extends ApplicationEventBase {
  fromStatus: null;
  statusOverrideReason: string | null;
  toStatus: string;
  type: "application_created";
}

export interface ApplicationStatusChangedEvent extends ApplicationEventBase {
  fromStatus: string;
  statusOverrideReason: string | null;
  toStatus: string;
  type: "status_changed";
}

export interface ApplicationActivityEvent extends ApplicationEventBase {
  correctionReason: string | null;
  fromStatus: null;
  idempotencyKey: string | null;
  sourceEmailEvidenceId: string | null;
  statusOverrideReason: null;
  summary: string;
  supersedesEventId: string | null;
  toStatus: null;
  type: ApplicationActivityType;
}

export type ApplicationEvent =
  | ApplicationActivityEvent
  | ApplicationCreatedEvent
  | ApplicationStatusChangedEvent;

export interface ApplicationEventsPage {
  events: ApplicationEvent[];
  limit: number;
  nextOffset: number | null;
  offset: number;
  returned: number;
  total: number;
}

export interface AddApplicationActivityRecord {
  actorUserId: string;
  applicationId: string;
  correctionReason: string | null;
  idempotencyKey: string | null;
  occurredAt: string;
  processedAt: string;
  sourceEmailEvidenceId: string | null;
  sourceEmailMessageId: string | null;
  summary: string;
  supersedesEventId: string | null;
  type: ApplicationActivityType;
  workspaceId: string;
}

export interface ApplicationStatusEventInput {
  effectiveAt: string;
  overrideReason: string | null;
  sourceEmailMessageId: string | null;
}

export interface AddApplicationEventResult {
  application: ApplicationRecord;
  event: ApplicationEvent;
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
  addApplicationActivity(
    input: AddApplicationActivityRecord,
  ): ApplicationActivityEvent | undefined;
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
  listApplicationEventsPage(
    workspaceId: string,
    applicationId: string,
    input: { limit: number; offset: number },
  ): ApplicationEventsPage | undefined;
  listApplications(workspaceId: string): ApplicationRecord[];
  listApplicationFieldProvenance(
    workspaceId: string,
    applicationId: string,
  ): ApplicationFieldProvenanceAssessment[] | undefined;
  recordApplicationFieldProvenance(
    input: RecordApplicationFieldProvenanceRecord,
  ): ApplicationFieldProvenanceRecord | undefined;
  updateApplication(
    input: UpdateApplicationRecord,
  ): ApplicationRecord | undefined;
  verifyApplicationFieldProvenance(
    input: VerifyApplicationFieldProvenanceRecord,
  ): ApplicationFieldProvenanceRecord | undefined;
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

export class InvalidOutlookGraphConnectionAssignmentError extends Error {
  public constructor() {
    super("The Microsoft Graph connection is not available in this workspace");
    this.name = "InvalidOutlookGraphConnectionAssignmentError";
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

export class ApplicationEventNoChangeError extends Error {
  public constructor() {
    super("The requested status is already current");
    this.name = "ApplicationEventNoChangeError";
  }
}

export class ApplicationActivityIdempotencyConflictError extends Error {
  public constructor() {
    super("The activity idempotency key is already used by another event");
    this.name = "ApplicationActivityIdempotencyConflictError";
  }
}

export class ApplicationActivityCorrectionError extends Error {
  public constructor(
    public readonly code:
      "correction_already_exists" | "invalid_correction_target",
  ) {
    super(code);
    this.name = "ApplicationActivityCorrectionError";
  }
}

export class ApplicationActivityEvidenceError extends Error {
  public constructor() {
    super("The linked email evidence does not belong to this application");
    this.name = "ApplicationActivityEvidenceError";
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

export class ApplicationFieldProvenanceSourceError extends Error {
  public constructor() {
    super("The provenance source is not associated with this application");
    this.name = "ApplicationFieldProvenanceSourceError";
  }
}

export class ApplicationFieldProvenanceIdempotencyConflictError extends Error {
  public constructor() {
    super(
      "The provenance idempotency key is already used by another observation",
    );
    this.name = "ApplicationFieldProvenanceIdempotencyConflictError";
  }
}

export class ApplicationFieldProvenanceVerificationConflictError extends Error {
  public constructor() {
    super("The provenance observation was already verified by another actor");
    this.name = "ApplicationFieldProvenanceVerificationConflictError";
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
      outlookGraphConnectionId: input.outlookGraphConnectionId ?? null,
      rating: input.rating ?? null,
      roleTypeId: input.roleTypeId ?? null,
      roleTitle: input.roleTitle,
      salary: input.salary ?? null,
      salaryDetails: input.salaryDetails ?? null,
      sourceId: input.sourceId ?? null,
      sourceUrl: input.sourceUrl ?? null,
      statusId: input.statusId,
      workspaceId: actor.workspaceId,
      workArrangement: input.workArrangement ?? null,
      workArrangementDetails: input.workArrangementDetails ?? null,
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

  public listApplicationFieldProvenance(
    actor: AuthenticatedActor,
    applicationId: string,
  ): ApplicationFieldProvenanceAssessment[] {
    const assessments = this.repository.listApplicationFieldProvenance(
      actor.workspaceId,
      applicationId,
    );
    if (!assessments) throw new ApplicationNotFoundError();
    return assessments;
  }

  public recordApplicationFieldProvenance(
    actor: AuthenticatedActor,
    input: RecordApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord {
    const record = this.repository.recordApplicationFieldProvenance({
      ...input,
      createdAt: this.clock().toISOString(),
      workspaceId: actor.workspaceId,
    });
    if (!record) throw new ApplicationNotFoundError();
    return record;
  }

  public verifyApplicationFieldProvenance(
    actor: AuthenticatedActor,
    input: VerifyApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord {
    const record = this.repository.verifyApplicationFieldProvenance({
      ...input,
      verifiedAt: this.clock().toISOString(),
      verifiedByUserId: actor.userId,
      workspaceId: actor.workspaceId,
    });
    if (!record) throw new ApplicationNotFoundError();
    return record;
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

  public listApplicationEventsPage(
    actor: AuthenticatedActor,
    applicationId: string,
    input: { limit: number; offset: number },
  ): ApplicationEventsPage {
    const page = this.repository.listApplicationEventsPage(
      actor.workspaceId,
      applicationId,
      input,
    );
    if (!page) throw new ApplicationNotFoundError();
    return page;
  }

  public addApplicationActivity(
    actor: AuthenticatedActor,
    input: AddApplicationActivityInput,
  ): ApplicationActivityEvent {
    const event = this.repository.addApplicationActivity({
      actorUserId: actor.userId,
      applicationId: input.applicationId,
      correctionReason: input.correctionReason ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      occurredAt: input.occurredAt,
      processedAt: this.clock().toISOString(),
      sourceEmailEvidenceId: input.sourceEmailEvidenceId ?? null,
      sourceEmailMessageId: input.sourceEmailMessageId ?? null,
      summary: input.summary,
      supersedesEventId: input.supersedesEventId ?? null,
      type: input.type,
      workspaceId: actor.workspaceId,
    });
    if (!event) throw new ApplicationNotFoundError();
    return event;
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

  public addApplicationEvent(
    actor: AuthenticatedActor,
    input: AddApplicationEventInput,
  ): AddApplicationEventResult {
    const current = this.listApplications(actor).find(
      ({ id }) => id === input.applicationId,
    );
    if (!current) throw new ApplicationNotFoundError();
    const sourceEmailMessageId = input.sourceEmailMessageId ?? null;
    const existingSourceEvent = sourceEmailMessageId
      ? this.listApplicationEvents(actor, input.applicationId).find(
          (event) =>
            event.type === "status_changed" &&
            event.sourceEmailMessageId === sourceEmailMessageId,
        )
      : undefined;
    if (existingSourceEvent) {
      if (
        current.statusId === input.statusId &&
        existingSourceEvent.occurredAt === input.occurredAt &&
        existingSourceEvent.toStatus === current.status
      ) {
        return { application: current, event: existingSourceEvent };
      }
      throw new ApplicationStatusEventConflictError();
    }
    if (current.statusId === input.statusId) {
      throw new ApplicationEventNoChangeError();
    }

    const application = this.updateApplicationFromEmail(
      actor,
      input.applicationId,
      {
        expectedUpdatedAt: input.expectedUpdatedAt,
        statusId: input.statusId,
      },
      {
        effectiveAt: input.occurredAt,
        overrideReason: input.statusOverride?.reason ?? null,
        sourceEmailMessageId,
      },
    );
    const event = this.listApplicationEvents(actor, input.applicationId).find(
      (candidate) =>
        candidate.type === "status_changed" &&
        candidate.occurredAt === input.occurredAt &&
        candidate.sourceEmailMessageId === sourceEmailMessageId &&
        candidate.toStatus === application.status,
    );
    if (!event) {
      throw new Error("The immutable application event could not be read back");
    }
    return { application, event };
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
