import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  ApplicationConflictError,
  ApplicationEventNoChangeError,
  ApplicationMergeNotFoundError,
  ApplicationMergeStateError,
  ApplicationMergeUnsafeError,
  ApplicationMergeVersionConflictError,
  ApplicationNotFoundError,
  ApplicationStatusEventConflictError,
  ApplicationStatusRegressionError,
  ApplicationStatusStaleError,
  InvalidApplicationReferenceError,
  InvalidOutlookGraphConnectionAssignmentError,
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
  type PreparedMcpWriteOperation,
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
  addApplicationEventSchema,
  applicationIdSchema,
  applicationMergeFieldSchema,
  auditDuplicateApplicationsSchema,
  createApplicationSchema,
  mergeApplicationsSchema,
  updateApplicationSchema,
} from "../domain/applications.js";
import { documentUploadMetadataSchema } from "../domain/documents.js";
import { emailLinkExtractionInputSchema } from "../domain/email_links.js";
import { jobPostingInspectionInputSchema } from "../domain/job_postings.js";
import { referenceValueIdSchema } from "../domain/reference_values.js";
import {
  linkEmailEvidenceSchema,
  matchJobApplicationEmailSchema,
  reconcileApplicationFromEvidenceSchema,
  upsertApplicationFromEmailSchema,
} from "../domain/job_email_reconciliation.js";
import { jobBoardProviderSchema } from "../domain/job_board.js";
import { syncOutlookEmailEvidenceSchema } from "../domain/outlook_email_sync.js";
import { reconcileOutlookGraphConnectionSchema } from "../domain/outlook_connection_reconciliation.js";
import {
  processOutlookJobDigestSchema,
  searchOutlookJobDigestsSchema,
} from "../domain/outlook_job_digest.js";
import {
  OutlookEmailSyncOperationalError,
  OutlookEmailSyncVerificationError,
} from "../application/outlook_email_sync.js";
import { noOpLogger, type ApplicationLogger } from "./logging.js";

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;
const openWorldReadOnlyAnnotations = {
  ...readOnlyAnnotations,
  openWorldHint: true,
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
const openWorldIdempotentWriteAnnotations = {
  ...idempotentWriteAnnotations,
  openWorldHint: true,
} as const;
const openWorldWriteAnnotations = {
  ...writeAnnotations,
  openWorldHint: true,
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
const boundedApplicationPageSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
});
const unlinkedApplicationSchema = z.strictObject({
  application: applicationSummarySchema,
  emailEvidenceCount: z.literal(0),
  jobPostingCount: z.literal(0),
  missingEmailEvidence: z.literal(true),
  missingJobPostingEvidence: z.literal(true),
});
const unlinkedApplicationListSchema = z.strictObject({
  applications: z.array(unlinkedApplicationSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const applicationDataQualityIssueCodeSchema = z.enum([
  "missing_email_evidence",
  "missing_job_posting_evidence",
  "missing_location",
  "missing_next_action",
  "missing_role_type",
  "missing_source",
  "missing_source_url",
  "missing_work_arrangement",
  "next_action_due_without_action",
  "next_action_without_due_date",
]);
const applicationDataQualityIssueSchema = z.strictObject({
  code: applicationDataQualityIssueCodeSchema,
  severity: z.enum(["info", "warning"]),
});
const applicationDataQualityReportSchema = z.strictObject({
  applicationsWithFindings: z.number().int().nonnegative(),
  countsByCode: z.array(
    z.strictObject({
      code: applicationDataQualityIssueCodeSchema,
      count: z.number().int().positive(),
    }),
  ),
  findings: z.array(
    z.strictObject({
      application: applicationSummarySchema,
      issues: z.array(applicationDataQualityIssueSchema).min(1),
    }),
  ),
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  totalApplications: z.number().int().nonnegative(),
  totalIssues: z.number().int().nonnegative(),
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
  outlookGraphConnectionId: z.uuid().nullable(),
  outlookGraphConnectionName: z.string().max(80).nullable(),
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
const outlookEmailClassificationSchema = z.enum([
  "account_or_security",
  "application_acknowledgement",
  "interview_or_assessment",
  "irrelevant",
  "marketing_or_digest",
  "offer",
  "recruiter_conversation",
  "status_or_rejection",
]);
const outlookEmailScoreReasonSchema = z.enum([
  "canonical_url_match",
  "company_match",
  "contact_match",
  "plausible_date",
  "posting_id_match",
  "role_match",
  "transactional_message",
]);
const outlookEmailDisqualifierSchema = z.enum([
  "below_threshold",
  "detail_unavailable",
  "existing_metadata_mismatch",
  "inconsistent_message_id",
  "insufficient_identity",
  "marketing_or_account_message",
  "missing_message_id",
  "non_transactional_message",
  "tracker_match_ambiguous",
  "tracker_match_conflict",
]);
const outlookEmailCandidateAssessmentSchema = z.strictObject({
  classification: outlookEmailClassificationSchema,
  disqualifiers: z.array(outlookEmailDisqualifierSchema),
  messageId: z.string().max(998).nullable(),
  qualified: z.boolean(),
  reasons: z.array(outlookEmailScoreReasonSchema),
  receivedAt: z.iso.datetime(),
  score: z.number().int().nonnegative(),
  sender: z.string().email().max(254).nullable(),
  subject: z.string().max(255),
});
const outlookExistingEvidenceValidationSchema = z.strictObject({
  messageId: z.string().max(998),
  status: z.enum(["metadata_mismatch", "not_found", "valid"]),
});
const outlookEmailSyncResultSchema = z.strictObject({
  application: applicationRecordSchema,
  candidateAssessments: z.array(outlookEmailCandidateAssessmentSchema).max(5),
  emailEvidence: z.array(applicationEmailEvidenceSchema),
  existingEvidenceValidation: z
    .array(outlookExistingEvidenceValidationSchema)
    .max(20),
  link: z.strictObject({
    attempted: z.boolean(),
    created: z.boolean(),
  }),
  outcome: z.enum([
    "already_linked",
    "ambiguous",
    "conflict",
    "linked",
    "no_match",
  ]),
  scoringVersion: z.number().int().positive(),
  search: z.strictObject({
    candidatesRetrieved: z.number().int().nonnegative().max(20),
    detailsRead: z.number().int().nonnegative().max(5),
    queriesRun: z.number().int().nonnegative().max(2),
  }),
  selectedEvidence: outlookEmailCandidateAssessmentSchema.nullable(),
  threshold: z.number().int().positive(),
  verification: z.strictObject({
    applicationReread: z.literal(true),
    evidenceStored: z.boolean(),
    storedMessageId: z.string().max(998).nullable(),
  }),
});
const outlookConnectionReconciliationMessageSchema = z.strictObject({
  application: z
    .strictObject({
      companyName: z.string(),
      id: applicationIdSchema,
      roleTitle: z.string(),
    })
    .nullable(),
  candidateApplicationIds: z.array(applicationIdSchema).max(10),
  classification: outlookEmailClassificationSchema.nullable(),
  messageId: z.string().max(998).nullable(),
  outcome: z.enum([
    "already_linked",
    "ambiguous",
    "conflict",
    "linked",
    "no_match",
  ]),
  receivedAt: z.iso.datetime(),
  score: z.number().int().nonnegative().nullable(),
  sender: z.string().email().max(254).nullable(),
  subject: z.string().max(255),
});
const outlookConnectionReconciliationResultSchema = z.strictObject({
  connection: z.strictObject({
    folderPath: z.string(),
    id: z.uuid(),
    mailbox: z.string().email().max(254),
    name: z.string(),
  }),
  messages: z.array(outlookConnectionReconciliationMessageSchema).max(50),
  reconciliation: z.strictObject({
    alreadyLinked: z.number().int().nonnegative().max(50),
    ambiguous: z.number().int().nonnegative().max(50),
    assignedApplications: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative().max(50),
    detailsRead: z.number().int().nonnegative().max(50),
    linked: z.number().int().nonnegative().max(50),
    messagesRetrieved: z.number().int().nonnegative().max(50),
    noMatch: z.number().int().nonnegative().max(50),
  }),
  scoringVersion: z.number().int().positive(),
  threshold: z.number().int().positive(),
  verification: z.strictObject({
    connectionReread: z.literal(true),
    cursorStored: z.boolean(),
    linkedMessageIds: z.array(z.string().max(998)).max(50),
  }),
  window: z.strictObject({
    previousReconciledAt: z.iso.datetime().nullable(),
    since: z.iso.datetime(),
    storedLastReconciledAt: z.iso.datetime(),
    through: z.iso.datetime(),
  }),
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
const resolvedJobLinkCandidateSchema = emailLinkCandidateSchema.extend({
  redirectsFollowed: z.number().int().min(0).max(3),
  resolution: z.enum(["deterministic", "tracking_redirect"]),
});
const unavailableJobLinkSchema = z.strictObject({
  host: z.string(),
  reason: z.enum([
    "fetch_failed",
    "invalid_redirect",
    "redirect_limit",
    "redirect_not_allowed",
    "unrecognized_destination",
  ]),
});
const jobLinkResolutionResultSchema = z.strictObject({
  candidates: z.array(resolvedJobLinkCandidateSchema).max(20),
  tracking: z.strictObject({
    attempted: z.number().int().min(0).max(5),
    resolved: z.number().int().min(0).max(5),
    unavailable: z.array(unavailableJobLinkSchema).max(5),
  }),
});
const jobPostingUnavailableReasonSchema = z.enum([
  "ambiguous_metadata",
  "blocked",
  "expired",
  "fetch_failed",
  "missing_structured_data",
  "redirect_limit",
  "unrecognized_url",
]);
const jobPostingInspectionResultSchema = z.strictObject({
  applyUrl: z
    .url({ protocol: /^https$/ })
    .nullable()
    .optional(),
  canonicalUrl: z.url({ protocol: /^https$/ }).nullable(),
  closingDate: z.iso.date().nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  employer: z.string().max(160).nullable().optional(),
  location: z.string().max(160).nullable().optional(),
  reason: jobPostingUnavailableReasonSchema.optional(),
  salary: z.string().max(160).nullable().optional(),
  status: z.enum(["available", "unavailable"]),
  title: z.string().max(160).nullable().optional(),
  workArrangement: z.enum(["hybrid", "office", "remote"]).nullable().optional(),
});
const outlookJobDigestInspectionResultSchema =
  jobPostingInspectionResultSchema.extend({
    description: z.string().max(4_000).nullable().optional(),
  });
const outlookJobDigestPostingSchema = z.strictObject({
  candidate: resolvedJobLinkCandidateSchema,
  descriptionTruncated: z.boolean(),
  inspection: outlookJobDigestInspectionResultSchema,
  match: jobEmailMatchResultSchema,
});
const outlookJobDigestProcessingResultSchema = z.strictObject({
  classification: outlookEmailClassificationSchema.nullable(),
  connection: z.strictObject({
    folderPath: z.string(),
    id: z.uuid(),
    mailbox: z.string().email().max(254),
    name: z.string(),
  }),
  digest: z
    .strictObject({
      messageId: z.string().max(998),
      receivedAt: z.iso.datetime(),
      sender: z.string().email().max(254).nullable(),
      subject: z.string().max(255),
    })
    .nullable(),
  outcome: z.enum(["ambiguous", "not_digest", "not_found", "processed"]),
  page: z.strictObject({
    nextOffset: z.number().int().min(0).max(19).nullable(),
    offset: z.number().int().min(0).max(19),
    returned: z.number().int().min(0).max(5),
    total: z.number().int().min(0).max(20),
  }),
  postings: z.array(outlookJobDigestPostingSchema).max(5),
  tracking: jobLinkResolutionResultSchema.shape.tracking,
  verification: z.strictObject({
    exactMessageMatches: z.number().int().min(0).max(2),
    mailboxReadOnly: z.literal(true),
    messageBodyReturned: z.literal(false),
  }),
});
const outlookJobDigestSearchMessageSchema = z.strictObject({
  classification: outlookEmailClassificationSchema,
  messageId: z.string().max(998).nullable(),
  receivedAt: z.iso.datetime(),
  sender: z.string().email().max(254).nullable(),
  subject: z.string().max(255),
});
const outlookJobDigestSearchResultSchema = z.strictObject({
  connection: z.strictObject({
    folderPath: z.string(),
    id: z.uuid(),
    lastReconciledAt: z.iso.datetime().nullable(),
    mailbox: z.string().email().max(254),
    name: z.string(),
  }),
  messages: z.array(outlookJobDigestSearchMessageSchema).max(20),
  page: z.strictObject({
    detailsRead: z.number().int().min(0).max(20),
    limit: z.number().int().min(1).max(20),
    limitReached: z.boolean(),
    nextOffset: z.number().int().min(1).max(499).nullable(),
    offset: z.number().int().min(0).max(499),
    scanned: z.number().int().min(0).max(20),
  }),
  unavailable: z
    .array(
      z.strictObject({
        messageId: z.string().max(998).nullable(),
        reason: z.literal("detail_unavailable"),
        receivedAt: z.iso.datetime(),
        subject: z.string().max(255),
      }),
    )
    .max(20),
  verification: z.strictObject({
    applicationStateChanged: z.literal(false),
    cursorChanged: z.literal(false),
    mailboxReadOnly: z.literal(true),
    messageBodyReturned: z.literal(false),
  }),
  window: z.strictObject({
    after: z.iso.datetime(),
    before: z.iso.datetime(),
  }),
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
const applicationEvidenceReconciliationResultSchema =
  upsertApplicationFromEmailResultSchema.extend({
    action: z.enum(["created", "linked", "matched", "updated"]),
  });
const addApplicationEventResultSchema = z.strictObject({
  application: applicationRecordSchema,
  event: applicationEventSchema,
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
    status: z.enum(["current", "update_available"]),
  }),
  publicationRequired: z.literal(false),
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

async function executeAsyncTool(
  tool: McpAuditAction,
  targetType: McpAuditTargetType,
  logger: ApplicationLogger,
  audit: McpServerAuditOptions | undefined,
  operation: () => Promise<object>,
): Promise<CallToolResult> {
  try {
    const value = await operation();
    return recordAuditEvent(audit, logger, tool, targetType, "success")
      ? successfulToolResult(value)
      : failedToolResult("internal_error");
  } catch (error) {
    if (error instanceof LocalMcpActorUnavailableError) {
      return recordAuditEvent(audit, logger, tool, targetType, "denied")
        ? failedToolResult("actor_unavailable")
        : failedToolResult("internal_error");
    }
    logger.error("mcp_tool_failed", { error, tool });
    recordAuditEvent(audit, logger, tool, targetType, "error");
    return failedToolResult("internal_error");
  }
}

async function executePreparedWriteTool<Result extends object>(
  tool: McpAuditAction,
  targetType: McpAuditTargetType,
  logger: ApplicationLogger,
  audit: McpServerAuditOptions | undefined,
  prepare: () => Promise<PreparedMcpWriteOperation<Result>>,
): Promise<CallToolResult> {
  if (!audit) {
    logger.error("mcp_write_audit_unavailable", { tool });
    return failedToolResult("internal_error");
  }
  try {
    const prepared = await prepare();
    return executeWriteTool(tool, targetType, logger, audit, () =>
      prepared.commit(),
    );
  } catch (error) {
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
    if (error instanceof OutlookEmailSyncOperationalError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult(error.code)
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
    if (error instanceof OutlookEmailSyncOperationalError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult(error.code)
        : failedToolResult("internal_error");
    }
    if (error instanceof OutlookEmailSyncVerificationError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("outlook_email_verification_failed")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationEventNoChangeError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("application_event_no_change")
        : failedToolResult("internal_error");
    }
    const statusEventErrorCode =
      error instanceof ApplicationStatusStaleError
        ? tool === "add_application_event"
          ? "application_event_stale"
          : "job_email_status_stale"
        : error instanceof ApplicationStatusRegressionError
          ? tool === "add_application_event"
            ? "application_event_regression"
            : "job_email_status_regression"
          : error instanceof ApplicationStatusEventConflictError
            ? tool === "add_application_event"
              ? "application_event_conflict"
              : "job_email_status_conflict"
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
    if (error instanceof InvalidOutlookGraphConnectionAssignmentError) {
      return recordAuditEvent(audit, logger, tool, targetType, "error")
        ? failedToolResult("invalid_outlook_graph_connection_assignment")
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
        "Report the live MCP tool-contract version and SHA-256 hash plus the last optional OpenAI-managed metadata version marked as published. Direct MCP deployments do not require that separate publication.",
      inputSchema: emptyInputSchema,
      outputSchema: mcpSchemaStatusSchema,
      title: "Get optional distribution status",
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
    "list_unlinked_applications",
    {
      annotations: readOnlyAnnotations,
      description:
        "List a bounded page of applications that have neither dedicated email evidence nor dedicated job-posting evidence. Each result reports both zero evidence counts explicitly.",
      inputSchema: boundedApplicationPageSchema,
      outputSchema: unlinkedApplicationListSchema,
      title: "List unlinked applications",
    },
    (input) =>
      executeTool(
        "list_unlinked_applications",
        "application_collection",
        logger,
        options.audit,
        () => tools.listUnlinkedApplications(input),
      ),
  );

  server.registerTool(
    "get_application_data_quality",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return a bounded deterministic data-quality report with explicit issue codes and counts. Missing values remain missing; the report never guesses replacement data or assigns a subjective score.",
      inputSchema: boundedApplicationPageSchema,
      outputSchema: applicationDataQualityReportSchema,
      title: "Get application data quality",
    },
    (input) =>
      executeTool(
        "get_application_data_quality",
        "application_collection",
        logger,
        options.audit,
        () => tools.getApplicationDataQuality(input),
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
    "find_duplicate_applications",
    {
      annotations: readOnlyAnnotations,
      description:
        "Find a bounded page of duplicate candidates using the same deterministic algorithm, confidence bands, and reasons as audit_duplicate_applications.",
      inputSchema: auditDuplicateApplicationsSchema,
      outputSchema: applicationDuplicateAuditSchema,
      title: "Find duplicate applications",
    },
    (input) =>
      executeTool(
        "find_duplicate_applications",
        "application_collection",
        logger,
        options.audit,
        () => tools.findDuplicateApplications(input),
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
    "link_email_evidence",
    {
      annotations: idempotentWriteAnnotations,
      description:
        "Idempotently link one bounded RFC Message-ID evidence record to an explicit existing application. Message-IDs are workspace-unique and a conflict with another application is rejected.",
      inputSchema: linkEmailEvidenceSchema,
      outputSchema: applicationEvidenceReconciliationResultSchema,
      title: "Link email evidence",
    },
    (input) =>
      executeWriteTool(
        "link_email_evidence",
        "job_email",
        logger,
        options.audit,
        () => tools.linkEmailEvidence(input),
      ),
  );

  server.registerTool(
    "reconcile_application_from_evidence",
    {
      annotations: idempotentWriteAnnotations,
      description:
        "Atomically reconcile trusted evidence either by linking it to one explicit existing application or by reusing the established deterministic match/create/update workflow. Ambiguity and conflicting evidence are rejected instead of guessed.",
      inputSchema: reconcileApplicationFromEvidenceSchema,
      outputSchema: applicationEvidenceReconciliationResultSchema,
      title: "Reconcile application from evidence",
    },
    (input) =>
      executeWriteTool(
        "reconcile_application_from_evidence",
        "job_email",
        logger,
        options.audit,
        () => tools.reconcileApplicationFromEvidence(input),
      ),
  );

  server.registerTool(
    "sync_outlook_email_evidence",
    {
      annotations: openWorldIdempotentWriteAnnotations,
      description:
        "Read one application, validate its existing Outlook evidence, search the server-configured Inbox Jobs folder through Microsoft Graph, inspect and deterministically score a bounded shortlist, link only a qualifying RFC Message-ID, then re-read and verify the stored evidence. The tool never changes mailbox state.",
      inputSchema: syncOutlookEmailEvidenceSchema,
      outputSchema: outlookEmailSyncResultSchema,
      title: "Sync Outlook email evidence",
    },
    (input) =>
      executePreparedWriteTool(
        "sync_outlook_email_evidence",
        "job_email",
        logger,
        options.audit,
        () => tools.prepareSyncOutlookEmailEvidence(input),
      ),
  );

  server.registerTool(
    "reconcile_outlook_graph_connection",
    {
      annotations: openWorldWriteAnnotations,
      description:
        "Resolve one enabled Graph connection by exact ID, name, or mailbox; read only messages received after its last successful reconciliation; deterministically match them against applications assigned to that connection; link only unique high-confidence RFC Message-ID evidence; then atomically store and verify the new connection cursor. The tool never changes mailbox state.",
      inputSchema: reconcileOutlookGraphConnectionSchema,
      outputSchema: outlookConnectionReconciliationResultSchema,
      title: "Reconcile Outlook Graph connection",
    },
    (input) =>
      executePreparedWriteTool(
        "reconcile_outlook_graph_connection",
        "job_email",
        logger,
        options.audit,
        () => tools.prepareReconcileOutlookGraphConnection(input),
      ),
  );

  server.registerTool(
    "search_outlook_job_digests",
    {
      annotations: openWorldReadOnlyAnnotations,
      description:
        "Resolve one enabled Graph connection and search a bounded fixed window backward through its configured folder. Classify at most 20 messages per page and return exact RFC Message-IDs and bounded metadata without returning bodies, changing mailbox state, advancing the reconciliation cursor, or changing tracker records.",
      inputSchema: searchOutlookJobDigestsSchema,
      outputSchema: outlookJobDigestSearchResultSchema,
      title: "Search Outlook job digests",
    },
    (input) =>
      executeAsyncTool(
        "search_outlook_job_digests",
        "job_email",
        logger,
        options.audit,
        () => tools.searchOutlookJobDigests(input),
      ),
  );

  server.registerTool(
    "process_outlook_job_digest",
    {
      annotations: openWorldReadOnlyAnnotations,
      description:
        "Resolve one enabled Graph connection by exact ID, name, or mailbox; retrieve one exact RFC Message-ID from its configured folder; require a digest or job-alert classification; resolve bounded job links; inspect up to five structured postings from the requested offset; and report deterministic tracker matches. The tool returns no email body, never changes mailbox state, and never creates or updates applications.",
      inputSchema: processOutlookJobDigestSchema,
      outputSchema: outlookJobDigestProcessingResultSchema,
      title: "Process Outlook job digest",
    },
    (input) =>
      executeAsyncTool(
        "process_outlook_job_digest",
        "job_email",
        logger,
        options.audit,
        () => tools.processOutlookJobDigest(input),
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
    "resolve_job_links",
    {
      annotations: openWorldReadOnlyAnnotations,
      description:
        "Run the unchanged deterministic job-link extraction, then resolve only allowlisted HTTPS tracking hosts through public pinned IPs and bounded redirects. Return a candidate only when the final URL is recognized and canonicalized by the job-board provider registry.",
      inputSchema: emailLinkExtractionInputSchema,
      outputSchema: jobLinkResolutionResultSchema,
      title: "Resolve job links",
    },
    (input) =>
      executeAsyncTool(
        "resolve_job_links",
        "job_email",
        logger,
        options.audit,
        () => tools.resolveJobLinks(input),
      ),
  );

  server.registerTool(
    "inspect_job_posting",
    {
      annotations: openWorldReadOnlyAnnotations,
      description:
        "Fetch one provider-registry-validated canonical HTTPS job posting through public pinned IPs and bounded redirects, then return only structured JobPosting metadata. Blocked, expired, missing, or ambiguous postings return unavailable instead of inferred details.",
      inputSchema: jobPostingInspectionInputSchema,
      outputSchema: jobPostingInspectionResultSchema,
      title: "Inspect job posting",
    },
    (input) =>
      executeAsyncTool(
        "inspect_job_posting",
        "job_email",
        logger,
        options.audit,
        () => tools.inspectJobPosting(input),
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
    "add_application_event",
    {
      annotations: writeAnnotations,
      description:
        "Append one immutable status-transition event by changing an existing application to an explicit active status. Requires the current updatedAt and an effective timestamp; stale, regressive, same-status, or conflicting events are rejected unless an explicit override reason is supplied.",
      inputSchema: addApplicationEventSchema,
      outputSchema: addApplicationEventResultSchema,
      title: "Add application event",
    },
    (input) =>
      executeWriteTool(
        "add_application_event",
        "application",
        logger,
        options.audit,
        () => tools.addApplicationEvent(input),
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
      "This local server is bound to one operator-selected actor, workspace, and connection permission. For one known application's Outlook evidence workflow, call sync_outlook_email_evidence directly with applicationId. To process only new mail for one configured Graph connection, call reconcile_outlook_graph_connection directly with its exact ID, name, or mailbox. To search backward for older digests without exposing bodies, call search_outlook_job_digests with a fixed bounded window, then call process_outlook_job_digest only with exact returned RFC Message-IDs classified as marketing_or_digest. These tools perform all required tracker and Microsoft Graph reads, writes, and verification, so do not use a separate Microsoft 365 connector around them. Call get_tracker_context before other workspace operations. Mutation tools work only when MCP_LOCAL_ACCESS_MODE is read_write, and delete_application also requires explicit confirmation.",
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
