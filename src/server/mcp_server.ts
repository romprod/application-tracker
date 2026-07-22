import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  ApplicationConflictError,
  ApplicationNotFoundError,
  InvalidApplicationReferenceError,
} from "../application/applications.js";
import {
  InvalidJobPostingEvidenceError,
  JobEmailEvidenceConflictError,
  JobEmailMatchAmbiguousError,
} from "../application/job_email_reconciliation.js";
import {
  InvalidMcpDocumentExportError,
  LocalMcpActorUnavailableError,
  type McpApplicationTools,
} from "../application/mcp.js";
import { McpWriteAccessDisabledError } from "../application/mcp_access.js";
import {
  DocumentContentConflictError,
  DocumentNotFoundError,
  DocumentStorageQuotaExceededError,
  InvalidDocumentContentError,
  InvalidDocumentReferenceError,
} from "../application/documents.js";
import {
  InvalidMcpDocumentImportError,
  McpDocumentImportCapacityError,
  McpDocumentImportConflictError,
  McpDocumentImportIncompleteError,
  McpDocumentImportNotFoundError,
  MCP_DOCUMENT_CHUNK_BYTES,
} from "../application/mcp_document_imports.js";
import type {
  McpAuditAction,
  McpAuditRecorder,
  McpAuditResult,
  McpAuditTargetType,
  McpAuditTransport,
} from "../application/mcp_audit.js";
import {
  applicationIdSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from "../domain/applications.js";
import { documentUploadMetadataSchema } from "../domain/documents.js";
import { emailLinkExtractionInputSchema } from "../domain/email_links.js";
import { referenceValueIdSchema } from "../domain/reference_values.js";
import {
  matchJobApplicationEmailSchema,
  upsertApplicationFromEmailSchema,
} from "../domain/job_email_reconciliation.js";
import { jobBoardProviderSchema } from "../domain/job_board.js";
import { noOpLogger, type ApplicationLogger } from "./logging.js";

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;
const writeAnnotations = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
  readOnlyHint: false,
} as const;
const idempotentWriteAnnotations = {
  ...writeAnnotations,
  idempotentHint: true,
} as const;
const deleteAnnotations = {
  ...writeAnnotations,
  destructiveHint: true,
} as const;

const emptyInputSchema = z.strictObject({});
const actorSchema = z.strictObject({
  displayName: z.string(),
  role: z.enum(["admin", "member"]),
  username: z.string(),
});
const trackerContextSchema = z.strictObject({
  access: z.enum(["read_only", "read_write"]),
  actor: actorSchema,
  workspace: z.strictObject({ name: z.string(), slug: z.string() }),
});
const statusCountSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  isTerminal: z.boolean(),
  status: z.string(),
  statusId: z.string(),
});
const jobSearchSummarySchema = z.strictObject({
  asOfDate: z.iso.date(),
  byStatus: z.array(statusCountSchema),
  dueTodayActions: z.number().int().nonnegative(),
  openActions: z.number().int().nonnegative(),
  openApplications: z.number().int().nonnegative(),
  overdueActions: z.number().int().nonnegative(),
  terminalApplications: z.number().int().nonnegative(),
  totalApplications: z.number().int().nonnegative(),
});
const applicationSummarySchema = z.strictObject({
  appliedOn: z.iso.date().nullable(),
  companyName: z.string(),
  id: applicationIdSchema,
  location: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionDue: z.iso.date().nullable(),
  roleTitle: z.string(),
  status: z.string(),
  statusId: referenceValueIdSchema,
  statusIsTerminal: z.boolean(),
  updatedAt: z.iso.datetime(),
});
const applicationListSchema = z.strictObject({
  applications: z.array(applicationSummarySchema),
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const applicationContactSchema = z.strictObject({
  email: z.string().nullable(),
  name: z.string(),
  phone: z.string().nullable(),
  role: z.string().nullable(),
});
const applicationLinkSchema = z.strictObject({
  label: z.string(),
  url: z.url(),
});
const applicationRecordSchema = z.strictObject({
  appliedOn: z.iso.date().nullable(),
  companyName: z.string(),
  contacts: z.array(applicationContactSchema),
  createdAt: z.iso.datetime(),
  id: applicationIdSchema,
  location: z.string().nullable(),
  links: z.array(applicationLinkSchema),
  nextAction: z.string().nullable(),
  nextActionDue: z.iso.date().nullable(),
  notes: z.string().nullable(),
  roleTitle: z.string(),
  roleType: z.string().nullable(),
  roleTypeId: referenceValueIdSchema.nullable(),
  source: z.string().nullable(),
  sourceId: referenceValueIdSchema.nullable(),
  sourceUrl: z.url().nullable(),
  status: z.string(),
  statusId: referenceValueIdSchema,
  statusIsTerminal: z.boolean(),
  updatedAt: z.iso.datetime(),
});
const applicationEventSchema = z.strictObject({
  actorDisplayName: z.string(),
  fromStatus: z.string().nullable(),
  id: z.string(),
  occurredAt: z.iso.datetime(),
  toStatus: z.string(),
  type: z.enum(["application_created", "status_changed"]),
});
const applicationJobPostingSchema = z.strictObject({
  applicationId: applicationIdSchema,
  canonicalUrl: z.url().nullable(),
  createdAt: z.iso.datetime(),
  externalPostingId: z.string().nullable(),
  id: z.uuid(),
  provider: jobBoardProviderSchema,
  updatedAt: z.iso.datetime(),
});
const applicationEmailEvidenceSchema = z.strictObject({
  applicationId: applicationIdSchema,
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  messageId: z.string(),
  receivedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  webUrl: z.url().nullable(),
});
const applicationDetailSchema = z.strictObject({
  application: applicationRecordSchema,
  emailEvidence: z.array(applicationEmailEvidenceSchema),
  events: z.array(applicationEventSchema),
  jobPostings: z.array(applicationJobPostingSchema),
});
const jobEmailMatchCandidateSchema = z.strictObject({
  companyName: z.string(),
  id: applicationIdSchema,
  roleTitle: z.string(),
  status: z.string(),
  statusId: referenceValueIdSchema,
  updatedAt: z.iso.datetime(),
});
const jobEmailMatchResultSchema = z.strictObject({
  level: z
    .enum(["posting_id", "canonical_url", "email_message_id", "company_title"])
    .nullable(),
  matches: z.array(jobEmailMatchCandidateSchema),
  outcome: z.enum(["matched", "none", "ambiguous", "conflict"]),
});
const emailLinkCandidateSchema = z.strictObject({
  externalPostingId: z.string().nullable(),
  host: z.string(),
  provider: jobBoardProviderSchema,
  url: z.url(),
});
const emailLinkCandidatesSchema = z.strictObject({
  candidates: z.array(emailLinkCandidateSchema).max(20),
});
const upsertApplicationFromEmailResultSchema = z.strictObject({
  action: z.enum(["created", "matched", "updated"]),
  application: applicationRecordSchema,
  emailEvidence: z.array(applicationEmailEvidenceSchema),
  emailEvidenceLinked: z.boolean(),
  jobPostings: z.array(applicationJobPostingSchema),
  matchLevel: z
    .enum(["posting_id", "canonical_url", "email_message_id", "company_title"])
    .nullable(),
  postingLinked: z.boolean(),
});
const referenceValueSchema = z.strictObject({
  category: z.enum(["status", "source", "role_type", "document_type"]),
  createdAt: z.iso.datetime(),
  id: referenceValueIdSchema,
  isActive: z.boolean(),
  isTerminal: z.boolean(),
  label: z.string(),
  sortOrder: z.number().int(),
  updatedAt: z.iso.datetime(),
});
const referenceDataSchema = z.strictObject({
  values: z.array(referenceValueSchema),
});
const documentAssociationSchema = z.strictObject({
  companyName: z.string(),
  id: applicationIdSchema,
  roleTitle: z.string(),
});
const documentRecordSchema = z.strictObject({
  applications: z.array(documentAssociationSchema),
  byteSize: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  documentType: z.string(),
  documentTypeId: referenceValueIdSchema,
  id: z.uuid(),
  mediaType: z.string(),
  originalFilename: z.string(),
  uploadedByDisplayName: z.string(),
});
const documentImportCapabilitiesSchema = z.strictObject({
  maxDocumentBytes: z.number().int().positive(),
  maxDocumentChunkBytes: z
    .number()
    .int()
    .positive()
    .max(MCP_DOCUMENT_CHUNK_BYTES),
});
const documentListSchema = z.strictObject({
  documents: z.array(documentRecordSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const uploadIdSchema = z.uuid();
const documentImportProgressSchema = z.strictObject({
  byteSize: z.number().int().positive(),
  complete: z.boolean(),
  maxChunkBytes: z.number().int().positive().max(MCP_DOCUMENT_CHUNK_BYTES),
  nextOffset: z.number().int().nonnegative(),
  receivedBytes: z.number().int().nonnegative(),
  idempotencyKey: z.string(),
  uploadId: uploadIdSchema,
});
const beginDocumentImportSchema = documentUploadMetadataSchema.extend({
  byteSize: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(160),
  sha256: sha256Schema,
});
const appendDocumentChunkSchema = z.strictObject({
  chunkSha256: sha256Schema,
  contentBase64: z
    .string()
    .min(4)
    .max(Math.ceil(MCP_DOCUMENT_CHUNK_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  offset: z.number().int().nonnegative(),
  uploadId: uploadIdSchema,
});
const documentImportUploadSchema = z.strictObject({ uploadId: uploadIdSchema });
const cancelDocumentImportSchema = z.strictObject({
  cancelled: z.literal(true),
});
const documentChunkSchema = z.strictObject({
  byteSize: z.number().int().positive(),
  chunkByteSize: z.number().int().positive(),
  chunkSha256: sha256Schema,
  complete: z.boolean(),
  contentBase64: z.string(),
  document: documentRecordSchema,
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  sha256: sha256Schema,
});
const deleteApplicationResultSchema = z.strictObject({
  applicationId: applicationIdSchema,
  deleted: z.literal(true),
});

function successfulToolResult(value: object): CallToolResult {
  return {
    content: [{ text: JSON.stringify(value), type: "text" }],
    structuredContent: value as Record<string, unknown>,
  };
}

function failedToolResult(code: string): CallToolResult {
  return {
    content: [{ text: JSON.stringify({ error: { code } }), type: "text" }],
    isError: true,
  };
}

interface McpServerAuditOptions {
  actorUserId: string;
  recorder: McpAuditRecorder;
  runAtomically: <Result>(operation: () => Result) => Result;
  transport: McpAuditTransport;
  workspaceId: string;
}

interface ApplicationMcpServerOptions {
  audit?: McpServerAuditOptions;
  instructions: string;
  logger?: ApplicationLogger;
}

interface LocalMcpServerOptions {
  audit?: Omit<McpServerAuditOptions, "transport">;
  logger?: ApplicationLogger;
}

class McpWriteAuditFailedError extends Error {}

function recordAuditEvent(
  audit: McpServerAuditOptions | undefined,
  logger: ApplicationLogger,
  tool: McpAuditAction,
  targetType: McpAuditTargetType,
  result: McpAuditResult,
): boolean {
  if (!audit) return true;
  try {
    audit.recorder.record({
      action: tool,
      actorUserId: audit.actorUserId,
      result,
      targetType,
      transport: audit.transport,
      workspaceId: audit.workspaceId,
    });
    return true;
  } catch (error) {
    logger.error("mcp_audit_failed", { error, tool });
    return false;
  }
}

function executeTool(
  tool: McpAuditAction,
  targetType: McpAuditTargetType,
  logger: ApplicationLogger,
  audit: McpServerAuditOptions | undefined,
  operation: () => object,
): CallToolResult {
  try {
    const value = operation();
    return recordAuditEvent(audit, logger, tool, targetType, "success")
      ? successfulToolResult(value)
      : failedToolResult("internal_error");
  } catch (error) {
    if (error instanceof LocalMcpActorUnavailableError) {
      return recordAuditEvent(audit, logger, tool, targetType, "denied")
        ? failedToolResult("actor_unavailable")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationNotFoundError) {
      return recordAuditEvent(audit, logger, tool, targetType, "not_found")
        ? failedToolResult("application_not_found")
        : failedToolResult("internal_error");
    }
    if (error instanceof DocumentNotFoundError) {
      return recordAuditEvent(audit, logger, tool, targetType, "not_found")
        ? failedToolResult("document_not_found")
        : failedToolResult("internal_error");
    }
    if (error instanceof InvalidMcpDocumentExportError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("invalid_document_export_offset")
        : failedToolResult("internal_error");
    }
    if (error instanceof InvalidJobPostingEvidenceError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("invalid_job_posting_evidence")
        : failedToolResult("internal_error");
    }
    logger.error("mcp_tool_failed", { error, tool });
    recordAuditEvent(audit, logger, tool, targetType, "error");
    return failedToolResult("internal_error");
  }
}

function executeWriteTool(
  tool: McpAuditAction,
  targetType: McpAuditTargetType,
  logger: ApplicationLogger,
  audit: McpServerAuditOptions | undefined,
  operation: () => object,
): CallToolResult {
  if (!audit) {
    logger.error("mcp_write_audit_unavailable", { tool });
    return failedToolResult("internal_error");
  }
  try {
    const value = audit.runAtomically(() => {
      const result = operation();
      if (!recordAuditEvent(audit, logger, tool, targetType, "success")) {
        throw new McpWriteAuditFailedError();
      }
      return result;
    });
    return successfulToolResult(value);
  } catch (error) {
    if (error instanceof McpWriteAuditFailedError) {
      return failedToolResult("internal_error");
    }
    if (
      error instanceof LocalMcpActorUnavailableError ||
      error instanceof McpWriteAccessDisabledError
    ) {
      return recordAuditEvent(audit, logger, tool, targetType, "denied")
        ? failedToolResult(
            error instanceof McpWriteAccessDisabledError
              ? "write_access_disabled"
              : "actor_unavailable",
          )
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationNotFoundError) {
      return recordAuditEvent(audit, logger, tool, targetType, "not_found")
        ? failedToolResult("application_not_found")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationConflictError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("application_conflict")
        : failedToolResult("internal_error");
    }
    if (error instanceof InvalidApplicationReferenceError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("invalid_application_reference")
        : failedToolResult("internal_error");
    }
    const jobEmailErrorCode =
      error instanceof JobEmailMatchAmbiguousError
        ? "job_email_ambiguous"
        : error instanceof JobEmailEvidenceConflictError
          ? "job_email_conflict"
          : error instanceof InvalidJobPostingEvidenceError
            ? "invalid_job_posting_evidence"
            : undefined;
    if (jobEmailErrorCode) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult(jobEmailErrorCode)
        : failedToolResult("internal_error");
    }
    if (error instanceof McpDocumentImportNotFoundError) {
      return recordAuditEvent(audit, logger, tool, targetType, "not_found")
        ? failedToolResult("document_import_not_found")
        : failedToolResult("internal_error");
    }
    const documentErrorCode =
      error instanceof InvalidMcpDocumentImportError ||
      error instanceof InvalidDocumentContentError
        ? "invalid_document_import"
        : error instanceof McpDocumentImportConflictError ||
            error instanceof DocumentContentConflictError
          ? "document_import_conflict"
          : error instanceof McpDocumentImportIncompleteError
            ? "document_import_incomplete"
            : error instanceof McpDocumentImportCapacityError
              ? "document_import_capacity"
              : error instanceof InvalidDocumentReferenceError
                ? "invalid_document_reference"
                : error instanceof DocumentStorageQuotaExceededError
                  ? "document_storage_quota_exceeded"
                  : undefined;
    if (documentErrorCode) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult(documentErrorCode)
        : failedToolResult("internal_error");
    }
    logger.error("mcp_tool_failed", { error, tool });
    recordAuditEvent(audit, logger, tool, targetType, "error");
    return failedToolResult("internal_error");
  }
}

export function createApplicationMcpServer(
  tools: McpApplicationTools,
  options: ApplicationMcpServerOptions,
): McpServer {
  const logger = options.logger ?? noOpLogger;
  const server = new McpServer(
    { name: "application-tracker", version: "0.1.0" },
    {
      instructions: options.instructions,
    },
  );

  server.registerTool(
    "get_tracker_context",
    {
      annotations: readOnlyAnnotations,
      description:
        "Confirm the actor, workspace, role, and current read-only or read-write access bound to this session.",
      inputSchema: emptyInputSchema,
      outputSchema: trackerContextSchema,
      title: "Get tracker context",
    },
    () =>
      executeTool(
        "get_tracker_context",
        "workspace",
        logger,
        options.audit,
        () => tools.getTrackerContext(),
      ),
  );

  server.registerTool(
    "get_job_search_summary",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return bounded workspace totals, status counts, and due-action counts.",
      inputSchema: emptyInputSchema,
      outputSchema: jobSearchSummarySchema,
      title: "Get job search summary",
    },
    () =>
      executeTool(
        "get_job_search_summary",
        "job_search",
        logger,
        options.audit,
        () => tools.getJobSearchSummary(),
      ),
  );

  server.registerTool(
    "list_applications",
    {
      annotations: readOnlyAnnotations,
      description:
        "List up to 100 application summaries, optionally filtered by status ID.",
      inputSchema: z.strictObject({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().nonnegative().default(0),
        statusId: referenceValueIdSchema.optional(),
      }),
      outputSchema: applicationListSchema,
      title: "List applications",
    },
    (input) =>
      executeTool(
        "list_applications",
        "application_collection",
        logger,
        options.audit,
        () =>
          tools.listApplications({
            limit: input.limit,
            offset: input.offset,
            ...(input.statusId ? { statusId: input.statusId } : {}),
          }),
      ),
  );

  server.registerTool(
    "get_application",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return one application with contacts, links, notes, and immutable stage events.",
      inputSchema: z.strictObject({ applicationId: applicationIdSchema }),
      outputSchema: applicationDetailSchema,
      title: "Get application",
    },
    ({ applicationId }) =>
      executeTool("get_application", "application", logger, options.audit, () =>
        tools.getApplication(applicationId),
      ),
  );

  server.registerTool(
    "match_job_application_email",
    {
      annotations: readOnlyAnnotations,
      description:
        "Deterministically match job-email evidence by provider posting ID, canonical posting URL, email Message-ID, then exact normalized company and role title. Returns ambiguity or conflict instead of guessing.",
      inputSchema: matchJobApplicationEmailSchema,
      outputSchema: jobEmailMatchResultSchema,
      title: "Match job application email",
    },
    (input) =>
      executeTool(
        "match_job_application_email",
        "job_email",
        logger,
        options.audit,
        () => tools.matchJobApplicationEmail(input),
      ),
  );

  server.registerTool(
    "extract_job_links",
    {
      annotations: readOnlyAnnotations,
      description:
        "Extract up to 20 deterministic job-link candidates from bounded email text or HTML without making network requests. Pass trustworthy candidates to match_job_application_email.",
      inputSchema: emailLinkExtractionInputSchema,
      outputSchema: emailLinkCandidatesSchema,
      title: "Extract job links",
    },
    (input) =>
      executeTool("extract_job_links", "job_email", logger, options.audit, () =>
        tools.extractJobLinks(input),
      ),
  );

  server.registerTool(
    "get_reference_data",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return workspace statuses, sources, role types, and document types with stable IDs.",
      inputSchema: emptyInputSchema,
      outputSchema: referenceDataSchema,
      title: "Get reference data",
    },
    () =>
      executeTool(
        "get_reference_data",
        "reference_data",
        logger,
        options.audit,
        () => tools.getReferenceData(),
      ),
  );

  server.registerTool(
    "get_document_import_capabilities",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return the bounded document size and chunk limits accepted by this workspace.",
      inputSchema: emptyInputSchema,
      outputSchema: documentImportCapabilitiesSchema,
      title: "Get document import capabilities",
    },
    () =>
      executeTool(
        "get_document_import_capabilities",
        "document_transfer",
        logger,
        options.audit,
        () => tools.getDocumentImportCapabilities(),
      ),
  );

  server.registerTool(
    "list_documents",
    {
      annotations: readOnlyAnnotations,
      description:
        "List a bounded page of document metadata and application associations in the bound workspace.",
      inputSchema: z.strictObject({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().nonnegative().default(0),
      }),
      outputSchema: documentListSchema,
      title: "List documents",
    },
    (input) =>
      executeTool(
        "list_documents",
        "document_collection",
        logger,
        options.audit,
        () => tools.listDocuments(input),
      ),
  );

  server.registerTool(
    "export_document_chunk",
    {
      annotations: readOnlyAnnotations,
      description:
        "Read one bounded base64 chunk of a stored original with whole-file and chunk SHA-256 digests. Follow nextOffset until complete.",
      inputSchema: z.strictObject({
        documentId: z.uuid(),
        offset: z.number().int().nonnegative().default(0),
      }),
      outputSchema: documentChunkSchema,
      title: "Export document chunk",
    },
    (input) =>
      executeTool(
        "export_document_chunk",
        "document",
        logger,
        options.audit,
        () => tools.exportDocumentChunk(input),
      ),
  );

  server.registerTool(
    "create_application",
    {
      annotations: writeAnnotations,
      description:
        "Create an application in the bound workspace when this connection has read-and-write access. Call get_reference_data first and use stable reference IDs.",
      inputSchema: createApplicationSchema,
      outputSchema: applicationRecordSchema,
      title: "Create application",
    },
    (input) =>
      executeWriteTool(
        "create_application",
        "application",
        logger,
        options.audit,
        () => tools.createApplication(input),
      ),
  );

  server.registerTool(
    "update_application",
    {
      annotations: writeAnnotations,
      description:
        "Update selected application fields in the bound workspace when this connection has read-and-write access. First read the application and pass its updatedAt value as update.expectedUpdatedAt. Omitted fields remain unchanged; null clears nullable fields. A stale value returns application_conflict; read the latest application before retrying.",
      inputSchema: z.strictObject({
        applicationId: applicationIdSchema,
        update: updateApplicationSchema,
      }),
      outputSchema: applicationRecordSchema,
      title: "Update application",
    },
    ({ applicationId, update }) =>
      executeWriteTool(
        "update_application",
        "application",
        logger,
        options.audit,
        () => tools.updateApplication(applicationId, update),
      ),
  );

  server.registerTool(
    "delete_application",
    {
      annotations: deleteAnnotations,
      description:
        "Soft-delete an application from the bound workspace when this connection has read-and-write access. Pass confirm=true only after the user has explicitly approved this destructive action.",
      inputSchema: z.strictObject({
        applicationId: applicationIdSchema,
        confirm: z.literal(true),
      }),
      outputSchema: deleteApplicationResultSchema,
      title: "Delete application",
    },
    ({ applicationId }) =>
      executeWriteTool(
        "delete_application",
        "application",
        logger,
        options.audit,
        () => tools.deleteApplication(applicationId),
      ),
  );

  server.registerTool(
    "upsert_application_from_email",
    {
      annotations: idempotentWriteAnnotations,
      description:
        "Idempotently match or create an application, apply an optional selected-field update, and persist workspace-unique posting and email evidence. Reusing the same email Message-ID cannot create a duplicate application.",
      inputSchema: upsertApplicationFromEmailSchema,
      outputSchema: upsertApplicationFromEmailResultSchema,
      title: "Upsert application from email",
    },
    (input) =>
      executeWriteTool(
        "upsert_application_from_email",
        "job_email",
        logger,
        options.audit,
        () => tools.upsertApplicationFromEmail(input),
      ),
  );

  server.registerTool(
    "begin_document_import",
    {
      annotations: idempotentWriteAnnotations,
      description:
        "Begin or resume a bounded document import after write access is enabled. Reusing the same caller-chosen idempotency key and metadata returns the existing transfer.",
      inputSchema: beginDocumentImportSchema,
      outputSchema: documentImportProgressSchema,
      title: "Begin document import",
    },
    (input) =>
      executeWriteTool(
        "begin_document_import",
        "document_transfer",
        logger,
        options.audit,
        () => tools.beginDocumentImport(input),
      ),
  );

  server.registerTool(
    "append_document_chunk",
    {
      annotations: idempotentWriteAnnotations,
      description:
        "Append one canonical base64 chunk at the expected offset. An exact retry of an accepted chunk is safe.",
      inputSchema: appendDocumentChunkSchema,
      outputSchema: documentImportProgressSchema,
      title: "Append document chunk",
    },
    (input) =>
      executeWriteTool(
        "append_document_chunk",
        "document_transfer",
        logger,
        options.audit,
        () => tools.appendDocumentChunk(input),
      ),
  );

  server.registerTool(
    "complete_document_import",
    {
      annotations: idempotentWriteAnnotations,
      description:
        "Verify the complete document digest, enforce normal document quotas and references, and idempotently store and associate the original file.",
      inputSchema: documentImportUploadSchema,
      outputSchema: documentRecordSchema,
      title: "Complete document import",
    },
    ({ uploadId }) =>
      executeWriteTool(
        "complete_document_import",
        "document",
        logger,
        options.audit,
        () => tools.completeDocumentImport(uploadId),
      ),
  );

  server.registerTool(
    "cancel_document_import",
    {
      annotations: idempotentWriteAnnotations,
      description:
        "Discard transient chunks after cancellation or successful completion without deleting any stored document.",
      inputSchema: documentImportUploadSchema,
      outputSchema: cancelDocumentImportSchema,
      title: "Cancel document import",
    },
    ({ uploadId }) =>
      executeWriteTool(
        "cancel_document_import",
        "document_transfer",
        logger,
        options.audit,
        () => tools.cancelDocumentImport(uploadId),
      ),
  );

  return server;
}

export function createLocalMcpServer(
  tools: McpApplicationTools,
  options: LocalMcpServerOptions = {},
): McpServer {
  return createApplicationMcpServer(tools, {
    ...(options.audit
      ? { audit: { ...options.audit, transport: "local_stdio" } }
      : {}),
    instructions:
      "This local server is bound to one operator-selected actor, workspace, and connection permission. Call get_tracker_context before using workspace data. Mutation tools work only when MCP_LOCAL_ACCESS_MODE is read_write, and delete_application also requires explicit confirmation.",
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
