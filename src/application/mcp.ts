import { createHash } from "node:crypto";

import {
  ApplicationNotFoundError,
  type ApplicationEvent,
  type ApplicationRecord,
} from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import type {
  DocumentContentChunk,
  DocumentRecord,
  ImportDocumentInput,
} from "./documents.js";
import {
  type BeginMcpDocumentImportInput,
  type McpDocumentImportManager,
  type McpDocumentImportProgress,
} from "./mcp_document_imports.js";
import type {
  CreateApplicationInput,
  UpdateApplicationInput,
} from "../domain/applications.js";
import type { McpAccessMode } from "./mcp_access.js";
import type { ReferenceValue } from "./reference_values.js";
import {
  JobEmailReconciliationUnavailableError,
  type ApplicationEmailEvidence,
  type ApplicationJobPosting,
  type JobEmailMatchResult,
  type JobEmailReconciliationService,
  type UpsertApplicationFromEmailResult,
} from "./job_email_reconciliation.js";
import type {
  MatchJobApplicationEmailInput,
  UpsertApplicationFromEmailInput,
} from "../domain/job_email_reconciliation.js";

export const applicationMcpToolNames = [
  "get_tracker_context",
  "get_job_search_summary",
  "list_applications",
  "get_application",
  "match_job_application_email",
  "get_reference_data",
  "get_document_import_capabilities",
  "list_documents",
  "export_document_chunk",
  "create_application",
  "update_application",
  "delete_application",
  "upsert_application_from_email",
  "begin_document_import",
  "append_document_chunk",
  "complete_document_import",
  "cancel_document_import",
] as const;

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
  listApplications(actor: AuthenticatedActor): ApplicationRecord[];
}

export interface McpApplicationsService extends McpApplicationsReader {
  createApplication(
    actor: AuthenticatedActor,
    input: CreateApplicationInput,
  ): ApplicationRecord;
  deleteApplication(actor: AuthenticatedActor, applicationId: string): void;
  updateApplication(
    actor: AuthenticatedActor,
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord;
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
  appliedOn: string | null;
  companyName: string;
  id: string;
  location: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  roleTitle: string;
  status: string;
  statusId: string;
  statusIsTerminal: boolean;
  updatedAt: string;
}

export interface McpApplicationList {
  applications: McpApplicationSummary[];
  nextOffset: number | null;
  offset: number;
  returned: number;
  total: number;
}

export interface McpApplicationDetail {
  application: ApplicationRecord;
  emailEvidence: ApplicationEmailEvidence[];
  events: ApplicationEvent[];
  jobPostings: ApplicationJobPosting[];
}

export interface McpReferenceData {
  values: ReferenceValue[];
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
  appendDocumentChunk(input: {
    chunkSha256: string;
    contentBase64: string;
    offset: number;
    uploadId: string;
  }): McpDocumentImportProgress;
  beginDocumentImport(
    input: BeginMcpDocumentImportInput,
  ): McpDocumentImportProgress;
  cancelDocumentImport(uploadId: string): { cancelled: true };
  completeDocumentImport(uploadId: string): DocumentRecord;
  createApplication(input: CreateApplicationInput): ApplicationRecord;
  deleteApplication(applicationId: string): {
    applicationId: string;
    deleted: true;
  };
  exportDocumentChunk(input: {
    documentId: string;
    offset: number;
  }): McpDocumentChunk;
  getApplication(applicationId: string): McpApplicationDetail;
  getDocumentImportCapabilities(): {
    maxDocumentBytes: number;
    maxDocumentChunkBytes: number;
  };
  getJobSearchSummary(): McpJobSearchSummary;
  getReferenceData(): McpReferenceData;
  getTrackerContext(): LocalMcpTrackerContext;
  listApplications(input: ListMcpApplicationsInput): McpApplicationList;
  listDocuments(input: { limit: number; offset: number }): McpDocumentList;
  matchJobApplicationEmail(
    input: MatchJobApplicationEmailInput,
  ): JobEmailMatchResult;
  updateApplication(
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord;
  upsertApplicationFromEmail(
    input: UpsertApplicationFromEmailInput,
  ): UpsertApplicationFromEmailResult;
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
    appliedOn: application.appliedOn,
    companyName: application.companyName,
    id: application.id,
    location: application.location,
    nextAction: application.nextAction,
    nextActionDue: application.nextActionDue,
    roleTitle: application.roleTitle,
    status: application.status,
    statusId: application.statusId,
    statusIsTerminal: application.statusIsTerminal,
    updatedAt: application.updatedAt,
  };
}

export class ApplicationMcpService implements McpApplicationTools {
  public constructor(
    private readonly actorProvider: McpActorProvider,
    private readonly applications: McpApplicationsService,
    private readonly referenceValues: McpReferenceValuesReader,
    private readonly accessPolicy: McpAccessPolicy,
    private readonly documents: McpDocumentsService,
    private readonly documentImports: McpDocumentImportManager,
    private readonly jobEmails?: JobEmailReconciliationService,
    private readonly clock: () => Date = () => new Date(),
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
    return {
      application,
      emailEvidence: evidence.emailEvidence,
      events: this.applications.listApplicationEvents(actor, applicationId),
      jobPostings: evidence.jobPostings,
    };
  }

  public matchJobApplicationEmail(
    input: MatchJobApplicationEmailInput,
  ): JobEmailMatchResult {
    const actor = this.actorProvider.getActor();
    return this.jobEmailService().match(actor, input);
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
}
