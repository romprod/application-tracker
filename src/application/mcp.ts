import { createHash } from "node:crypto";

import {
  type ApplicationActivityEvent,
  type ApplicationAttentionPage,
  type AddApplicationEventResult,
  ApplicationNotFoundError,
  type ApplicationDuplicateAudit,
  type ApplicationEvent,
  type ApplicationEventsPage,
  type ApplicationFieldProvenanceAssessment,
  type ApplicationFieldProvenanceRecord,
  type ApplicationMergeResult,
  type ApplicationRecord,
} from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import type {
  DocumentContentChunk,
  DocumentRecord,
  ImportDocumentInput,
} from "./documents.js";
import {
  type EmailLinkCandidate,
  type EmailLinkExtractionService,
} from "./email_links.js";
import {
  type JobLinkResolutionResult,
  JobLinkResolutionService,
} from "./job_links.js";
import {
  type JobPostingInspectionResult,
  JobPostingInspectionService,
} from "./job_posting_inspection.js";
import {
  type BeginMcpDocumentImportInput,
  type McpDocumentImportManager,
  type McpDocumentImportProgress,
} from "./mcp_document_imports.js";
import type {
  AddApplicationActivityInput,
  AddApplicationEventInput,
  AuditDuplicateApplicationsInput,
  CreateApplicationInput,
  MergeApplicationsInput,
  RecordApplicationFieldProvenanceInput,
  UpdateApplicationInput,
  VerifyApplicationFieldProvenanceInput,
} from "../domain/applications.js";
import type { ApplicationAttentionQueryInput } from "../domain/application_attention.js";
import type { McpAccessMode } from "./mcp_access.js";
import type { ReferenceValue } from "./reference_values.js";
import {
  JobEmailReconciliationUnavailableError,
  type ApplicationEmailEvidence,
  type ApplicationJobPosting,
  type JobEmailMatchResult,
  type JobEmailReconciliationService,
  type LinkApplicationEvidenceResult,
  type UpsertApplicationFromEmailResult,
} from "./job_email_reconciliation.js";
import type {
  LinkEmailEvidenceInput,
  MatchJobApplicationEmailInput,
  ReconcileApplicationFromEvidenceInput,
  UpsertApplicationFromEmailInput,
} from "../domain/job_email_reconciliation.js";
import type { EmailLinkExtractionInput } from "../domain/email_links.js";
import type { JobPostingInspectionInput } from "../domain/job_postings.js";
import type { SyncOutlookEmailEvidenceInput } from "../domain/outlook_email_sync.js";
import type { ReconcileOutlookGraphConnectionInput } from "../domain/outlook_connection_reconciliation.js";
import type {
  ProcessOutlookJobDigestInput,
  SearchOutlookJobDigestsInput,
} from "../domain/outlook_job_digest.js";
import { applicationMcpSchemaManifest } from "./mcp_schema_manifest.js";
import { applicationMcpPublishedSchema } from "./mcp_published_schema.js";
import {
  OutlookEmailSyncOperationalError,
  type OutlookEmailSyncResult,
  type OutlookEmailSyncService,
} from "./outlook_email_sync.js";
import type {
  OutlookConnectionReconciliationResult,
  OutlookConnectionReconciliationService,
} from "./outlook_connection_reconciliation.js";
import type {
  OutlookJobDigestProcessingResult,
  OutlookJobDigestProcessingService,
  OutlookJobDigestSearchResult,
} from "./outlook_job_digest.js";

export { applicationMcpSchemaManifest, applicationMcpPublishedSchema };

export const applicationMcpSchemaVersion = 20;
export const mcpSchemaPublicationDocumentationUrl =
  "https://developers.openai.com/apps-sdk/deploy/submission#how-published-app-metadata-versions-work";

export const applicationMcpToolNames = [
  "get_tracker_context",
  "get_connector_schema_status",
  "get_job_search_summary",
  "query_application_attention",
  "list_applications",
  "get_application",
  "list_application_events",
  "list_unlinked_applications",
  "get_application_data_quality",
  "audit_duplicate_applications",
  "find_duplicate_applications",
  "merge_applications",
  "match_job_application_email",
  "link_email_evidence",
  "reconcile_application_from_evidence",
  "sync_outlook_email_evidence",
  "reconcile_outlook_graph_connection",
  "search_outlook_job_digests",
  "process_outlook_job_digest",
  "extract_job_links",
  "resolve_job_links",
  "inspect_job_posting",
  "get_reference_data",
  "get_document_import_capabilities",
  "list_documents",
  "export_document_chunk",
  "create_application",
  "update_application",
  "bulk_update_applications",
  "add_application_event",
  "add_application_activity",
  "record_application_field_provenance",
  "verify_application_field_provenance",
  "delete_application",
  "upsert_application_from_email",
  "begin_document_import",
  "append_document_chunk",
  "complete_document_import",
  "cancel_document_import",
] as const;

export interface McpConnectorSchemaStatus {
  documentationUrl: string;
  live: {
    schemaSha256: string;
    schemaVersion: number;
    toolCount: number;
    tools: {
      name: string;
      schemaSha256: string;
    }[];
  };
  publication: {
    schemaSha256: string;
    schemaVersion: number;
    status: "current" | "update_available";
    toolCount: number;
  };
  publicationRequired: false;
  refreshMethod: "scan_submit_publish";
  selfRefreshSupported: false;
}

export function getApplicationMcpSchemaStatus(): McpConnectorSchemaStatus {
  const liveSchemaSha256: string = applicationMcpSchemaManifest.schemaSha256;
  const liveSchemaVersion: number = applicationMcpSchemaManifest.schemaVersion;
  const liveToolCount: number = applicationMcpSchemaManifest.toolCount;
  const publishedSchemaSha256: string =
    applicationMcpPublishedSchema.schemaSha256;
  const publishedSchemaVersion: number =
    applicationMcpPublishedSchema.schemaVersion;
  const publishedToolCount: number = applicationMcpPublishedSchema.toolCount;
  const publicationIsCurrent =
    liveSchemaSha256 === publishedSchemaSha256 &&
    liveSchemaVersion === publishedSchemaVersion &&
    liveToolCount === publishedToolCount;

  return {
    documentationUrl: mcpSchemaPublicationDocumentationUrl,
    live: {
      schemaSha256: applicationMcpSchemaManifest.schemaSha256,
      schemaVersion: applicationMcpSchemaManifest.schemaVersion,
      toolCount: applicationMcpSchemaManifest.toolCount,
      tools: applicationMcpSchemaManifest.tools.map((tool) => ({ ...tool })),
    },
    publication: {
      schemaSha256: applicationMcpPublishedSchema.schemaSha256,
      schemaVersion: applicationMcpPublishedSchema.schemaVersion,
      status: publicationIsCurrent ? "current" : "update_available",
      toolCount: applicationMcpPublishedSchema.toolCount,
    },
    publicationRequired: false,
    refreshMethod: "scan_submit_publish",
    selfRefreshSupported: false,
  };
}

export interface LocalMcpActorBinding {
  username: string;
  workspaceSlug: string;
}

export interface LocalMcpActorRepository {
  findActiveActor(
    binding: LocalMcpActorBinding,
  ): AuthenticatedActor | undefined;
}

export interface McpActorProvider {
  getActor(): AuthenticatedActor;
  getWorkspaceSlug(): string;
}

export interface McpApplicationsReader {
  listApplicationEvents(
    actor: AuthenticatedActor,
    applicationId: string,
  ): ApplicationEvent[];
  listApplicationEventsPage(
    actor: AuthenticatedActor,
    applicationId: string,
    input: { limit: number; offset: number },
  ): ApplicationEventsPage;
  listApplications(actor: AuthenticatedActor): ApplicationRecord[];
  queryApplicationAttention(
    actor: AuthenticatedActor,
    input: ApplicationAttentionQueryInput,
  ): ApplicationAttentionPage;
  listApplicationFieldProvenance(
    actor: AuthenticatedActor,
    applicationId: string,
  ): ApplicationFieldProvenanceAssessment[];
}

export interface McpApplicationsService extends McpApplicationsReader {
  addApplicationActivity(
    actor: AuthenticatedActor,
    input: AddApplicationActivityInput,
  ): ApplicationActivityEvent;
  addApplicationEvent(
    actor: AuthenticatedActor,
    input: AddApplicationEventInput,
  ): AddApplicationEventResult;
  auditDuplicateApplications(
    actor: AuthenticatedActor,
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit;
  createApplication(
    actor: AuthenticatedActor,
    input: CreateApplicationInput,
  ): ApplicationRecord;
  deleteApplication(actor: AuthenticatedActor, applicationId: string): void;
  mergeApplications(
    actor: AuthenticatedActor,
    input: MergeApplicationsInput,
  ): ApplicationMergeResult;
  recordApplicationFieldProvenance(
    actor: AuthenticatedActor,
    input: RecordApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord;
  updateApplication(
    actor: AuthenticatedActor,
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord;
  verifyApplicationFieldProvenance(
    actor: AuthenticatedActor,
    input: VerifyApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord;
}

export interface McpAccessPolicy {
  getAccessMode(workspaceId: string): McpAccessMode;
  requireWriteAccess(actor: AuthenticatedActor): void;
}

export interface McpReferenceValuesReader {
  listReferenceValues(actor: AuthenticatedActor): ReferenceValue[];
}

export interface McpDocumentsService {
  getDocumentChunk(
    actor: AuthenticatedActor,
    documentId: string,
    offset: number,
    maxBytes: number,
  ): DocumentContentChunk;
  importDocument(
    actor: AuthenticatedActor,
    input: ImportDocumentInput,
  ): DocumentRecord;
  listDocuments(actor: AuthenticatedActor): DocumentRecord[];
}

export interface LocalMcpTrackerContext {
  access: McpAccessMode;
  actor: AuthenticatedActor["user"];
  workspace: {
    name: string;
    slug: string;
  };
}

export interface McpStatusCount {
  count: number;
  isTerminal: boolean;
  status: string;
  statusId: string;
}

export interface McpJobSearchSummary {
  asOfDate: string;
  byStatus: McpStatusCount[];
  dueTodayActions: number;
  openActions: number;
  openApplications: number;
  overdueActions: number;
  terminalApplications: number;
  totalApplications: number;
}

export interface McpApplicationSummary {
  agency: string | null;
  appliedOn: string | null;
  companyName: string;
  id: string;
  location: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  rating: number | null;
  roleTitle: string;
  salary: string | null;
  salaryDetails: ApplicationRecord["salaryDetails"];
  status: string;
  statusId: string;
  statusIsTerminal: boolean;
  updatedAt: string;
  workArrangement: ApplicationRecord["workArrangement"];
  workArrangementDetails: ApplicationRecord["workArrangementDetails"];
}

export interface McpApplicationList {
  applications: McpApplicationSummary[];
  nextOffset: number | null;
  offset: number;
  returned: number;
  total: number;
}

export interface McpUnlinkedApplication {
  application: McpApplicationSummary;
  emailEvidenceCount: 0;
  jobPostingCount: 0;
  missingEmailEvidence: true;
  missingJobPostingEvidence: true;
}

export interface McpUnlinkedApplicationList {
  applications: McpUnlinkedApplication[];
  nextOffset: number | null;
  offset: number;
  returned: number;
  total: number;
}

export type McpApplicationDataQualityIssueCode =
  | "missing_email_evidence"
  | "missing_job_posting_evidence"
  | "missing_location"
  | "missing_next_action"
  | "missing_role_type"
  | "missing_source"
  | "missing_source_url"
  | "missing_work_arrangement"
  | "next_action_due_without_action"
  | "next_action_without_due_date";

export interface McpApplicationDataQualityIssue {
  code: McpApplicationDataQualityIssueCode;
  severity: "info" | "warning";
}

export interface McpApplicationDataQualityFinding {
  application: McpApplicationSummary;
  issues: McpApplicationDataQualityIssue[];
}

export interface McpApplicationDataQualityReport {
  applicationsWithFindings: number;
  countsByCode: {
    code: McpApplicationDataQualityIssueCode;
    count: number;
  }[];
  findings: McpApplicationDataQualityFinding[];
  nextOffset: number | null;
  offset: number;
  returned: number;
  totalApplications: number;
  totalIssues: number;
}

export interface McpApplicationDetail {
  application: ApplicationRecord;
  emailEvidence: ApplicationEmailEvidence[];
  events: ApplicationEvent[];
  eventsPage: Omit<ApplicationEventsPage, "events">;
  jobPostings: ApplicationJobPosting[];
  provenance: ApplicationFieldProvenanceAssessment[];
}

export interface McpReferenceData {
  values: ReferenceValue[];
}

export interface McpEmailLinkCandidates {
  candidates: EmailLinkCandidate[];
}

export interface McpBulkApplicationUpdate {
  applicationId: string;
  update: UpdateApplicationInput;
}

export interface McpBulkApplicationUpdateResult {
  applications: {
    id: string;
    updatedAt: string;
  }[];
  updated: number;
}

export interface ListMcpApplicationsInput {
  limit: number;
  offset: number;
  statusId?: string;
}

export interface McpDocumentList {
  documents: DocumentRecord[];
  nextOffset: number | null;
  offset: number;
  returned: number;
  total: number;
}

export interface McpDocumentChunk {
  byteSize: number;
  chunkByteSize: number;
  chunkSha256: string;
  complete: boolean;
  contentBase64: string;
  document: DocumentRecord;
  nextOffset: number | null;
  offset: number;
  sha256: string;
}

export interface McpApplicationTools {
  addApplicationActivity(
    input: AddApplicationActivityInput,
  ): ApplicationActivityEvent;
  addApplicationEvent(
    input: AddApplicationEventInput,
  ): AddApplicationEventResult;
  auditDuplicateApplications(
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit;
  appendDocumentChunk(input: {
    chunkSha256: string;
    contentBase64: string;
    offset: number;
    uploadId: string;
  }): McpDocumentImportProgress;
  beginDocumentImport(
    input: BeginMcpDocumentImportInput,
  ): McpDocumentImportProgress;
  bulkUpdateApplications(
    updates: McpBulkApplicationUpdate[],
  ): McpBulkApplicationUpdateResult;
  cancelDocumentImport(uploadId: string): { cancelled: true };
  completeDocumentImport(uploadId: string): DocumentRecord;
  createApplication(input: CreateApplicationInput): ApplicationRecord;
  deleteApplication(applicationId: string): {
    applicationId: string;
    deleted: true;
  };
  extractJobLinks(input: EmailLinkExtractionInput): McpEmailLinkCandidates;
  exportDocumentChunk(input: {
    documentId: string;
    offset: number;
  }): McpDocumentChunk;
  findDuplicateApplications(
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit;
  getApplication(applicationId: string): McpApplicationDetail;
  getApplicationDataQuality(input: {
    limit: number;
    offset: number;
  }): McpApplicationDataQualityReport;
  getDocumentImportCapabilities(): {
    maxDocumentBytes: number;
    maxDocumentChunkBytes: number;
  };
  getJobSearchSummary(): McpJobSearchSummary;
  queryApplicationAttention(
    input: ApplicationAttentionQueryInput,
  ): ApplicationAttentionPage;
  getReferenceData(): McpReferenceData;
  getTrackerContext(): LocalMcpTrackerContext;
  inspectJobPosting(
    input: JobPostingInspectionInput,
  ): Promise<JobPostingInspectionResult>;
  linkEmailEvidence(
    input: LinkEmailEvidenceInput,
  ): LinkApplicationEvidenceResult;
  listApplications(input: ListMcpApplicationsInput): McpApplicationList;
  listApplicationEvents(input: {
    applicationId: string;
    limit: number;
    offset: number;
  }): ApplicationEventsPage;
  listDocuments(input: { limit: number; offset: number }): McpDocumentList;
  listUnlinkedApplications(input: {
    limit: number;
    offset: number;
  }): McpUnlinkedApplicationList;
  matchJobApplicationEmail(
    input: MatchJobApplicationEmailInput,
  ): JobEmailMatchResult;
  mergeApplications(input: MergeApplicationsInput): ApplicationMergeResult;
  recordApplicationFieldProvenance(
    input: RecordApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord;
  reconcileApplicationFromEvidence(
    input: ReconcileApplicationFromEvidenceInput,
  ): LinkApplicationEvidenceResult | UpsertApplicationFromEmailResult;
  prepareSyncOutlookEmailEvidence(
    input: SyncOutlookEmailEvidenceInput,
  ): Promise<PreparedMcpWriteOperation<OutlookEmailSyncResult>>;
  prepareReconcileOutlookGraphConnection(
    input: ReconcileOutlookGraphConnectionInput,
  ): Promise<PreparedMcpWriteOperation<OutlookConnectionReconciliationResult>>;
  processOutlookJobDigest(
    input: ProcessOutlookJobDigestInput,
  ): Promise<OutlookJobDigestProcessingResult>;
  searchOutlookJobDigests(
    input: SearchOutlookJobDigestsInput,
  ): Promise<OutlookJobDigestSearchResult>;
  resolveJobLinks(
    input: EmailLinkExtractionInput,
  ): Promise<JobLinkResolutionResult>;
  updateApplication(
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord;
  verifyApplicationFieldProvenance(
    input: VerifyApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord;
  upsertApplicationFromEmail(
    input: UpsertApplicationFromEmailInput,
  ): UpsertApplicationFromEmailResult;
}

export interface PreparedMcpWriteOperation<Result extends object> {
  commit(): Result;
}

export class LocalMcpActorUnavailableError extends Error {
  public constructor() {
    super("The configured local MCP actor is unavailable");
    this.name = "LocalMcpActorUnavailableError";
  }
}

export class InvalidMcpDocumentExportError extends Error {
  public constructor() {
    super("The document export offset is invalid");
    this.name = "InvalidMcpDocumentExportError";
  }
}

export class LocalMcpActorProvider {
  public constructor(
    private readonly repository: LocalMcpActorRepository,
    private readonly binding: LocalMcpActorBinding,
  ) {}

  public getActor(): AuthenticatedActor {
    const actor = this.repository.findActiveActor(this.binding);
    if (!actor) throw new LocalMcpActorUnavailableError();
    return actor;
  }

  public getWorkspaceSlug(): string {
    return this.binding.workspaceSlug;
  }
}

function applicationSummary(
  application: ApplicationRecord,
): McpApplicationSummary {
  return {
    agency: application.agency,
    appliedOn: application.appliedOn,
    companyName: application.companyName,
    id: application.id,
    location: application.location,
    nextAction: application.nextAction,
    nextActionDue: application.nextActionDue,
    rating: application.rating,
    roleTitle: application.roleTitle,
    salary: application.salary,
    salaryDetails: application.salaryDetails,
    status: application.status,
    statusId: application.statusId,
    statusIsTerminal: application.statusIsTerminal,
    updatedAt: application.updatedAt,
    workArrangement: application.workArrangement,
    workArrangementDetails: application.workArrangementDetails,
  };
}

function dataQualityIssues(
  application: ApplicationRecord,
  counts: { emailEvidenceCount: number; jobPostingCount: number },
): McpApplicationDataQualityIssue[] {
  const issues: McpApplicationDataQualityIssue[] = [];
  const add = (
    code: McpApplicationDataQualityIssueCode,
    severity: McpApplicationDataQualityIssue["severity"],
  ) => issues.push({ code, severity });
  if (counts.emailEvidenceCount === 0) add("missing_email_evidence", "info");
  if (counts.jobPostingCount === 0) {
    add("missing_job_posting_evidence", "info");
  }
  if (application.sourceId === null) add("missing_source", "warning");
  if (application.sourceUrl === null) add("missing_source_url", "info");
  if (application.roleTypeId === null) add("missing_role_type", "info");
  if (application.location === null) add("missing_location", "info");
  if (application.workArrangement === null) {
    add("missing_work_arrangement", "info");
  }
  if (!application.statusIsTerminal && application.nextAction === null) {
    add("missing_next_action", "warning");
  }
  if (application.nextAction === null && application.nextActionDue !== null) {
    add("next_action_due_without_action", "warning");
  }
  if (application.nextAction !== null && application.nextActionDue === null) {
    add("next_action_without_due_date", "info");
  }
  return issues;
}

export class ApplicationMcpService implements McpApplicationTools {
  public constructor(
    private readonly actorProvider: McpActorProvider,
    private readonly applications: McpApplicationsService,
    private readonly referenceValues: McpReferenceValuesReader,
    private readonly accessPolicy: McpAccessPolicy,
    private readonly documents: McpDocumentsService,
    private readonly documentImports: McpDocumentImportManager,
    private readonly emailLinks: EmailLinkExtractionService,
    private readonly jobEmails?: JobEmailReconciliationService,
    private readonly outlookEmailSync?: OutlookEmailSyncService,
    private readonly outlookConnectionReconciliation?: OutlookConnectionReconciliationService,
    private readonly outlookJobDigestProcessing?: OutlookJobDigestProcessingService,
    private readonly clock: () => Date = () => new Date(),
    private readonly jobLinkResolver = new JobLinkResolutionService(emailLinks),
    private readonly jobPostingInspector = new JobPostingInspectionService(),
  ) {}

  public getTrackerContext(): LocalMcpTrackerContext {
    const actor = this.actorProvider.getActor();
    return {
      access: this.accessPolicy.getAccessMode(actor.workspaceId),
      actor: { ...actor.user },
      workspace: {
        name: actor.workspace.name,
        slug: this.actorProvider.getWorkspaceSlug(),
      },
    };
  }

  public getJobSearchSummary(): McpJobSearchSummary {
    const actor = this.actorProvider.getActor();
    const applications = this.applications.listApplications(actor);
    const references = this.referenceValues.listReferenceValues(actor);
    const asOfDate = this.clock().toISOString().slice(0, 10);
    const byStatus = new Map<string, McpStatusCount>();

    for (const reference of references) {
      if (reference.category !== "status") continue;
      byStatus.set(reference.id, {
        count: 0,
        isTerminal: reference.isTerminal,
        status: reference.label,
        statusId: reference.id,
      });
    }
    for (const application of applications) {
      const count = byStatus.get(application.statusId) ?? {
        count: 0,
        isTerminal: application.statusIsTerminal,
        status: application.status,
        statusId: application.statusId,
      };
      count.count += 1;
      byStatus.set(application.statusId, count);
    }

    const open = applications.filter(
      ({ statusIsTerminal }) => !statusIsTerminal,
    );
    const openActions = open.filter(({ nextAction }) => nextAction !== null);
    return {
      asOfDate,
      byStatus: [...byStatus.values()],
      dueTodayActions: openActions.filter(
        ({ nextActionDue }) => nextActionDue === asOfDate,
      ).length,
      openActions: openActions.length,
      openApplications: open.length,
      overdueActions: openActions.filter(
        ({ nextActionDue }) =>
          nextActionDue !== null && nextActionDue < asOfDate,
      ).length,
      terminalApplications: applications.length - open.length,
      totalApplications: applications.length,
    };
  }

  public queryApplicationAttention(
    input: ApplicationAttentionQueryInput,
  ): ApplicationAttentionPage {
    return this.applications.queryApplicationAttention(
      this.actorProvider.getActor(),
      input,
    );
  }

  public listApplications(input: ListMcpApplicationsInput): McpApplicationList {
    const actor = this.actorProvider.getActor();
    const filtered = this.applications
      .listApplications(actor)
      .filter(
        ({ statusId }) =>
          input.statusId === undefined || statusId === input.statusId,
      );
    const limit = Math.max(1, Math.min(input.limit, 100));
    const offset = Math.max(0, input.offset);
    const applications = filtered
      .slice(offset, offset + limit)
      .map(applicationSummary);
    const nextOffset = offset + applications.length;
    return {
      applications,
      nextOffset: nextOffset < filtered.length ? nextOffset : null,
      offset,
      returned: applications.length,
      total: filtered.length,
    };
  }

  public getApplication(applicationId: string): McpApplicationDetail {
    const actor = this.actorProvider.getActor();
    const application = this.applications
      .listApplications(actor)
      .find(({ id }) => id === applicationId);
    if (!application) throw new ApplicationNotFoundError();
    const evidence = this.jobEmails?.getApplicationEvidence(
      actor,
      applicationId,
    ) ?? { emailEvidence: [], jobPostings: [] };
    const eventsPage = this.applications.listApplicationEventsPage(
      actor,
      applicationId,
      { limit: 20, offset: 0 },
    );
    return {
      application,
      emailEvidence: evidence.emailEvidence,
      events: eventsPage.events,
      eventsPage: {
        limit: eventsPage.limit,
        nextOffset: eventsPage.nextOffset,
        offset: eventsPage.offset,
        returned: eventsPage.returned,
        total: eventsPage.total,
      },
      jobPostings: evidence.jobPostings,
      provenance:
        this.applications.listApplicationFieldProvenance?.(
          actor,
          applicationId,
        ) ?? [],
    };
  }

  public listApplicationEvents(input: {
    applicationId: string;
    limit: number;
    offset: number;
  }): ApplicationEventsPage {
    const actor = this.actorProvider.getActor();
    return this.applications.listApplicationEventsPage(
      actor,
      input.applicationId,
      { limit: input.limit, offset: input.offset },
    );
  }

  public listUnlinkedApplications(input: {
    limit: number;
    offset: number;
  }): McpUnlinkedApplicationList {
    const actor = this.actorProvider.getActor();
    const applicationById = new Map(
      this.applications
        .listApplications(actor)
        .map((application) => [application.id, application]),
    );
    const unlinked = this.jobEmailService()
      .listEvidenceCounts(actor)
      .filter(
        ({ emailEvidenceCount, jobPostingCount }) =>
          emailEvidenceCount === 0 && jobPostingCount === 0,
      )
      .flatMap((counts): McpUnlinkedApplication[] => {
        const application = applicationById.get(counts.applicationId);
        return application
          ? [
              {
                application: applicationSummary(application),
                emailEvidenceCount: 0,
                jobPostingCount: 0,
                missingEmailEvidence: true,
                missingJobPostingEvidence: true,
              },
            ]
          : [];
      });
    const limit = Math.max(1, Math.min(input.limit, 100));
    const offset = Math.max(0, input.offset);
    const applications = unlinked.slice(offset, offset + limit);
    const nextOffset = offset + applications.length;
    return {
      applications,
      nextOffset: nextOffset < unlinked.length ? nextOffset : null,
      offset,
      returned: applications.length,
      total: unlinked.length,
    };
  }

  public getApplicationDataQuality(input: {
    limit: number;
    offset: number;
  }): McpApplicationDataQualityReport {
    const actor = this.actorProvider.getActor();
    const applications = this.applications.listApplications(actor);
    const countsByApplication = new Map(
      this.jobEmailService()
        .listEvidenceCounts(actor)
        .map((counts) => [counts.applicationId, counts]),
    );
    const allFindings = applications.flatMap(
      (application): McpApplicationDataQualityFinding[] => {
        const counts = countsByApplication.get(application.id) ?? {
          emailEvidenceCount: 0,
          jobPostingCount: 0,
        };
        const issues = dataQualityIssues(application, counts);
        return issues.length > 0
          ? [{ application: applicationSummary(application), issues }]
          : [];
      },
    );
    const issueCounts = new Map<McpApplicationDataQualityIssueCode, number>();
    for (const { issues } of allFindings) {
      for (const { code } of issues) {
        issueCounts.set(code, (issueCounts.get(code) ?? 0) + 1);
      }
    }
    const limit = Math.max(1, Math.min(input.limit, 100));
    const offset = Math.max(0, input.offset);
    const findings = allFindings.slice(offset, offset + limit);
    const nextOffset = offset + findings.length;
    return {
      applicationsWithFindings: allFindings.length,
      countsByCode: [...issueCounts].map(([code, count]) => ({ code, count })),
      findings,
      nextOffset: nextOffset < allFindings.length ? nextOffset : null,
      offset,
      returned: findings.length,
      totalApplications: applications.length,
      totalIssues: [...issueCounts.values()].reduce(
        (total, count) => total + count,
        0,
      ),
    };
  }

  public auditDuplicateApplications(
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit {
    const actor = this.actorProvider.getActor();
    return this.applications.auditDuplicateApplications(actor, input);
  }

  public findDuplicateApplications(
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit {
    return this.auditDuplicateApplications(input);
  }

  public mergeApplications(
    input: MergeApplicationsInput,
  ): ApplicationMergeResult {
    const actor = this.actorProvider.getActor();
    if (input.mode === "apply") {
      this.accessPolicy.requireWriteAccess(actor);
    }
    return this.applications.mergeApplications(actor, input);
  }

  public matchJobApplicationEmail(
    input: MatchJobApplicationEmailInput,
  ): JobEmailMatchResult {
    const actor = this.actorProvider.getActor();
    return this.jobEmailService().match(actor, input);
  }

  public linkEmailEvidence(
    input: LinkEmailEvidenceInput,
  ): LinkApplicationEvidenceResult {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.jobEmailService().linkEvidence(actor, input);
  }

  public reconcileApplicationFromEvidence(
    input: ReconcileApplicationFromEvidenceInput,
  ): LinkApplicationEvidenceResult | UpsertApplicationFromEmailResult {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return input.mode === "link_existing"
      ? this.jobEmailService().linkEvidence(actor, input)
      : this.jobEmailService().upsert(actor, input.reconciliation);
  }

  public async prepareSyncOutlookEmailEvidence(
    input: SyncOutlookEmailEvidenceInput,
  ): Promise<PreparedMcpWriteOperation<OutlookEmailSyncResult>> {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    const service = this.outlookEmailSyncService();
    const prepared = await service.prepare(actor, input.applicationId);
    return {
      commit: () => {
        const currentActor = this.actorProvider.getActor();
        if (
          currentActor.userId !== actor.userId ||
          currentActor.workspaceId !== actor.workspaceId
        ) {
          throw new LocalMcpActorUnavailableError();
        }
        this.accessPolicy.requireWriteAccess(currentActor);
        return service.commit(currentActor, prepared);
      },
    };
  }

  public async prepareReconcileOutlookGraphConnection(
    input: ReconcileOutlookGraphConnectionInput,
  ): Promise<PreparedMcpWriteOperation<OutlookConnectionReconciliationResult>> {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    const service = this.outlookConnectionReconciliationService();
    const prepared = await service.prepare(actor, input.connection);
    return {
      commit: () => {
        const currentActor = this.actorProvider.getActor();
        if (
          currentActor.userId !== actor.userId ||
          currentActor.workspaceId !== actor.workspaceId
        ) {
          throw new LocalMcpActorUnavailableError();
        }
        this.accessPolicy.requireWriteAccess(currentActor);
        return service.commit(currentActor, prepared);
      },
    };
  }

  public processOutlookJobDigest(
    input: ProcessOutlookJobDigestInput,
  ): Promise<OutlookJobDigestProcessingResult> {
    const actor = this.actorProvider.getActor();
    return this.outlookJobDigestProcessingService().process(actor, input);
  }

  public searchOutlookJobDigests(
    input: SearchOutlookJobDigestsInput,
  ): Promise<OutlookJobDigestSearchResult> {
    const actor = this.actorProvider.getActor();
    return this.outlookJobDigestProcessingService().search(actor, input);
  }

  public extractJobLinks(
    input: EmailLinkExtractionInput,
  ): McpEmailLinkCandidates {
    this.actorProvider.getActor();
    return { candidates: this.emailLinks.extract(input) };
  }

  public resolveJobLinks(
    input: EmailLinkExtractionInput,
  ): Promise<JobLinkResolutionResult> {
    this.actorProvider.getActor();
    return this.jobLinkResolver.resolve(input);
  }

  public inspectJobPosting(
    input: JobPostingInspectionInput,
  ): Promise<JobPostingInspectionResult> {
    this.actorProvider.getActor();
    return this.jobPostingInspector.inspect(input);
  }

  public getReferenceData(): McpReferenceData {
    const actor = this.actorProvider.getActor();
    return { values: this.referenceValues.listReferenceValues(actor) };
  }

  public getDocumentImportCapabilities(): {
    maxDocumentBytes: number;
    maxDocumentChunkBytes: number;
  } {
    this.actorProvider.getActor();
    return {
      maxDocumentBytes: this.documentImports.maximumUploadBytes,
      maxDocumentChunkBytes: this.documentImports.maxChunkBytes,
    };
  }

  public listDocuments(input: {
    limit: number;
    offset: number;
  }): McpDocumentList {
    const actor = this.actorProvider.getActor();
    const allDocuments = this.documents.listDocuments(actor);
    const limit = Math.max(1, Math.min(input.limit, 100));
    const offset = Math.max(0, input.offset);
    const documents = allDocuments.slice(offset, offset + limit);
    const nextOffset = offset + documents.length;
    return {
      documents,
      nextOffset: nextOffset < allDocuments.length ? nextOffset : null,
      offset,
      returned: documents.length,
      total: allDocuments.length,
    };
  }

  public exportDocumentChunk(input: {
    documentId: string;
    offset: number;
  }): McpDocumentChunk {
    const actor = this.actorProvider.getActor();
    const offset = Math.max(0, input.offset);
    const result = this.documents.getDocumentChunk(
      actor,
      input.documentId,
      offset,
      this.documentImports.maxChunkBytes,
    );
    const chunk = Buffer.from(result.bytes);
    if (offset >= result.document.byteSize || chunk.byteLength === 0) {
      throw new InvalidMcpDocumentExportError();
    }
    const nextOffset = offset + chunk.byteLength;
    return {
      byteSize: result.document.byteSize,
      chunkByteSize: chunk.byteLength,
      chunkSha256: createHash("sha256").update(chunk).digest("hex"),
      complete: nextOffset >= result.document.byteSize,
      contentBase64: chunk.toString("base64"),
      document: result.document,
      nextOffset: nextOffset < result.document.byteSize ? nextOffset : null,
      offset,
      sha256: result.sha256,
    };
  }

  public beginDocumentImport(
    input: BeginMcpDocumentImportInput,
  ): McpDocumentImportProgress {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.documentImports.begin(actor, input);
  }

  public appendDocumentChunk(input: {
    chunkSha256: string;
    contentBase64: string;
    offset: number;
    uploadId: string;
  }): McpDocumentImportProgress {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.documentImports.append(actor, input);
  }

  public completeDocumentImport(uploadId: string): DocumentRecord {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.documents.importDocument(
      actor,
      this.documentImports.prepareCompletion(actor, uploadId),
    );
  }

  public cancelDocumentImport(uploadId: string): { cancelled: true } {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.documentImports.cancel(actor, uploadId);
  }

  public createApplication(input: CreateApplicationInput): ApplicationRecord {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.createApplication(actor, input);
  }

  public bulkUpdateApplications(
    updates: McpBulkApplicationUpdate[],
  ): McpBulkApplicationUpdateResult {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    const applications = updates.map(({ applicationId, update }) => {
      const application = this.applications.updateApplication(
        actor,
        applicationId,
        update,
      );
      return { id: application.id, updatedAt: application.updatedAt };
    });
    return { applications, updated: applications.length };
  }

  public addApplicationEvent(
    input: AddApplicationEventInput,
  ): AddApplicationEventResult {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.addApplicationEvent(actor, input);
  }

  public addApplicationActivity(
    input: AddApplicationActivityInput,
  ): ApplicationActivityEvent {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.addApplicationActivity(actor, input);
  }

  public recordApplicationFieldProvenance(
    input: RecordApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.recordApplicationFieldProvenance(actor, input);
  }

  public verifyApplicationFieldProvenance(
    input: VerifyApplicationFieldProvenanceInput,
  ): ApplicationFieldProvenanceRecord {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.verifyApplicationFieldProvenance(actor, input);
  }

  public updateApplication(
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.updateApplication(actor, applicationId, input);
  }

  public deleteApplication(applicationId: string): {
    applicationId: string;
    deleted: true;
  } {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    this.applications.deleteApplication(actor, applicationId);
    return { applicationId, deleted: true };
  }

  public upsertApplicationFromEmail(
    input: UpsertApplicationFromEmailInput,
  ): UpsertApplicationFromEmailResult {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.jobEmailService().upsert(actor, input);
  }

  private jobEmailService(): JobEmailReconciliationService {
    if (!this.jobEmails) throw new JobEmailReconciliationUnavailableError();
    return this.jobEmails;
  }

  private outlookEmailSyncService(): OutlookEmailSyncService {
    if (!this.outlookEmailSync) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_email_sync_unavailable",
      );
    }
    return this.outlookEmailSync;
  }

  private outlookConnectionReconciliationService(): OutlookConnectionReconciliationService {
    if (!this.outlookConnectionReconciliation) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_email_sync_unavailable",
      );
    }
    return this.outlookConnectionReconciliation;
  }

  private outlookJobDigestProcessingService(): OutlookJobDigestProcessingService {
    if (!this.outlookJobDigestProcessing) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_email_sync_unavailable",
      );
    }
    return this.outlookJobDigestProcessing;
  }
}
