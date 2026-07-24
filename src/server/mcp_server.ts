import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  ApplicationConflictError,
  ApplicationMergeNotFoundError,
  ApplicationMergeStateError,
  ApplicationMergeUnsafeError,
  ApplicationMergeVersionConflictError,
  ApplicationNotFoundError,
  ApplicationStatusEventConflictError,
  ApplicationStatusRegressionError,
  ApplicationStatusStaleError,
  InvalidApplicationReferenceError,
} from "../application/applications.js";
import {
  InvalidJobPostingEvidenceError,
  JobEmailEvidenceConflictError,
  JobEmailMatchAmbiguousError,
} from "../application/job_email_reconciliation.js";
import {
  getApplicationMcpSchemaStatus,
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
  applicationMergeFieldSchema,
  auditDuplicateApplicationsSchema,
  createApplicationSchema,
  mergeApplicationsSchema,
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
const mergeAnnotations = {
  ...deleteAnnotations,
  idempotentHint: true,
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
  agency: z.string().max(160).nullable(),
  appliedOn: z.iso.date().nullable(),
  companyName: z.string(),
  id: applicationIdSchema,
  location: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionDue: z.iso.date().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  roleTitle: z.string(),
  salary: z.string().max(160).nullable(),
  status: z.string(),
  statusId: referenceValueIdSchema,
  statusIsTerminal: z.boolean(),
  updatedAt: z.iso.datetime(),
  workArrangement: z.enum(["hybrid", "remote", "office"]).nullable(),
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
  agency: z.string().max(160).nullable(),
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
  rating: z.number().int().min(1).max(5).nullable(),
  roleTitle: z.string(),
  roleType: z.string().nullable(),
  roleTypeId: referenceValueIdSchema.nullable(),
  salary: z.string().max(160).nullable(),
  source: z.string().nullable(),
  sourceId: referenceValueIdSchema.nullable(),
  sourceUrl: z.url().nullable(),
  status: z.string(),
  statusId: referenceValueIdSchema,
  statusIsTerminal: z.boolean(),
  updatedAt: z.iso.datetime(),
  workArrangement: z.enum(["hybrid", "remote", "office"]).nullable(),
});
const maximumBulkApplicationUpdates = 25;
const bulkApplicationUpdatesSchema = z
  .strictObject({
    updates: z
      .array(
        z.strictObject({
          applicationId: applicationIdSchema,
          update: updateApplicationSchema,
        }),
      )
      .min(1)
      .max(maximumBulkApplicationUpdates),
  })
  .superRefine(({ updates }, context) => {
    const applicationIds = new Set<string>();
    updates.forEach(({ applicationId }, index) => {
      if (applicationIds.has(applicationId)) {
        context.addIssue({
          code: "custom",
          message: "Each applicationId may appear only once",
          path: ["updates", index, "applicationId"],
        });
      }
      applicationIds.add(applicationId);
    });
  });
const bulkApplicationUpdateResultSchema = z.strictObject({
  applications: z
    .array(
      z.strictObject({
        id: applicationIdSchema,
        updatedAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(maximumBulkApplicationUpdates),
  updated: z.number().int().min(1).max(maximumBulkApplicationUpdates),
});
const applicationEventSchema = z.strictObject({
  actorDisplayName: z.string(),
  fromStatus: z.string().nullable(),
  id: z.string(),
  occurredAt: z.iso.datetime(),
  processedAt: z.iso.datetime(),
  sourceEmailMessageId: z.string().nullable(),
  statusOverrideReason: z.string().nullable(),
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
function mergeRelationshipPreviewSchema<RecordSchema extends z.ZodType>(
  recordSchema: RecordSchema,
) {
  return z.strictObject({
    additions: z.array(recordSchema),
    conflicts: z.array(
      z.strictObject({
        key: z.string(),
        source: recordSchema,
        target: recordSchema,
      }),
    ),
    requiresResolution: z.boolean(),
    result: z.array(recordSchema),
    source: z.array(recordSchema),
    target: z.array(recordSchema),
  });
}
const applicationDuplicateReasonSchema = z.strictObject({
  detail: z.string(),
  kind: z.enum([
    "agency",
    "applied_date",
    "canonical_url",
    "company_title",
    "contact",
    "email_message_id",
    "location",
    "posting_id",
  ]),
});
const applicationDuplicateAuditSchema = z.strictObject({
  candidates: z.array(
    z.strictObject({
      applications: z.tuple([applicationRecordSchema, applicationRecordSchema]),
      confidence: z.enum(["definite", "possible", "probable"]),
      reasons: z.array(applicationDuplicateReasonSchema).min(1),
    }),
  ),
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const applicationMergeFieldValueSchema = z
  .union([z.string(), z.number()])
  .nullable();
const applicationMergePreviewSchema = z.strictObject({
  contacts: mergeRelationshipPreviewSchema(applicationContactSchema),
  documents: mergeRelationshipPreviewSchema(documentRecordSchema),
  emailEvidence: mergeRelationshipPreviewSchema(applicationEmailEvidenceSchema),
  fieldConflicts: z.array(
    z.strictObject({
      field: applicationMergeFieldSchema,
      resolution: z.enum(["source", "target"]).nullable(),
      resolvedValue: applicationMergeFieldValueSchema,
      sourceValue: applicationMergeFieldValueSchema,
      targetValue: applicationMergeFieldValueSchema,
    }),
  ),
  history: z.strictObject({
    sourceEvents: z.array(applicationEventSchema),
    targetEvents: z.array(applicationEventSchema),
  }),
  informationNotRetained: z.array(z.string()),
  jobPostings: mergeRelationshipPreviewSchema(applicationJobPostingSchema),
  links: mergeRelationshipPreviewSchema(applicationLinkSchema),
  safeToApply: z.boolean(),
  source: applicationRecordSchema,
  survivor: applicationRecordSchema,
  target: applicationRecordSchema,
  unresolvedConflicts: z.array(z.string()),
});
const applicationMergeLineageSchema = z.strictObject({
  actorDisplayName: z.string(),
  id: z.uuid(),
  mergedAt: z.iso.datetime(),
  sourceApplicationId: applicationIdSchema,
  sourceUpdatedAt: z.iso.datetime(),
  targetApplicationId: applicationIdSchema,
  targetUpdatedAt: z.iso.datetime(),
});
const applicationMergeResultSchema = z.strictObject({
  alreadyApplied: z.boolean(),
  applied: z.boolean(),
  lineage: applicationMergeLineageSchema.nullable(),
  preview: applicationMergePreviewSchema,
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
const mcpSchemaSummarySchema = z.strictObject({
  schemaSha256: sha256Schema,
  schemaVersion: z.number().int().positive(),
  toolCount: z.number().int().positive(),
});
const mcpSchemaStatusSchema = z.strictObject({
  documentationUrl: z.url(),
  live: mcpSchemaSummarySchema.extend({
    tools: z.array(
      z.strictObject({
        name: z.string().min(1),
        schemaSha256: sha256Schema,
      }),
    ),
  }),
  publication: mcpSchemaSummarySchema.extend({
    status: z.enum(["current", "refresh_required"]),
  }),
  refreshMethod: z.literal("scan_submit_publish"),
  selfRefreshSupported: z.literal(false),
});
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
    if (error instanceof ApplicationMergeNotFoundError) {
      return recordAuditEvent(audit, logger, tool, targetType, "not_found")
        ? failedToolResult("application_merge_not_found")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationMergeStateError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult(error.code)
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
    if (error instanceof ApplicationMergeNotFoundError) {
      return recordAuditEvent(audit, logger, tool, targetType, "not_found")
        ? failedToolResult("application_merge_not_found")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationMergeStateError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult(error.code)
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationMergeVersionConflictError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("application_merge_conflict")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationMergeUnsafeError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("application_merge_unresolved_conflicts")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationConflictError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("application_conflict")
        : failedToolResult("internal_error");
    }
    const statusEventErrorCode =
      error instanceof ApplicationStatusStaleError
        ? "job_email_status_stale"
        : error instanceof ApplicationStatusRegressionError
          ? "job_email_status_regression"
          : error instanceof ApplicationStatusEventConflictError
            ? "job_email_status_conflict"
            : undefined;
    if (statusEventErrorCode) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult(statusEventErrorCode)
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
    "get_connector_schema_status",
    {
      annotations: readOnlyAnnotations,
      description:
        "Report the live MCP tool-contract version and SHA-256 hash, the last plugin metadata version marked as published, and whether OpenAI schema publication is required. This diagnostic cannot refresh reviewed plugin metadata itself.",
      inputSchema: emptyInputSchema,
      outputSchema: mcpSchemaStatusSchema,
      title: "Get connector schema status",
    },
    () =>
      executeTool(
        "get_connector_schema_status",
        "workspace",
        logger,
        options.audit,
        getApplicationMcpSchemaStatus,
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
        "List up to 100 application summaries with end company, agency, salary, rating, and work arrangement, optionally filtered by status ID.",
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
        "Return one application with end company, agency, salary, rating, work arrangement, contacts, links, notes, immutable stage events, and linked email evidence including any stored Outlook web URL.",
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
    "audit_duplicate_applications",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return a bounded, paginated workspace audit of deterministic duplicate candidates. Each candidate includes both records, a confidence band, and explicit matching reasons.",
      inputSchema: auditDuplicateApplicationsSchema,
      outputSchema: applicationDuplicateAuditSchema,
      title: "Audit duplicate applications",
    },
    (input) =>
      executeTool(
        "audit_duplicate_applications",
        "application_collection",
        logger,
        options.audit,
        () => tools.auditDuplicateApplications(input),
      ),
  );

  server.registerTool(
    "merge_applications",
    {
      annotations: mergeAnnotations,
      description:
        "Preview or atomically apply one explicit source-to-target application merge. Preview is read-only and returns every scalar and relationship conflict. Apply requires confirm=true, current updatedAt values for both records, and explicit resolutions for every conflict; it preserves source events through immutable merge lineage and marks the source merged only after all relationships succeed.",
      inputSchema: mergeApplicationsSchema,
      outputSchema: applicationMergeResultSchema,
      title: "Merge applications",
    },
    (input) =>
      input.mode === "preview"
        ? executeTool(
            "merge_applications",
            "application",
            logger,
            options.audit,
            () => tools.mergeApplications(input),
          )
        : executeWriteTool(
            "merge_applications",
            "application",
            logger,
            options.audit,
            () => tools.mergeApplications(input),
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
    "bulk_update_applications",
    {
      annotations: writeAnnotations,
      description:
        "Atomically update selected fields on 1 to 25 applications in the bound workspace when this connection has read-and-write access. Supply each application's current updatedAt as update.expectedUpdatedAt. Omitted fields remain unchanged; null clears nullable fields. If any application is missing, stale, or invalid, no updates are committed. A stale value returns application_conflict; read the latest applications before retrying.",
      inputSchema: bulkApplicationUpdatesSchema,
      outputSchema: bulkApplicationUpdateResultSchema,
      title: "Bulk update applications",
    },
    ({ updates }) =>
      executeWriteTool(
        "bulk_update_applications",
        "application_collection",
        logger,
        options.audit,
        () => tools.bulkUpdateApplications(updates),
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
        "Idempotently match or create an application, apply an optional selected-field update, and persist workspace-unique posting and email evidence. Pass the Outlook message web link as email.webUrl so get_application can return it. email.receivedAt is the effective time for a requested status change; stale or regressive changes are rejected unless statusOverride explicitly supplies a reason. Reusing the same email Message-ID cannot create a duplicate application or status event.",
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
