import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type Database from "better-sqlite3";

import {
  ApplicationActivityCorrectionError,
  ApplicationActivityEvidenceError,
  ApplicationActivityIdempotencyConflictError,
  ApplicationConflictError,
  ApplicationFieldProvenanceIdempotencyConflictError,
  ApplicationFieldProvenanceSourceError,
  ApplicationFieldProvenanceVerificationConflictError,
  ApplicationMergeNotFoundError,
  ApplicationMergeRecoveryUnsafeError,
  ApplicationMergeStateError,
  ApplicationMergeUnsafeError,
  ApplicationMergeVersionConflictError,
  ApplicationRecoveryNotFoundError,
  ApplicationRecoveryStateError,
  ApplicationRecoveryVersionConflictError,
  ApplicationRestoreUnsafeError,
  ApplicationStatusEventConflictError,
  ApplicationStatusRegressionError,
  ApplicationStatusStaleError,
  InvalidApplicationReferenceError,
  InvalidOutlookGraphConnectionAssignmentError,
  type AddApplicationActivityRecord,
  type ApplicationAttentionRepositoryResult,
  type ApplicationAttentionSignals,
  type ApplicationActivityEvent,
  type ApplicationDuplicateAudit,
  type ApplicationDuplicateCandidate,
  type ApplicationDuplicateReason,
  type ApplicationContact,
  type ApplicationEvent,
  type ApplicationEventsPage,
  type ApplicationFieldProvenanceAssessment,
  type ApplicationFieldProvenanceRecord,
  type ApplicationLink,
  type ApplicationMergeFieldConflict,
  type ApplicationMergeFieldValue,
  type ApplicationMergeLineage,
  type ApplicationMergePreview,
  type ApplicationMergeRecoveryPreview,
  type ApplicationMergeRecoveryRecord,
  type ApplicationMergeRecoveryResult,
  type ApplicationMergeRelationshipPreview,
  type ApplicationMergeResult,
  type ApplicationRecoveryConflict,
  type ApplicationRecoveryRelationshipSummary,
  type ApplicationRecord,
  type ApplicationRestorationRecord,
  type ApplicationRestorePreview,
  type ApplicationRestoreResult,
  type ApplyApplicationMergeRecord,
  type ApplicationsRepository,
  type CreateApplicationRecord,
  type DeletedApplicationRecord,
  type DeletedApplicationsPage,
  type DeleteApplicationRecord,
  type QueryApplicationAttentionRecord,
  type RecoverApplicationMergeRecord,
  type RecordApplicationFieldProvenanceRecord,
  type RestoreApplicationRecord,
  type UpdateApplicationRecord,
  type VerifyApplicationFieldProvenanceRecord,
} from "../../application/applications.js";
import type {
  ApplicationEmailEvidence,
  ApplicationJobPosting,
} from "../../application/job_email_reconciliation.js";
import type { DocumentRecord } from "../../application/documents.js";
import type {
  ApplicationAttentionFieldState,
  ApplicationAttentionMissingEvidence,
  ApplicationAttentionMissingField,
  ApplicationAttentionReasonCode,
} from "../../domain/application_attention.js";
import {
  maximumApplicationRelations,
  type ApplicationFieldName,
  type ApplicationFieldProvenanceSource,
  type ApplicationMergeField,
  type ApplicationMergeResolutions,
  type AuditDuplicateApplicationsInput,
} from "../../domain/applications.js";
import type { ListDeletedApplicationsInput } from "../../domain/application_recovery.js";

interface StoredApplicationRecord extends Omit<
  ApplicationRecord,
  | "contacts"
  | "links"
  | "salaryDetails"
  | "statusIsTerminal"
  | "workArrangementDetails"
> {
  officeDaysPerWeek: number | null;
  remoteDaysPerWeek: number | null;
  salaryCurrency: string | null;
  salaryDisclosed: number | null;
  salaryMaximum: number | null;
  salaryMinimum: number | null;
  salaryNegotiable: number | null;
  salaryPeriod: "annual" | "daily" | "hourly" | "monthly" | "weekly" | null;
  statusIsTerminal: number;
  workArrangementText: string | null;
}

interface StoredApplicationFieldProvenance {
  applicationId: string;
  confidence: number;
  createdAt: string;
  field: ApplicationFieldName;
  fieldState: ApplicationFieldProvenanceRecord["fieldState"];
  id: string;
  idempotencyKey: string | null;
  observedAt: string;
  sourceDocumentId: string | null;
  sourceEmailEvidenceId: string | null;
  sourceJobPostingId: string | null;
  sourceType: ApplicationFieldProvenanceSource["type"];
  valueJson: string;
  verifiedAt: string | null;
  verifiedByDisplayName: string | null;
  verifiedByUserId: string | null;
}

type StoredContact = ApplicationContact & { applicationId: string };
type StoredLink = ApplicationLink & { applicationId: string };

interface StoredApplicationMerge extends ApplicationMergeLineage {
  actorUserId: string;
  recoverySnapshotJson: string | null;
  resolutionsJson: string;
}

interface StoredApplicationDeletion {
  actorDisplayName: string;
  actorUserId: string;
  applicationId: string;
  deletedAt: string;
  id: string;
  mergeId: string | null;
  reason: string;
  recoverySnapshotJson: string;
  targetApplicationId: string | null;
  targetCompanyName: string | null;
  targetRoleTitle: string | null;
  workspaceId: string;
}

interface ApplicationRelationshipVersion {
  id: string;
  updatedAt: string;
}

interface ApplicationDeletionRecoverySnapshot {
  applicationUpdatedAt: string;
  documentIds: string[];
  emailEvidence: ApplicationRelationshipVersion[];
  jobPostings: ApplicationRelationshipVersion[];
  outlookGraphConnectionId: string | null;
  version: 1;
}

interface ApplicationMergeRecoverySnapshot {
  sourceBefore: ApplicationRecord;
  sourceDocumentIds: string[];
  sourceEmailEvidence: ApplicationRelationshipVersion[];
  sourceJobPostings: ApplicationRelationshipVersion[];
  targetAfter: ApplicationRecord;
  targetBefore: ApplicationRecord;
  targetDocumentIds: string[];
  version: 1;
}

type StoredMergeDocument = Omit<DocumentRecord, "applications">;

interface StoredDocumentApplication {
  companyName: string;
  id: string;
  roleTitle: string;
}

const mergeFields = [
  "agency",
  "appliedOn",
  "companyName",
  "location",
  "nextAction",
  "nextActionDue",
  "notes",
  "outlookGraphConnectionId",
  "rating",
  "roleTypeId",
  "roleTitle",
  "salary",
  "sourceId",
  "sourceUrl",
  "statusId",
  "workArrangement",
] as const satisfies readonly ApplicationMergeField[];

const relationHydrationBatchSize = 500;
const provenanceSourcePrecedence: Record<
  ApplicationFieldProvenanceSource["type"],
  number
> = {
  document: 300,
  email_evidence: 200,
  imported: 100,
  job_posting: 400,
};

function recoveryObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recoveryStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function recoveryVersions(
  value: unknown,
): value is ApplicationRelationshipVersion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        recoveryObject(item) &&
        typeof item.id === "string" &&
        typeof item.updatedAt === "string",
    )
  );
}

function parseDeletionRecoverySnapshot(
  value: string,
): ApplicationDeletionRecoverySnapshot | undefined {
  const parsed: unknown = JSON.parse(value);
  if (
    !recoveryObject(parsed) ||
    parsed.version !== 1 ||
    typeof parsed.applicationUpdatedAt !== "string" ||
    !recoveryStringArray(parsed.documentIds) ||
    !recoveryVersions(parsed.emailEvidence) ||
    !recoveryVersions(parsed.jobPostings) ||
    (parsed.outlookGraphConnectionId !== null &&
      typeof parsed.outlookGraphConnectionId !== "string")
  ) {
    return undefined;
  }
  return parsed as unknown as ApplicationDeletionRecoverySnapshot;
}

function parseMergeRecoverySnapshot(
  value: string | null,
): ApplicationMergeRecoverySnapshot | undefined {
  if (value === null) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (
    !recoveryObject(parsed) ||
    parsed.version !== 1 ||
    !recoveryObject(parsed.sourceBefore) ||
    !recoveryObject(parsed.targetBefore) ||
    !recoveryObject(parsed.targetAfter) ||
    !recoveryStringArray(parsed.sourceDocumentIds) ||
    !recoveryStringArray(parsed.targetDocumentIds) ||
    !recoveryVersions(parsed.sourceEmailEvidence) ||
    !recoveryVersions(parsed.sourceJobPostings)
  ) {
    return undefined;
  }
  return parsed as unknown as ApplicationMergeRecoverySnapshot;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
const duplicateCandidatePairsSql = `
  WITH candidate_pairs AS (
    SELECT first.id AS firstId, second.id AS secondId
    FROM applications AS first
    JOIN applications AS second
      ON second.workspace_id = first.workspace_id
     AND second.id > first.id
    WHERE first.workspace_id = @workspaceId
      AND first.deleted_at IS NULL
      AND second.deleted_at IS NULL
      AND (
        (
          lower(trim(first.company_name)) = lower(trim(second.company_name))
          AND lower(trim(first.role_title)) = lower(trim(second.role_title))
        )
        OR (
          first.agency IS NOT NULL
          AND second.agency IS NOT NULL
          AND lower(trim(first.agency)) = lower(trim(second.agency))
        )
        OR (
          first.location IS NOT NULL
          AND second.location IS NOT NULL
          AND lower(trim(first.location)) = lower(trim(second.location))
        )
        OR (
          first.applied_on IS NOT NULL
          AND second.applied_on IS NOT NULL
          AND lower(trim(first.company_name)) = lower(trim(second.company_name))
          AND abs(julianday(first.applied_on) - julianday(second.applied_on)) <= 7
        )
        OR (
          first.source_url IS NOT NULL
          AND second.source_url IS NOT NULL
          AND lower(first.source_url) = lower(second.source_url)
        )
        OR EXISTS (
          SELECT 1
          FROM application_contacts AS first_contact
          JOIN application_contacts AS second_contact
            ON second_contact.workspace_id = first_contact.workspace_id
           AND second_contact.application_id = second.id
          WHERE first_contact.workspace_id = first.workspace_id
            AND first_contact.application_id = first.id
            AND (
              (
                first_contact.email IS NOT NULL
                AND second_contact.email IS NOT NULL
                AND lower(trim(first_contact.email)) =
                    lower(trim(second_contact.email))
              )
              OR (
                first_contact.phone IS NOT NULL
                AND second_contact.phone IS NOT NULL
                AND replace(first_contact.phone, ' ', '') =
                    replace(second_contact.phone, ' ', '')
              )
              OR (
                lower(trim(first_contact.name)) =
                  lower(trim(second_contact.name))
                AND lower(trim(COALESCE(first_contact.role, ''))) =
                  lower(trim(COALESCE(second_contact.role, '')))
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM application_job_postings AS first_posting
          JOIN application_job_postings AS second_posting
            ON second_posting.workspace_id = first_posting.workspace_id
           AND second_posting.application_id = second.id
          WHERE first_posting.workspace_id = first.workspace_id
            AND first_posting.application_id = first.id
            AND (
              (
                first_posting.external_posting_id IS NOT NULL
                AND second_posting.external_posting_id IS NOT NULL
                AND first_posting.provider = second_posting.provider
                AND first_posting.external_posting_id =
                    second_posting.external_posting_id
              )
              OR (
                first_posting.canonical_url IS NOT NULL
                AND second_posting.canonical_url IS NOT NULL
                AND first_posting.canonical_url = second_posting.canonical_url
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM application_email_evidence AS first_email
          JOIN application_email_evidence AS second_email
            ON second_email.workspace_id = first_email.workspace_id
           AND second_email.application_id = second.id
          WHERE first_email.workspace_id = first.workspace_id
            AND first_email.application_id = first.id
            AND first_email.message_id = second_email.message_id
        )
      )
  )`;

interface StoredApplicationAttentionFact {
  applicationConfirmationMissing: number;
  applicationId: string;
  appliedDateMissing: number;
  contactsMissing: number;
  duplicateRisk: number;
  emailEvidenceMissing: number;
  fieldConflicting: string;
  fieldInferredUnverified: string;
  fieldNotApplicable: string;
  fieldNotDisclosed: string;
  fieldStale: string;
  locationMissing: number;
  nextActionMissing: number;
  nextActionOverdue: number;
  originalAdvertMissing: number;
  salaryMissing: number;
  sourceUrlMissing: number;
  workArrangementMissing: number;
}

const applicationAttentionFactsSql = `${duplicateCandidatePairsSql},
  duplicate_application_ids AS (
    SELECT firstId AS application_id FROM candidate_pairs
    UNION
    SELECT secondId AS application_id FROM candidate_pairs
  ),
  provenance_ranked AS (
    SELECT
      provenance.*,
      row_number() OVER (
        PARTITION BY provenance.workspace_id, provenance.application_id,
                     provenance.field_name
        ORDER BY
          (provenance.verified_at IS NOT NULL) DESC,
          CASE provenance.source_type
            WHEN 'job_posting' THEN 400
            WHEN 'document' THEN 300
            WHEN 'email_evidence' THEN 200
            ELSE 100
          END DESC,
          provenance.observed_at DESC,
          provenance.confidence DESC,
          provenance.id DESC
      ) AS precedence_rank
    FROM application_field_provenance AS provenance
    WHERE provenance.workspace_id = @workspaceId
  ),
  selected_provenance AS (
    SELECT * FROM provenance_ranked WHERE precedence_rank = 1
  ),
  provenance_flags AS (
    SELECT
      selected.application_id AS applicationId,
      coalesce(group_concat(DISTINCT CASE
        WHEN selected.field_state = 'not_disclosed' THEN selected.field_name
      END), '') AS fieldNotDisclosed,
      coalesce(group_concat(DISTINCT CASE
        WHEN selected.field_state = 'not_applicable' THEN selected.field_name
      END), '') AS fieldNotApplicable,
      coalesce(group_concat(DISTINCT CASE
        WHEN selected.field_state = 'inferred'
         AND selected.verified_at IS NULL THEN selected.field_name
      END), '') AS fieldInferredUnverified,
      coalesce(group_concat(DISTINCT CASE
        WHEN selected.field_state = 'conflicting' OR (
          other.id IS NOT NULL AND other.value_json <> selected.value_json
          AND other.observed_at >= selected.observed_at
        ) THEN selected.field_name
      END), '') AS fieldConflicting,
      coalesce(group_concat(DISTINCT CASE
        WHEN other.id IS NOT NULL AND other.value_json <> selected.value_json
         AND other.observed_at < selected.observed_at THEN selected.field_name
      END), '') AS fieldStale
    FROM selected_provenance AS selected
    LEFT JOIN application_field_provenance AS other
      ON other.workspace_id = selected.workspace_id
     AND other.application_id = selected.application_id
     AND other.field_name = selected.field_name
     AND other.id <> selected.id
    GROUP BY selected.application_id
  ),
  attention_facts AS (
    SELECT
      applications.id AS applicationId,
      applications.status_reference_id AS statusId,
      statuses.is_terminal AS statusIsTerminal,
      CASE WHEN lower(statuses.label) LIKE '%interview%'
             OR lower(statuses.label) LIKE '%offer%'
        THEN 1 ELSE 0 END AS stagePriority,
      applications.applied_on AS appliedOn,
      applications.updated_at AS updatedAt,
      lower(
        applications.company_name || ' ' || applications.role_title || ' ' ||
        coalesce(applications.agency, '') || ' ' ||
        coalesce(applications.location, '') || ' ' ||
        coalesce(applications.notes, '')
      ) AS searchText,
      CASE WHEN statuses.is_terminal = 0
             AND applications.next_action IS NOT NULL
             AND applications.next_action_due < @asOfDate
        THEN 1 ELSE 0 END AS nextActionOverdue,
      CASE WHEN statuses.is_terminal = 0
             AND applications.next_action IS NULL
        THEN 1 ELSE 0 END AS nextActionMissing,
      CASE WHEN applications.salary IS NULL
             OR length(trim(applications.salary)) = 0
        THEN 1 ELSE 0 END AS salaryMissing,
      CASE WHEN applications.location IS NULL
             OR length(trim(applications.location)) = 0
        THEN 1 ELSE 0 END AS locationMissing,
      CASE WHEN applications.work_arrangement IS NULL
        THEN 1 ELSE 0 END AS workArrangementMissing,
      CASE WHEN applications.source_url IS NULL
             OR length(trim(applications.source_url)) = 0
        THEN 1 ELSE 0 END AS sourceUrlMissing,
      CASE WHEN applications.applied_on IS NULL THEN 1 ELSE 0 END
        AS appliedDateMissing,
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM application_contacts AS contacts
        WHERE contacts.workspace_id = applications.workspace_id
          AND contacts.application_id = applications.id
      ) THEN 1 ELSE 0 END AS contactsMissing,
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM application_email_evidence AS email
        WHERE email.workspace_id = applications.workspace_id
          AND email.application_id = applications.id
      ) THEN 1 ELSE 0 END AS emailEvidenceMissing,
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM application_email_evidence AS email
        WHERE email.workspace_id = applications.workspace_id
          AND email.application_id = applications.id
          AND email.evidence_type = 'original_advert'
      ) THEN 1 ELSE 0 END AS originalAdvertMissing,
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM application_email_evidence AS email
        WHERE email.workspace_id = applications.workspace_id
          AND email.application_id = applications.id
          AND email.evidence_type = 'application_confirmation'
      ) THEN 1 ELSE 0 END AS applicationConfirmationMissing,
      CASE WHEN duplicates.application_id IS NULL THEN 0 ELSE 1 END
        AS duplicateRisk,
      coalesce(provenance.fieldNotDisclosed, '') AS fieldNotDisclosed,
      coalesce(provenance.fieldNotApplicable, '') AS fieldNotApplicable,
      coalesce(provenance.fieldConflicting, '') AS fieldConflicting,
      coalesce(provenance.fieldStale, '') AS fieldStale,
      coalesce(provenance.fieldInferredUnverified, '')
        AS fieldInferredUnverified
    FROM applications AS applications
    JOIN reference_values AS statuses
      ON statuses.workspace_id = applications.workspace_id
     AND statuses.id = applications.status_reference_id
    LEFT JOIN duplicate_application_ids AS duplicates
      ON duplicates.application_id = applications.id
    LEFT JOIN provenance_flags AS provenance
      ON provenance.applicationId = applications.id
    WHERE applications.workspace_id = @workspaceId
      AND applications.deleted_at IS NULL
  )`;

const applicationFieldNames = new Set<ApplicationFieldName>([
  "agency",
  "appliedOn",
  "companyName",
  "location",
  "roleTitle",
  "salary",
  "sourceUrl",
  "workArrangement",
]);

function attentionFields(value: string): ApplicationFieldName[] {
  if (!value) return [];
  return value
    .split(",")
    .filter((field): field is ApplicationFieldName =>
      applicationFieldNames.has(field as ApplicationFieldName),
    )
    .sort();
}

function attentionSignals(
  row: StoredApplicationAttentionFact,
): ApplicationAttentionSignals {
  return {
    applicationConfirmationMissing: row.applicationConfirmationMissing === 1,
    appliedDateMissing: row.appliedDateMissing === 1,
    contactsMissing: row.contactsMissing === 1,
    duplicateRisk: row.duplicateRisk === 1,
    emailEvidenceMissing: row.emailEvidenceMissing === 1,
    fieldConflicting: attentionFields(row.fieldConflicting),
    fieldInferredUnverified: attentionFields(row.fieldInferredUnverified),
    fieldNotApplicable: attentionFields(row.fieldNotApplicable),
    fieldNotDisclosed: attentionFields(row.fieldNotDisclosed),
    fieldStale: attentionFields(row.fieldStale),
    locationMissing: row.locationMissing === 1,
    nextActionMissing: row.nextActionMissing === 1,
    nextActionOverdue: row.nextActionOverdue === 1,
    originalAdvertMissing: row.originalAdvertMissing === 1,
    salaryMissing: row.salaryMissing === 1,
    sourceUrlMissing: row.sourceUrlMissing === 1,
    workArrangementMissing: row.workArrangementMissing === 1,
  };
}

const attentionMissingFieldConditions: Record<
  ApplicationAttentionMissingField,
  string
> = {
  applied_date: "facts.appliedDateMissing = 1",
  contacts: "facts.contactsMissing = 1",
  email_evidence: "facts.emailEvidenceMissing = 1",
  location: "facts.locationMissing = 1",
  salary: "facts.salaryMissing = 1",
  source_url: "facts.sourceUrlMissing = 1",
  work_arrangement: "facts.workArrangementMissing = 1",
};
const attentionMissingEvidenceConditions: Record<
  ApplicationAttentionMissingEvidence,
  string
> = {
  application_confirmation: "facts.applicationConfirmationMissing = 1",
  original_advert: "facts.originalAdvertMissing = 1",
};
const attentionFieldStateConditions: Record<
  ApplicationAttentionFieldState,
  string
> = {
  conflicting: "length(facts.fieldConflicting) > 0",
  inferred_unverified: "length(facts.fieldInferredUnverified) > 0",
  missing: `(
    facts.salaryMissing = 1 OR facts.locationMissing = 1 OR
    facts.workArrangementMissing = 1 OR facts.sourceUrlMissing = 1 OR
    facts.appliedDateMissing = 1 OR facts.contactsMissing = 1 OR
    facts.emailEvidenceMissing = 1 OR facts.originalAdvertMissing = 1 OR
    facts.applicationConfirmationMissing = 1
  )`,
  not_applicable: "length(facts.fieldNotApplicable) > 0",
  not_disclosed: "length(facts.fieldNotDisclosed) > 0",
  stale: "length(facts.fieldStale) > 0",
};
const attentionReasonConditions: Record<
  ApplicationAttentionReasonCode,
  string
> = {
  application_confirmation_missing: "facts.applicationConfirmationMissing = 1",
  applied_date_missing: "facts.appliedDateMissing = 1",
  contacts_missing: "facts.contactsMissing = 1",
  duplicate_risk: "facts.duplicateRisk = 1",
  email_evidence_missing: "facts.emailEvidenceMissing = 1",
  field_conflicting: "length(facts.fieldConflicting) > 0",
  field_inferred_unverified: "length(facts.fieldInferredUnverified) > 0",
  field_not_applicable: "length(facts.fieldNotApplicable) > 0",
  field_not_disclosed: "length(facts.fieldNotDisclosed) > 0",
  field_stale: "length(facts.fieldStale) > 0",
  location_missing: "facts.locationMissing = 1",
  next_action_missing: "facts.nextActionMissing = 1",
  next_action_overdue: "facts.nextActionOverdue = 1",
  original_advert_missing: "facts.originalAdvertMissing = 1",
  salary_missing: "facts.salaryMissing = 1",
  source_url_missing: "facts.sourceUrlMissing = 1",
  work_arrangement_missing: "facts.workArrangementMissing = 1",
};
const anyAttentionReasonCondition = `(${Object.values(
  attentionReasonConditions,
).join(" OR ")})`;

function escapeLikePattern(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function contactIdentity(contact: ApplicationContact): string {
  if (contact.email) return `email:${normalizedText(contact.email)}`;
  if (contact.phone) {
    return `phone:${contact.phone.replace(/[^\d+]/g, "")}`;
  }
  return `name:${normalizedText(contact.name)}:${normalizedText(contact.role ?? "")}`;
}

function linkIdentity(link: ApplicationLink): string {
  return canonicalUrl(link.url);
}

function relationPreview<Record>(
  source: Record[],
  target: Record[],
  explicit: Record[] | undefined,
  maximum: number | undefined,
  identityKey: (record: Record) => string,
): ApplicationMergeRelationshipPreview<Record> {
  const targetByIdentity = new Map(
    target.map((record) => [identityKey(record), record]),
  );
  const additions = source.filter(
    (record) => !targetByIdentity.has(identityKey(record)),
  );
  const conflicts = source.flatMap((record) => {
    const targetRecord = targetByIdentity.get(identityKey(record));
    return targetRecord && !isDeepStrictEqual(targetRecord, record)
      ? [
          {
            key: identityKey(record),
            source: record,
            target: targetRecord,
          },
        ]
      : [];
  });
  const provisional = [...target, ...additions];
  const requiresSelection =
    conflicts.length > 0 ||
    (maximum !== undefined && provisional.length > maximum);
  const allowed = [...target, ...source];
  const explicitIsValid =
    explicit !== undefined &&
    explicit.length <= (maximum ?? Number.MAX_SAFE_INTEGER) &&
    new Set(explicit.map(identityKey)).size === explicit.length &&
    explicit.every((record) =>
      allowed.some((allowedRecord) => isDeepStrictEqual(record, allowedRecord)),
    );
  return {
    additions,
    conflicts,
    requiresResolution: requiresSelection && !explicitIsValid,
    result: requiresSelection && explicitIsValid ? explicit : provisional,
    source,
    target,
  };
}

function appliedDateDifference(
  first: string | null,
  second: string | null,
): number | undefined {
  if (!first || !second) return undefined;
  return Math.abs(
    (new Date(`${first}T00:00:00.000Z`).getTime() -
      new Date(`${second}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );
}

function mergeFieldValue(
  application: ApplicationRecord,
  field: ApplicationMergeField,
): ApplicationMergeFieldValue {
  return application[field];
}

function publicApplicationSelect(): string {
  return `SELECT
            applications.id,
            applications.agency,
            applications.company_name AS companyName,
            applications.role_title AS roleTitle,
            statuses.id AS statusId,
            statuses.label AS status,
            statuses.is_terminal AS statusIsTerminal,
            sources.id AS sourceId,
            sources.label AS source,
            role_types.id AS roleTypeId,
            role_types.label AS roleType,
            applications.location,
            applications.source_url AS sourceUrl,
            applications.applied_on AS appliedOn,
            applications.next_action AS nextAction,
            applications.next_action_due AS nextActionDue,
            applications.notes,
            graph_assignments.connection_id AS outlookGraphConnectionId,
            graph_connections.name AS outlookGraphConnectionName,
            applications.rating,
            applications.salary,
            applications.salary_minimum_amount AS salaryMinimum,
            applications.salary_maximum_amount AS salaryMaximum,
            applications.salary_currency AS salaryCurrency,
            applications.salary_period AS salaryPeriod,
            applications.salary_disclosed AS salaryDisclosed,
            applications.salary_negotiable AS salaryNegotiable,
            applications.created_at AS createdAt,
            applications.updated_at AS updatedAt,
            applications.work_arrangement AS workArrangement,
            applications.work_arrangement_text AS workArrangementText,
            applications.office_days_per_week AS officeDaysPerWeek,
            applications.remote_days_per_week AS remoteDaysPerWeek
          FROM applications AS applications
          JOIN reference_values AS statuses
            ON statuses.id = applications.status_reference_id
          LEFT JOIN reference_values AS sources
            ON sources.id = applications.source_reference_id
          LEFT JOIN reference_values AS role_types
            ON role_types.id = applications.role_type_reference_id
          LEFT JOIN application_outlook_graph_connections AS graph_assignments
            ON graph_assignments.workspace_id = applications.workspace_id
           AND graph_assignments.application_id = applications.id
          LEFT JOIN outlook_graph_connections AS graph_connections
            ON graph_connections.workspace_id = graph_assignments.workspace_id
           AND graph_connections.id = graph_assignments.connection_id`;
}

function provenanceSource(
  stored: StoredApplicationFieldProvenance,
): ApplicationFieldProvenanceSource {
  switch (stored.sourceType) {
    case "document":
      return { documentId: stored.sourceDocumentId!, type: "document" };
    case "email_evidence":
      return {
        emailEvidenceId: stored.sourceEmailEvidenceId!,
        type: "email_evidence",
      };
    case "job_posting":
      return {
        jobPostingId: stored.sourceJobPostingId!,
        type: "job_posting",
      };
    case "imported":
      return { type: "imported" };
  }
}

function publicProvenance(
  stored: StoredApplicationFieldProvenance,
  relationship: ApplicationFieldProvenanceRecord["relationship"],
): ApplicationFieldProvenanceRecord {
  return {
    applicationId: stored.applicationId,
    confidence: stored.confidence,
    createdAt: stored.createdAt,
    field: stored.field,
    fieldState: stored.fieldState,
    id: stored.id,
    idempotencyKey: stored.idempotencyKey,
    observedAt: stored.observedAt,
    relationship,
    source: provenanceSource(stored),
    value: JSON.parse(stored.valueJson) as boolean | number | string | null,
    verifiedAt: stored.verifiedAt,
    verifiedByDisplayName: stored.verifiedByDisplayName,
    verifiedByUserId: stored.verifiedByUserId,
  };
}

export class SqliteApplicationsRepository implements ApplicationsRepository {
  public constructor(private readonly database: Database.Database) {}

  private findStoredApplicationIncludingDeleted(
    workspaceId: string,
    applicationId: string,
  ): StoredApplicationRecord | undefined {
    return this.database
      .prepare(
        `${publicApplicationSelect()}
         WHERE applications.workspace_id = ? AND applications.id = ?`,
      )
      .get(workspaceId, applicationId) as StoredApplicationRecord | undefined;
  }

  private applicationDeletedAt(
    workspaceId: string,
    applicationId: string,
  ): string | null | undefined {
    return this.database
      .prepare(
        `SELECT deleted_at
         FROM applications
         WHERE workspace_id = ? AND id = ?`,
      )
      .pluck()
      .get(workspaceId, applicationId) as string | null | undefined;
  }

  private findApplicationMerge(
    workspaceId: string,
    sourceApplicationId: string,
  ): StoredApplicationMerge | undefined {
    return this.database
      .prepare(
        `SELECT
           merges.id,
           merges.source_application_id AS sourceApplicationId,
           merges.target_application_id AS targetApplicationId,
           merges.source_updated_at AS sourceUpdatedAt,
           merges.target_updated_at AS targetUpdatedAt,
           merges.resolutions_json AS resolutionsJson,
           merges.recovery_snapshot_json AS recoverySnapshotJson,
           merges.merged_at AS mergedAt,
           merges.actor_user_id AS actorUserId,
           actors.display_name AS actorDisplayName
         FROM application_merges AS merges
         JOIN users AS actors ON actors.id = merges.actor_user_id
         WHERE merges.workspace_id = ? AND merges.source_application_id = ?`,
      )
      .get(workspaceId, sourceApplicationId) as
      StoredApplicationMerge | undefined;
  }

  private findCurrentApplicationDeletion(
    workspaceId: string,
    applicationId: string,
  ): StoredApplicationDeletion | undefined {
    return this.database
      .prepare(
        `SELECT
           deletions.id,
           deletions.application_id AS applicationId,
           deletions.workspace_id AS workspaceId,
           deletions.actor_user_id AS actorUserId,
           actors.display_name AS actorDisplayName,
           deletions.reason,
           deletions.deleted_at AS deletedAt,
           deletions.merge_id AS mergeId,
           deletions.recovery_snapshot_json AS recoverySnapshotJson,
           merges.target_application_id AS targetApplicationId,
           targets.company_name AS targetCompanyName,
           targets.role_title AS targetRoleTitle
         FROM applications
         JOIN application_deletions AS deletions
           ON deletions.workspace_id = applications.workspace_id
          AND deletions.application_id = applications.id
          AND deletions.deleted_at = applications.deleted_at
         JOIN users AS actors ON actors.id = deletions.actor_user_id
         LEFT JOIN application_merges AS merges
           ON merges.workspace_id = deletions.workspace_id
          AND merges.id = deletions.merge_id
         LEFT JOIN applications AS targets
           ON targets.workspace_id = merges.workspace_id
          AND targets.id = merges.target_application_id
         WHERE applications.workspace_id = ? AND applications.id = ?
           AND applications.deleted_at IS NOT NULL`,
      )
      .get(workspaceId, applicationId) as StoredApplicationDeletion | undefined;
  }

  private publicApplicationDeletion(
    stored: StoredApplicationDeletion,
    application: ApplicationRecord,
  ): DeletedApplicationRecord {
    return {
      actorDisplayName: stored.actorDisplayName,
      application,
      deletedAt: stored.deletedAt,
      id: stored.id,
      merge:
        stored.mergeId === null ||
        stored.targetApplicationId === null ||
        stored.targetCompanyName === null ||
        stored.targetRoleTitle === null
          ? null
          : {
              id: stored.mergeId,
              targetApplicationId: stored.targetApplicationId,
              targetCompanyName: stored.targetCompanyName,
              targetRoleTitle: stored.targetRoleTitle,
            },
      reason: stored.reason,
    };
  }

  private deletionRecoverySnapshot(
    workspaceId: string,
    application: ApplicationRecord,
  ): ApplicationDeletionRecoverySnapshot {
    return {
      applicationUpdatedAt: application.updatedAt,
      documentIds: sortedUnique(
        this.listApplicationDocuments(workspaceId, application.id).map(
          ({ id }) => id,
        ),
      ),
      emailEvidence: this.listEmailEvidence(workspaceId, application.id)
        .map(({ id, updatedAt }) => ({ id, updatedAt }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      jobPostings: this.listJobPostings(workspaceId, application.id)
        .map(({ id, updatedAt }) => ({ id, updatedAt }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      outlookGraphConnectionId: application.outlookGraphConnectionId,
      version: 1,
    };
  }

  private mergeRecoverySnapshot(
    workspaceId: string,
    source: ApplicationRecord,
    target: ApplicationRecord,
    survivor: ApplicationRecord,
    mergedAt: string,
  ): ApplicationMergeRecoverySnapshot {
    return {
      sourceBefore: source,
      sourceDocumentIds: sortedUnique(
        this.listApplicationDocuments(workspaceId, source.id).map(
          ({ id }) => id,
        ),
      ),
      sourceEmailEvidence: this.listEmailEvidence(workspaceId, source.id)
        .map(({ id, updatedAt }) => ({ id, updatedAt }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      sourceJobPostings: this.listJobPostings(workspaceId, source.id)
        .map(({ id, updatedAt }) => ({ id, updatedAt }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      targetAfter: { ...survivor, updatedAt: mergedAt },
      targetBefore: target,
      targetDocumentIds: sortedUnique(
        this.listApplicationDocuments(workspaceId, target.id).map(
          ({ id }) => id,
        ),
      ),
      version: 1,
    };
  }

  private applicationRecoveryRelationships(
    workspaceId: string,
    application: ApplicationRecord,
  ): ApplicationRecoveryRelationshipSummary {
    return {
      contacts: application.contacts.length,
      documents: this.listApplicationDocuments(workspaceId, application.id)
        .length,
      emailEvidence: this.listEmailEvidence(workspaceId, application.id).length,
      jobPostings: this.listJobPostings(workspaceId, application.id).length,
      links: application.links.length,
      outlookGraphConnectionId: application.outlookGraphConnectionId,
    };
  }

  private inactiveReferenceConflicts(
    workspaceId: string,
    applications: ApplicationRecord[],
  ): ApplicationRecoveryConflict[] {
    const conflicts: ApplicationRecoveryConflict[] = [];
    const seen = new Set<string>();
    const references = applications.flatMap((application) => [
      {
        field: "status" as const,
        id: application.statusId,
        label: `Status “${application.status}”`,
      },
      ...(application.sourceId === null
        ? []
        : [
            {
              field: "source" as const,
              id: application.sourceId,
              label: `Source “${application.source ?? application.sourceId}”`,
            },
          ]),
      ...(application.roleTypeId === null
        ? []
        : [
            {
              field: "role_type" as const,
              id: application.roleTypeId,
              label: `Role type “${application.roleType ?? application.roleTypeId}”`,
            },
          ]),
    ]);
    for (const reference of references) {
      const key = `${reference.field}:${reference.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const active = this.database
        .prepare(
          `SELECT is_active FROM reference_values
           WHERE workspace_id = ? AND id = ?`,
        )
        .pluck()
        .get(workspaceId, reference.id);
      if (active !== 1) {
        conflicts.push({
          code: "reference_inactive",
          field: reference.field,
          message: `${reference.label} is no longer active.`,
          recordId: reference.id,
        });
      }
    }
    return conflicts;
  }

  private missingOutlookGraphConnectionConflicts(
    workspaceId: string,
    applications: ApplicationRecord[],
  ): ApplicationRecoveryConflict[] {
    const conflicts: ApplicationRecoveryConflict[] = [];
    const seen = new Set<string>();
    for (const application of applications) {
      const connectionId = application.outlookGraphConnectionId;
      if (connectionId === null || seen.has(connectionId)) continue;
      seen.add(connectionId);
      const exists = this.database
        .prepare(
          `SELECT 1 FROM outlook_graph_connections
           WHERE workspace_id = ? AND id = ?`,
        )
        .pluck()
        .get(workspaceId, connectionId);
      if (exists !== 1) {
        conflicts.push({
          code: "outlook_connection_changed",
          field: null,
          message: `The Microsoft Graph connection required by ${application.companyName} is no longer available.`,
          recordId: connectionId,
        });
      }
    }
    return conflicts;
  }

  private applicationForMerge(
    workspaceId: string,
    applicationId: string,
    role: "source" | "target",
    allowMergedSource = false,
  ): ApplicationRecord {
    const stored = this.findStoredApplicationIncludingDeleted(
      workspaceId,
      applicationId,
    );
    if (!stored) throw new ApplicationMergeNotFoundError();
    const deletedAt = this.applicationDeletedAt(workspaceId, applicationId);
    if (deletedAt !== null) {
      const merge = this.findApplicationMerge(workspaceId, applicationId);
      if (role === "source" && merge && allowMergedSource) {
        const [application] = this.hydrateApplications(workspaceId, [stored]);
        if (!application) throw new ApplicationMergeNotFoundError();
        return application;
      }
      throw new ApplicationMergeStateError(
        role === "source" && merge
          ? "application_already_merged"
          : role === "source"
            ? "application_merge_deleted"
            : "application_merge_target_unavailable",
      );
    }
    const [application] = this.hydrateApplications(workspaceId, [stored]);
    if (!application) throw new ApplicationMergeNotFoundError();
    return application;
  }

  private listApplicationEventsIncludingMerged(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEvent[] {
    return this.database
      .prepare(
        `SELECT
           events.id,
           events.event_type AS type,
           events.from_status AS fromStatus,
           events.to_status AS toStatus,
           events.occurred_at AS occurredAt,
           events.processed_at AS processedAt,
           events.summary,
           events.source_email_evidence_id AS sourceEmailEvidenceId,
           events.source_email_message_id AS sourceEmailMessageId,
           events.status_override_reason AS statusOverrideReason,
           events.idempotency_key AS idempotencyKey,
           events.supersedes_event_id AS supersedesEventId,
           events.correction_reason AS correctionReason,
           actors.display_name AS actorDisplayName
         FROM application_events AS events
         JOIN users AS actors ON actors.id = events.actor_user_id
         WHERE events.workspace_id = ? AND events.application_id = ?
         ORDER BY events.occurred_at DESC, events.sequence DESC`,
      )
      .all(workspaceId, applicationId) as ApplicationEvent[];
  }

  private listJobPostings(
    workspaceId: string,
    applicationId: string,
  ): ApplicationJobPosting[] {
    return this.database
      .prepare(
        `SELECT
           id,
           application_id AS applicationId,
           provider,
           external_posting_id AS externalPostingId,
           canonical_url AS canonicalUrl,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM application_job_postings
         WHERE workspace_id = ? AND application_id = ?
         ORDER BY created_at, id`,
      )
      .all(workspaceId, applicationId) as ApplicationJobPosting[];
  }

  private listEmailEvidence(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEmailEvidence[] {
    return this.database
      .prepare(
        `SELECT
           id,
           application_id AS applicationId,
           evidence_type AS evidenceType,
           message_id AS messageId,
           web_url AS webUrl,
           received_at AS receivedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM application_email_evidence
         WHERE workspace_id = ? AND application_id = ?
         ORDER BY received_at DESC, id`,
      )
      .all(workspaceId, applicationId) as ApplicationEmailEvidence[];
  }

  private listApplicationDocuments(
    workspaceId: string,
    applicationId: string,
  ): DocumentRecord[] {
    const stored = this.database
      .prepare(
        `SELECT
           documents.id,
           documents.original_filename AS originalFilename,
           documents.media_type AS mediaType,
           documents.created_at AS createdAt,
           reference_values.id AS documentTypeId,
           reference_values.label AS documentType,
           file_objects.byte_size AS byteSize,
           users.display_name AS uploadedByDisplayName
         FROM application_documents
         JOIN documents
           ON documents.workspace_id = application_documents.workspace_id
          AND documents.id = application_documents.document_id
         JOIN reference_values
           ON reference_values.id = documents.document_type_reference_id
          AND reference_values.workspace_id = documents.workspace_id
         JOIN file_objects ON file_objects.sha256 = documents.file_sha256
         JOIN users ON users.id = documents.uploaded_by_user_id
         WHERE application_documents.workspace_id = ?
           AND application_documents.application_id = ?
         ORDER BY documents.created_at DESC, documents.id DESC`,
      )
      .all(workspaceId, applicationId) as StoredMergeDocument[];
    return stored.map((document) => {
      const associations = this.database
        .prepare(
          `SELECT
             applications.id,
             applications.company_name AS companyName,
             applications.role_title AS roleTitle
           FROM application_documents
           JOIN applications
             ON applications.workspace_id = application_documents.workspace_id
            AND applications.id = application_documents.application_id
           WHERE application_documents.workspace_id = ?
             AND application_documents.document_id = ?
           ORDER BY applications.company_name COLLATE NOCASE,
                    applications.role_title COLLATE NOCASE,
                    applications.id`,
        )
        .all(workspaceId, document.id) as StoredDocumentApplication[];
      return {
        ...document,
        applications: associations,
      };
    });
  }

  private duplicateReasons(
    workspaceId: string,
    first: ApplicationRecord,
    second: ApplicationRecord,
  ): ApplicationDuplicateReason[] {
    const reasons: ApplicationDuplicateReason[] = [];
    const firstPostings = this.listJobPostings(workspaceId, first.id);
    const secondPostings = this.listJobPostings(workspaceId, second.id);
    const postingId = firstPostings.find(
      (candidate) =>
        candidate.externalPostingId !== null &&
        secondPostings.some(
          (other) =>
            other.provider === candidate.provider &&
            other.externalPostingId === candidate.externalPostingId,
        ),
    );
    if (postingId) {
      reasons.push({
        detail: `${postingId.provider}:${postingId.externalPostingId ?? ""}`,
        kind: "posting_id",
      });
    }
    const canonicalPosting = firstPostings.find(
      (candidate) =>
        candidate.canonicalUrl !== null &&
        secondPostings.some(
          (other) =>
            other.canonicalUrl !== null &&
            canonicalUrl(other.canonicalUrl) ===
              canonicalUrl(candidate.canonicalUrl ?? ""),
        ),
    );
    const sourceUrlMatch =
      first.sourceUrl !== null &&
      second.sourceUrl !== null &&
      canonicalUrl(first.sourceUrl) === canonicalUrl(second.sourceUrl);
    if (canonicalPosting?.canonicalUrl || sourceUrlMatch) {
      reasons.push({
        detail:
          canonicalPosting?.canonicalUrl ?? canonicalUrl(first.sourceUrl ?? ""),
        kind: "canonical_url",
      });
    }
    const firstEvidence = this.listEmailEvidence(workspaceId, first.id);
    const secondMessageIds = new Set(
      this.listEmailEvidence(workspaceId, second.id).map(
        ({ messageId }) => messageId,
      ),
    );
    const emailEvidence = firstEvidence.find(({ messageId }) =>
      secondMessageIds.has(messageId),
    );
    if (emailEvidence) {
      reasons.push({
        detail: emailEvidence.messageId,
        kind: "email_message_id",
      });
    }
    if (
      normalizedText(first.companyName) ===
        normalizedText(second.companyName) &&
      normalizedText(first.roleTitle) === normalizedText(second.roleTitle)
    ) {
      reasons.push({
        detail: `${first.companyName} · ${first.roleTitle}`,
        kind: "company_title",
      });
    }
    if (
      first.agency !== null &&
      second.agency !== null &&
      normalizedText(first.agency) === normalizedText(second.agency)
    ) {
      reasons.push({ detail: first.agency, kind: "agency" });
    }
    if (
      first.location !== null &&
      second.location !== null &&
      normalizedText(first.location) === normalizedText(second.location)
    ) {
      reasons.push({ detail: first.location, kind: "location" });
    }
    const dateDifference = appliedDateDifference(
      first.appliedOn,
      second.appliedOn,
    );
    if (dateDifference !== undefined && dateDifference <= 7) {
      reasons.push({
        detail: `${String(dateDifference)} day${dateDifference === 1 ? "" : "s"} apart`,
        kind: "applied_date",
      });
    }
    const matchingContact = first.contacts.find((contact) =>
      second.contacts.some(
        (other) =>
          (contact.email !== null &&
            other.email !== null &&
            normalizedText(contact.email) === normalizedText(other.email)) ||
          (contact.phone !== null &&
            other.phone !== null &&
            contact.phone.replace(/\s+/g, "") ===
              other.phone.replace(/\s+/g, "")) ||
          (normalizedText(contact.name) === normalizedText(other.name) &&
            normalizedText(contact.role ?? "") ===
              normalizedText(other.role ?? "")),
      ),
    );
    if (matchingContact) {
      reasons.push({ detail: matchingContact.name, kind: "contact" });
    }
    return reasons;
  }

  public auditDuplicateApplications(
    workspaceId: string,
    input: AuditDuplicateApplicationsInput,
  ): ApplicationDuplicateAudit {
    const total = this.database
      .prepare(
        `${duplicateCandidatePairsSql} SELECT count(*) FROM candidate_pairs`,
      )
      .pluck()
      .get({ workspaceId }) as number;
    const pairs = this.database
      .prepare(
        `${duplicateCandidatePairsSql}
         SELECT firstId, secondId
         FROM candidate_pairs
         ORDER BY firstId, secondId
         LIMIT @limit OFFSET @offset`,
      )
      .all({ limit: input.limit, offset: input.offset, workspaceId }) as {
      firstId: string;
      secondId: string;
    }[];
    const candidates = pairs.map(({ firstId, secondId }) => {
      const first = this.applicationForMerge(workspaceId, firstId, "source");
      const second = this.applicationForMerge(workspaceId, secondId, "target");
      const reasons = this.duplicateReasons(workspaceId, first, second);
      const reasonKinds = new Set(reasons.map(({ kind }) => kind));
      const definite = reasons.some(({ kind }) =>
        ["canonical_url", "email_message_id", "posting_id"].includes(kind),
      );
      const probable =
        (reasonKinds.has("company_title") && reasons.length > 1) ||
        (reasonKinds.has("contact") && reasonKinds.has("applied_date"));
      return {
        applications: [first, second],
        confidence: definite ? "definite" : probable ? "probable" : "possible",
        reasons,
      } satisfies ApplicationDuplicateCandidate;
    });
    const nextOffset = input.offset + candidates.length;
    return {
      candidates,
      nextOffset: nextOffset < total ? nextOffset : null,
      offset: input.offset,
      returned: candidates.length,
      total,
    };
  }

  private publicApplicationMerge(
    merge: StoredApplicationMerge,
  ): ApplicationMergeLineage {
    return {
      actorDisplayName: merge.actorDisplayName,
      id: merge.id,
      mergedAt: merge.mergedAt,
      sourceApplicationId: merge.sourceApplicationId,
      sourceUpdatedAt: merge.sourceUpdatedAt,
      targetApplicationId: merge.targetApplicationId,
      targetUpdatedAt: merge.targetUpdatedAt,
    };
  }

  private buildApplicationMergePreview(
    workspaceId: string,
    sourceApplicationId: string,
    targetApplicationId: string,
    resolutions?: ApplicationMergeResolutions,
    allowMergedSource = false,
  ): ApplicationMergePreview {
    const source = this.applicationForMerge(
      workspaceId,
      sourceApplicationId,
      "source",
      allowMergedSource,
    );
    const target = this.applicationForMerge(
      workspaceId,
      targetApplicationId,
      "target",
    );
    const survivor: ApplicationRecord = {
      ...target,
      contacts: [...target.contacts],
      links: [...target.links],
    };
    const mutableSurvivor = survivor as unknown as Record<
      ApplicationMergeField,
      ApplicationMergeFieldValue
    >;
    const fieldConflicts: ApplicationMergeFieldConflict[] = [];
    const unresolvedConflicts: string[] = [];
    for (const field of mergeFields) {
      const sourceValue = mergeFieldValue(source, field);
      const targetValue = mergeFieldValue(target, field);
      if (sourceValue === targetValue) {
        mutableSurvivor[field] = targetValue;
        continue;
      }
      if (sourceValue === null) {
        mutableSurvivor[field] = targetValue;
        continue;
      }
      if (targetValue === null) {
        mutableSurvivor[field] = sourceValue;
        continue;
      }
      const resolution = resolutions?.fields?.[field] ?? null;
      const resolvedValue = resolution === "source" ? sourceValue : targetValue;
      mutableSurvivor[field] = resolvedValue;
      fieldConflicts.push({
        field,
        resolution,
        resolvedValue,
        sourceValue,
        targetValue,
      });
      if (!resolution) unresolvedConflicts.push(`field:${field}`);
    }
    survivor.roleType =
      survivor.roleTypeId === source.roleTypeId
        ? source.roleType
        : target.roleType;
    survivor.source =
      survivor.sourceId === source.sourceId ? source.source : target.source;
    survivor.outlookGraphConnectionName =
      survivor.outlookGraphConnectionId === null
        ? null
        : survivor.outlookGraphConnectionId === source.outlookGraphConnectionId
          ? source.outlookGraphConnectionName
          : target.outlookGraphConnectionName;
    survivor.salaryDetails =
      survivor.salary === source.salary && survivor.salary !== target.salary
        ? source.salaryDetails
        : (target.salaryDetails ?? source.salaryDetails);
    survivor.workArrangementDetails =
      survivor.workArrangement === source.workArrangement &&
      survivor.workArrangement !== target.workArrangement
        ? source.workArrangementDetails
        : (target.workArrangementDetails ?? source.workArrangementDetails);
    if (survivor.statusId === source.statusId) {
      survivor.status = source.status;
      survivor.statusIsTerminal = source.statusIsTerminal;
    } else {
      survivor.status = target.status;
      survivor.statusIsTerminal = target.statusIsTerminal;
    }

    const explicitContacts = resolutions?.contacts?.map((contact) => ({
      email: contact.email ?? null,
      name: contact.name,
      phone: contact.phone ?? null,
      role: contact.role ?? null,
    }));
    const contacts = relationPreview(
      source.contacts,
      target.contacts,
      explicitContacts,
      maximumApplicationRelations,
      contactIdentity,
    );
    const links = relationPreview(
      source.links,
      target.links,
      resolutions?.links,
      maximumApplicationRelations,
      linkIdentity,
    );
    if (contacts.requiresResolution) {
      unresolvedConflicts.push("relationship:contacts");
    }
    if (links.requiresResolution) {
      unresolvedConflicts.push("relationship:links");
    }
    survivor.contacts = contacts.result;
    survivor.links = links.result;

    const documents = relationPreview(
      this.listApplicationDocuments(workspaceId, source.id),
      this.listApplicationDocuments(workspaceId, target.id),
      undefined,
      undefined,
      ({ id }) => id,
    );
    const emailEvidence = relationPreview(
      this.listEmailEvidence(workspaceId, source.id),
      this.listEmailEvidence(workspaceId, target.id),
      undefined,
      undefined,
      ({ id }) => id,
    );
    const jobPostings = relationPreview(
      this.listJobPostings(workspaceId, source.id),
      this.listJobPostings(workspaceId, target.id),
      undefined,
      undefined,
      ({ id }) => id,
    );
    const informationNotRetained: string[] = [];
    if (contacts.conflicts.length > 0) {
      informationNotRetained.push(
        `${String(contacts.conflicts.length)} overlapping contact record(s) require one version to be selected`,
      );
    }
    const contactUnionCount =
      contacts.target.length + contacts.additions.length;
    if (contacts.result.length < contactUnionCount) {
      informationNotRetained.push(
        `${String(contactUnionCount - contacts.result.length)} contact record(s) are not selected`,
      );
    }
    if (links.conflicts.length > 0) {
      informationNotRetained.push(
        `${String(links.conflicts.length)} overlapping link record(s) require one label to be selected`,
      );
    }
    const linkUnionCount = links.target.length + links.additions.length;
    if (links.result.length < linkUnionCount) {
      informationNotRetained.push(
        `${String(linkUnionCount - links.result.length)} link record(s) are not selected`,
      );
    }
    return {
      contacts,
      documents,
      emailEvidence,
      fieldConflicts,
      history: {
        sourceEvents: this.listApplicationEventsIncludingMerged(
          workspaceId,
          source.id,
        ),
        targetEvents: this.listApplicationEventsIncludingMerged(
          workspaceId,
          target.id,
        ),
      },
      informationNotRetained,
      jobPostings,
      links,
      safeToApply: unresolvedConflicts.length === 0,
      source,
      survivor,
      target,
      unresolvedConflicts,
    };
  }

  public previewApplicationMerge(
    workspaceId: string,
    sourceApplicationId: string,
    targetApplicationId: string,
    resolutions?: ApplicationMergeResolutions,
  ): ApplicationMergePreview {
    if (sourceApplicationId === targetApplicationId) {
      throw new ApplicationMergeNotFoundError();
    }
    return this.buildApplicationMergePreview(
      workspaceId,
      sourceApplicationId,
      targetApplicationId,
      resolutions,
    );
  }

  public mergeApplications(
    input: ApplyApplicationMergeRecord,
  ): ApplicationMergeResult {
    const merge = this.database.transaction(() => {
      const existing = this.findApplicationMerge(
        input.workspaceId,
        input.sourceApplicationId,
      );
      if (existing) {
        const recovered = this.database
          .prepare(
            `SELECT 1 FROM application_merge_recoveries
             WHERE workspace_id = ? AND merge_id = ?`,
          )
          .pluck()
          .get(input.workspaceId, existing.id);
        if (recovered === 1) {
          throw new ApplicationMergeStateError("application_already_merged");
        }
        if (existing.targetApplicationId !== input.targetApplicationId) {
          throw new ApplicationMergeStateError("application_already_merged");
        }
        const storedResolutions = JSON.parse(
          existing.resolutionsJson,
        ) as ApplicationMergeResolutions;
        const preview = this.buildApplicationMergePreview(
          input.workspaceId,
          input.sourceApplicationId,
          input.targetApplicationId,
          storedResolutions,
          true,
        );
        return {
          alreadyApplied: true,
          applied: true,
          lineage: this.publicApplicationMerge(existing),
          preview: {
            ...preview,
            safeToApply: true,
            unresolvedConflicts: [],
          },
        };
      }

      const source = this.applicationForMerge(
        input.workspaceId,
        input.sourceApplicationId,
        "source",
      );
      const target = this.applicationForMerge(
        input.workspaceId,
        input.targetApplicationId,
        "target",
      );
      if (
        source.updatedAt !== input.expectedSourceUpdatedAt ||
        target.updatedAt !== input.expectedTargetUpdatedAt
      ) {
        throw new ApplicationMergeVersionConflictError(source, target);
      }
      const preview = this.buildApplicationMergePreview(
        input.workspaceId,
        input.sourceApplicationId,
        input.targetApplicationId,
        input.resolutions,
      );
      if (!preview.safeToApply) {
        throw new ApplicationMergeUnsafeError(preview);
      }

      const survivor = preview.survivor;
      const recoverySnapshot = this.mergeRecoverySnapshot(
        input.workspaceId,
        source,
        target,
        survivor,
        input.mergedAt,
      );
      if (survivor.statusId !== target.statusId) {
        this.activeReference(input.workspaceId, survivor.statusId, "status");
      }
      if (survivor.sourceId !== null && survivor.sourceId !== target.sourceId) {
        this.activeReference(input.workspaceId, survivor.sourceId, "source");
      }
      if (
        survivor.roleTypeId !== null &&
        survivor.roleTypeId !== target.roleTypeId
      ) {
        this.activeReference(
          input.workspaceId,
          survivor.roleTypeId,
          "role_type",
        );
      }

      const targetUpdate = this.database
        .prepare(
          `UPDATE applications
           SET agency = ?,
               company_name = ?,
               role_title = ?,
               legacy_status = ?,
               status_reference_id = ?,
               source_reference_id = ?,
               role_type_reference_id = ?,
               location = ?,
               source_url = ?,
               applied_on = ?,
               next_action = ?,
               next_action_due = ?,
               notes = ?,
               rating = ?,
               salary = ?,
               salary_minimum_amount = ?,
               salary_maximum_amount = ?,
               salary_currency = ?,
               salary_period = ?,
               salary_disclosed = ?,
               salary_negotiable = ?,
               work_arrangement = ?,
               work_arrangement_text = ?,
               office_days_per_week = ?,
               remote_days_per_week = ?,
               updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
             AND updated_at = ?`,
        )
        .run(
          survivor.agency,
          survivor.companyName,
          survivor.roleTitle,
          survivor.statusIsTerminal ? "closed" : "prospect",
          survivor.statusId,
          survivor.sourceId,
          survivor.roleTypeId,
          survivor.location,
          survivor.sourceUrl,
          survivor.appliedOn,
          survivor.nextAction,
          survivor.nextActionDue,
          survivor.notes,
          survivor.rating,
          survivor.salary,
          survivor.salaryDetails?.minimum ?? null,
          survivor.salaryDetails?.maximum ?? null,
          survivor.salaryDetails?.currency ?? null,
          survivor.salaryDetails?.period ?? null,
          survivor.salaryDetails === null
            ? null
            : Number(survivor.salaryDetails.disclosed),
          survivor.salaryDetails === null
            ? null
            : Number(survivor.salaryDetails.negotiable),
          survivor.workArrangement,
          survivor.workArrangementDetails?.originalText ?? null,
          survivor.workArrangementDetails?.officeDaysPerWeek ?? null,
          survivor.workArrangementDetails?.remoteDaysPerWeek ?? null,
          input.mergedAt,
          input.workspaceId,
          target.id,
          input.expectedTargetUpdatedAt,
        );
      if (targetUpdate.changes !== 1) {
        throw new ApplicationMergeVersionConflictError(source, target);
      }
      this.replaceContacts(
        input.workspaceId,
        target.id,
        preview.contacts.result,
      );
      this.replaceLinks(input.workspaceId, target.id, preview.links.result);
      this.replaceOutlookGraphConnectionAssignment(
        input.workspaceId,
        target.id,
        survivor.outlookGraphConnectionId,
        input.actorUserId,
        input.mergedAt,
      );
      this.database
        .prepare(
          `DELETE FROM application_outlook_graph_connections
           WHERE workspace_id = ? AND application_id = ?`,
        )
        .run(input.workspaceId, source.id);

      this.database
        .prepare(
          `INSERT INTO application_documents
             (workspace_id, application_id, document_id,
              associated_by_user_id, associated_at)
           SELECT workspace_id, ?, document_id, ?, ?
           FROM application_documents
           WHERE workspace_id = ? AND application_id = ?
           ON CONFLICT(workspace_id, application_id, document_id) DO NOTHING`,
        )
        .run(
          target.id,
          input.actorUserId,
          input.mergedAt,
          input.workspaceId,
          source.id,
        );
      this.database
        .prepare(
          `UPDATE application_job_postings
           SET application_id = ?, updated_at = ?
           WHERE workspace_id = ? AND application_id = ?`,
        )
        .run(target.id, input.mergedAt, input.workspaceId, source.id);
      this.database
        .prepare(
          `UPDATE application_email_evidence
           SET application_id = ?, updated_at = ?
           WHERE workspace_id = ? AND application_id = ?`,
        )
        .run(target.id, input.mergedAt, input.workspaceId, source.id);

      if (survivor.statusId !== target.statusId) {
        this.database
          .prepare(
            `INSERT INTO application_events
               (id, workspace_id, application_id, actor_user_id, event_type,
                from_status, to_status, occurred_at, processed_at,
                source_email_message_id, status_override_reason, sequence)
             VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?, ?, NULL, NULL,
               (SELECT COALESCE(MAX(sequence), 0) + 1
                FROM application_events
                WHERE workspace_id = ? AND application_id = ?))`,
          )
          .run(
            randomUUID(),
            input.workspaceId,
            target.id,
            input.actorUserId,
            target.status,
            survivor.status,
            input.mergedAt,
            input.mergedAt,
            input.workspaceId,
            target.id,
          );
      }

      const lineageId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO application_merges
             (id, workspace_id, source_application_id, target_application_id,
              actor_user_id, source_updated_at, target_updated_at,
              resolutions_json, merged_at, recovery_snapshot_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          lineageId,
          input.workspaceId,
          source.id,
          target.id,
          input.actorUserId,
          input.expectedSourceUpdatedAt,
          input.expectedTargetUpdatedAt,
          JSON.stringify(input.resolutions),
          input.mergedAt,
          JSON.stringify(recoverySnapshot),
        );
      const sourceUpdate = this.database
        .prepare(
          `UPDATE applications
           SET deleted_at = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
             AND updated_at = ?`,
        )
        .run(
          input.mergedAt,
          input.mergedAt,
          input.workspaceId,
          source.id,
          input.expectedSourceUpdatedAt,
        );
      if (sourceUpdate.changes !== 1) {
        throw new ApplicationMergeVersionConflictError(source, target);
      }

      const deletedStored = this.findStoredApplicationIncludingDeleted(
        input.workspaceId,
        source.id,
      );
      if (!deletedStored) {
        throw new Error("Merged source could not be read for deletion history");
      }
      const [deletedSource] = this.hydrateApplications(input.workspaceId, [
        deletedStored,
      ]);
      if (!deletedSource) {
        throw new Error(
          "Merged source could not be hydrated for deletion history",
        );
      }
      this.database
        .prepare(
          `INSERT INTO application_deletions
             (id, application_id, workspace_id, actor_user_id, reason,
              deleted_at, merge_id, recovery_snapshot_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          source.id,
          input.workspaceId,
          input.actorUserId,
          "Merged into another application.",
          input.mergedAt,
          lineageId,
          JSON.stringify(
            this.deletionRecoverySnapshot(input.workspaceId, deletedSource),
          ),
        );

      const updatedStored = this.findStoredApplication(
        input.workspaceId,
        target.id,
      );
      const lineage = this.findApplicationMerge(input.workspaceId, source.id);
      if (!updatedStored || !lineage) {
        throw new Error("Completed application merge could not be read");
      }
      const [updatedTarget] = this.hydrateApplications(input.workspaceId, [
        updatedStored,
      ]);
      if (!updatedTarget) {
        throw new Error("Completed application merge could not be hydrated");
      }
      return {
        alreadyApplied: false,
        applied: true,
        lineage: this.publicApplicationMerge(lineage),
        preview: {
          ...preview,
          emailEvidence: {
            ...preview.emailEvidence,
            result: preview.emailEvidence.result.map((evidence) => ({
              ...evidence,
              applicationId: target.id,
              updatedAt: input.mergedAt,
            })),
          },
          jobPostings: {
            ...preview.jobPostings,
            result: preview.jobPostings.result.map((posting) => ({
              ...posting,
              applicationId: target.id,
              updatedAt: input.mergedAt,
            })),
          },
          survivor: updatedTarget,
          target: updatedTarget,
        },
      };
    });
    return merge.immediate();
  }

  public previewApplicationMergeRecovery(
    workspaceId: string,
    sourceApplicationId: string,
  ): ApplicationMergeRecoveryPreview {
    const storedSource = this.findStoredApplicationIncludingDeleted(
      workspaceId,
      sourceApplicationId,
    );
    if (!storedSource) throw new ApplicationRecoveryNotFoundError();
    const merge = this.findApplicationMerge(workspaceId, sourceApplicationId);
    if (!merge) throw new ApplicationRecoveryNotFoundError();
    const deletedAt = this.applicationDeletedAt(
      workspaceId,
      sourceApplicationId,
    );
    if (deletedAt === null) {
      const recovered = this.database
        .prepare(
          `SELECT 1 FROM application_merge_recoveries
           WHERE workspace_id = ? AND merge_id = ?`,
        )
        .pluck()
        .get(workspaceId, merge.id);
      throw new ApplicationRecoveryStateError(
        recovered === 1
          ? "application_already_restored"
          : "application_already_active",
      );
    }
    const deletion = this.findCurrentApplicationDeletion(
      workspaceId,
      sourceApplicationId,
    );
    if (!deletion || deletion.mergeId !== merge.id) {
      throw new ApplicationRecoveryNotFoundError();
    }
    const [source] = this.hydrateApplications(workspaceId, [storedSource]);
    if (!source) throw new ApplicationRecoveryNotFoundError();
    const storedTarget = this.findStoredApplication(
      workspaceId,
      merge.targetApplicationId,
    );
    const [target] = storedTarget
      ? this.hydrateApplications(workspaceId, [storedTarget])
      : [];
    const conflicts: ApplicationRecoveryConflict[] = [];
    const snapshot = parseMergeRecoverySnapshot(merge.recoverySnapshotJson);
    if (!snapshot) {
      conflicts.push({
        code: "legacy_merge_snapshot_unavailable",
        field: null,
        message:
          "This merge predates recovery snapshots and cannot be reversed automatically.",
        recordId: merge.id,
      });
    }
    if (!target) {
      conflicts.push({
        code: "target_unavailable",
        field: null,
        message: "The merge target is missing or deleted.",
        recordId: merge.targetApplicationId,
      });
    }
    if (snapshot) {
      const expectedSource: ApplicationRecord = {
        ...snapshot.sourceBefore,
        outlookGraphConnectionId: null,
        outlookGraphConnectionName: null,
        updatedAt: merge.mergedAt,
      };
      if (!isDeepStrictEqual(source, expectedSource)) {
        conflicts.push({
          code: "source_relationship_changed",
          field: null,
          message: "The merged source changed after the merge.",
          recordId: source.id,
        });
      }
      if (target && !isDeepStrictEqual(target, snapshot.targetAfter)) {
        conflicts.push({
          code: "target_changed",
          field: null,
          message: "The merge target changed after the merge.",
          recordId: target.id,
        });
      }
      const sourceDocumentIds = sortedUnique(
        this.listApplicationDocuments(workspaceId, source.id).map(
          ({ id }) => id,
        ),
      );
      const targetDocumentIds = target
        ? sortedUnique(
            this.listApplicationDocuments(workspaceId, target.id).map(
              ({ id }) => id,
            ),
          )
        : [];
      if (
        !isDeepStrictEqual(sourceDocumentIds, snapshot.sourceDocumentIds) ||
        (target &&
          !isDeepStrictEqual(
            targetDocumentIds,
            sortedUnique([
              ...snapshot.sourceDocumentIds,
              ...snapshot.targetDocumentIds,
            ]),
          ))
      ) {
        conflicts.push({
          code: "document_relationship_changed",
          field: null,
          message: "Document relationships changed after the merge.",
          recordId: null,
        });
      }
      if (target) {
        const evidence = this.database.prepare(
          `SELECT application_id AS applicationId, updated_at AS updatedAt
           FROM application_email_evidence
           WHERE workspace_id = ? AND id = ?`,
        );
        for (const expected of snapshot.sourceEmailEvidence) {
          const current = evidence.get(workspaceId, expected.id) as
            { applicationId: string; updatedAt: string } | undefined;
          if (
            !current ||
            current.applicationId !== target.id ||
            current.updatedAt !== merge.mergedAt
          ) {
            conflicts.push({
              code: "email_evidence_moved",
              field: null,
              message: "Merged email evidence changed after the merge.",
              recordId: expected.id,
            });
          }
        }
        const postings = this.database.prepare(
          `SELECT application_id AS applicationId, updated_at AS updatedAt
           FROM application_job_postings
           WHERE workspace_id = ? AND id = ?`,
        );
        for (const expected of snapshot.sourceJobPostings) {
          const current = postings.get(workspaceId, expected.id) as
            { applicationId: string; updatedAt: string } | undefined;
          if (
            !current ||
            current.applicationId !== target.id ||
            current.updatedAt !== merge.mergedAt
          ) {
            conflicts.push({
              code: "posting_moved",
              field: null,
              message: "Merged job-posting evidence changed after the merge.",
              recordId: expected.id,
            });
          }
        }
      }
      conflicts.push(
        ...this.inactiveReferenceConflicts(workspaceId, [
          snapshot.sourceBefore,
          snapshot.targetBefore,
        ]),
        ...this.missingOutlookGraphConnectionConflicts(workspaceId, [
          snapshot.sourceBefore,
          snapshot.targetBefore,
        ]),
      );
    }
    return {
      conflicts,
      deletion: this.publicApplicationDeletion(deletion, source),
      merge: this.publicApplicationMerge(merge),
      safeToRecover: conflicts.length === 0,
      source,
      target: target ?? null,
    };
  }

  public recoverApplicationMerge(
    input: RecoverApplicationMergeRecord,
  ): ApplicationMergeRecoveryResult {
    const recover = this.database.transaction(() => {
      const preview = this.previewApplicationMergeRecovery(
        input.workspaceId,
        input.sourceApplicationId,
      );
      if (!preview.target) {
        throw new ApplicationRecoveryStateError("merge_target_unavailable");
      }
      if (
        preview.source.updatedAt !== input.expectedSourceUpdatedAt ||
        preview.target.updatedAt !== input.expectedTargetUpdatedAt
      ) {
        throw new ApplicationRecoveryVersionConflictError();
      }
      if (!preview.safeToRecover) {
        throw new ApplicationMergeRecoveryUnsafeError(preview);
      }
      const merge = this.findApplicationMerge(
        input.workspaceId,
        input.sourceApplicationId,
      );
      if (!merge) throw new ApplicationRecoveryNotFoundError();
      const snapshot = parseMergeRecoverySnapshot(merge.recoverySnapshotJson);
      if (!snapshot) throw new ApplicationMergeRecoveryUnsafeError(preview);
      const target = snapshot.targetBefore;

      const targetUpdate = this.database
        .prepare(
          `UPDATE applications
           SET agency = ?, company_name = ?, role_title = ?, legacy_status = ?,
               status_reference_id = ?, source_reference_id = ?,
               role_type_reference_id = ?, location = ?, source_url = ?,
               applied_on = ?, next_action = ?, next_action_due = ?, notes = ?,
               rating = ?, salary = ?, salary_minimum_amount = ?,
               salary_maximum_amount = ?, salary_currency = ?, salary_period = ?,
               salary_disclosed = ?, salary_negotiable = ?, work_arrangement = ?,
               work_arrangement_text = ?, office_days_per_week = ?,
               remote_days_per_week = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
             AND updated_at = ?`,
        )
        .run(
          target.agency,
          target.companyName,
          target.roleTitle,
          target.statusIsTerminal ? "closed" : "prospect",
          target.statusId,
          target.sourceId,
          target.roleTypeId,
          target.location,
          target.sourceUrl,
          target.appliedOn,
          target.nextAction,
          target.nextActionDue,
          target.notes,
          target.rating,
          target.salary,
          target.salaryDetails?.minimum ?? null,
          target.salaryDetails?.maximum ?? null,
          target.salaryDetails?.currency ?? null,
          target.salaryDetails?.period ?? null,
          target.salaryDetails === null
            ? null
            : Number(target.salaryDetails.disclosed),
          target.salaryDetails === null
            ? null
            : Number(target.salaryDetails.negotiable),
          target.workArrangement,
          target.workArrangementDetails?.originalText ?? null,
          target.workArrangementDetails?.officeDaysPerWeek ?? null,
          target.workArrangementDetails?.remoteDaysPerWeek ?? null,
          input.recoveredAt,
          input.workspaceId,
          target.id,
          input.expectedTargetUpdatedAt,
        );
      if (targetUpdate.changes !== 1) {
        throw new ApplicationRecoveryVersionConflictError();
      }
      this.replaceContacts(input.workspaceId, target.id, target.contacts);
      this.replaceLinks(input.workspaceId, target.id, target.links);
      this.replaceOutlookGraphConnectionAssignment(
        input.workspaceId,
        target.id,
        target.outlookGraphConnectionId,
        input.actorUserId,
        input.recoveredAt,
      );

      const sourceOnlyDocuments = snapshot.sourceDocumentIds.filter(
        (id) => !snapshot.targetDocumentIds.includes(id),
      );
      const removeDocument = this.database.prepare(
        `DELETE FROM application_documents
         WHERE workspace_id = ? AND application_id = ? AND document_id = ?
           AND associated_by_user_id = ? AND associated_at = ?`,
      );
      for (const documentId of sourceOnlyDocuments) {
        const result = removeDocument.run(
          input.workspaceId,
          target.id,
          documentId,
          merge.actorUserId,
          merge.mergedAt,
        );
        if (result.changes !== 1) {
          throw new ApplicationMergeRecoveryUnsafeError(preview);
        }
      }

      const moveEvidence = this.database.prepare(
        `UPDATE application_email_evidence
         SET application_id = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND application_id = ?
           AND updated_at = ?`,
      );
      for (const evidence of snapshot.sourceEmailEvidence) {
        const result = moveEvidence.run(
          input.sourceApplicationId,
          input.recoveredAt,
          input.workspaceId,
          evidence.id,
          target.id,
          merge.mergedAt,
        );
        if (result.changes !== 1) {
          throw new ApplicationMergeRecoveryUnsafeError(preview);
        }
      }
      const movePosting = this.database.prepare(
        `UPDATE application_job_postings
         SET application_id = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND application_id = ?
           AND updated_at = ?`,
      );
      for (const posting of snapshot.sourceJobPostings) {
        const result = movePosting.run(
          input.sourceApplicationId,
          input.recoveredAt,
          input.workspaceId,
          posting.id,
          target.id,
          merge.mergedAt,
        );
        if (result.changes !== 1) {
          throw new ApplicationMergeRecoveryUnsafeError(preview);
        }
      }

      const sourceUpdate = this.database
        .prepare(
          `UPDATE applications
           SET deleted_at = NULL, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at = ?
             AND updated_at = ?`,
        )
        .run(
          input.recoveredAt,
          input.workspaceId,
          input.sourceApplicationId,
          preview.deletion.deletedAt,
          input.expectedSourceUpdatedAt,
        );
      if (sourceUpdate.changes !== 1) {
        throw new ApplicationRecoveryVersionConflictError();
      }
      this.replaceOutlookGraphConnectionAssignment(
        input.workspaceId,
        input.sourceApplicationId,
        snapshot.sourceBefore.outlookGraphConnectionId,
        input.actorUserId,
        input.recoveredAt,
      );

      if (snapshot.targetAfter.statusId !== target.statusId) {
        this.database
          .prepare(
            `INSERT INTO application_events
               (id, workspace_id, application_id, actor_user_id, event_type,
                from_status, to_status, occurred_at, processed_at,
                source_email_message_id, status_override_reason, sequence)
             VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?, ?, NULL, NULL,
               (SELECT COALESCE(MAX(sequence), 0) + 1
                FROM application_events
                WHERE workspace_id = ? AND application_id = ?))`,
          )
          .run(
            randomUUID(),
            input.workspaceId,
            target.id,
            input.actorUserId,
            snapshot.targetAfter.status,
            target.status,
            input.recoveredAt,
            input.recoveredAt,
            input.workspaceId,
            target.id,
          );
      }

      const recoveryId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO application_merge_recoveries
             (id, workspace_id, merge_id, deletion_id,
              source_application_id, target_application_id, actor_user_id,
              expected_source_updated_at, expected_target_updated_at,
              recovered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          recoveryId,
          input.workspaceId,
          merge.id,
          preview.deletion.id,
          input.sourceApplicationId,
          target.id,
          input.actorUserId,
          input.expectedSourceUpdatedAt,
          input.expectedTargetUpdatedAt,
          input.recoveredAt,
        );
      const restorationId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO application_restorations
             (id, workspace_id, deletion_id, application_id, actor_user_id,
              recovery_type, merge_recovery_id, restored_at)
           VALUES (?, ?, ?, ?, ?, 'merge', ?, ?)`,
        )
        .run(
          restorationId,
          input.workspaceId,
          preview.deletion.id,
          input.sourceApplicationId,
          input.actorUserId,
          recoveryId,
          input.recoveredAt,
        );

      const sourceStored = this.findStoredApplication(
        input.workspaceId,
        input.sourceApplicationId,
      );
      const targetStored = this.findStoredApplication(
        input.workspaceId,
        target.id,
      );
      if (!sourceStored || !targetStored) {
        throw new ApplicationRecoveryNotFoundError();
      }
      const [restoredSource] = this.hydrateApplications(input.workspaceId, [
        sourceStored,
      ]);
      const [restoredTarget] = this.hydrateApplications(input.workspaceId, [
        targetStored,
      ]);
      const actorDisplayName = this.database
        .prepare("SELECT display_name FROM users WHERE id = ?")
        .pluck()
        .get(input.actorUserId);
      if (
        !restoredSource ||
        !restoredTarget ||
        typeof actorDisplayName !== "string"
      ) {
        throw new ApplicationRecoveryNotFoundError();
      }
      const recovery: ApplicationMergeRecoveryRecord = {
        actorDisplayName,
        id: recoveryId,
        mergeId: merge.id,
        recoveredAt: input.recoveredAt,
        sourceApplicationId: restoredSource.id,
        targetApplicationId: restoredTarget.id,
      };
      return {
        preview,
        recovery,
        source: restoredSource,
        target: restoredTarget,
      };
    });
    return recover.immediate();
  }

  private hydrateApplications(
    workspaceId: string,
    stored: StoredApplicationRecord[],
  ): ApplicationRecord[] {
    if (stored.length === 0) return [];
    const applications = stored.map((application) => {
      const {
        officeDaysPerWeek,
        remoteDaysPerWeek,
        salaryCurrency,
        salaryDisclosed,
        salaryMaximum,
        salaryMinimum,
        salaryNegotiable,
        salaryPeriod,
        workArrangementText,
        ...record
      } = application;
      return {
        ...record,
        contacts: [] as ApplicationContact[],
        links: [] as ApplicationLink[],
        salaryDetails:
          salaryCurrency !== null &&
          salaryDisclosed !== null &&
          salaryNegotiable !== null &&
          salaryPeriod !== null
            ? {
                currency: salaryCurrency,
                disclosed: salaryDisclosed === 1,
                ...(salaryMaximum === null ? {} : { maximum: salaryMaximum }),
                ...(salaryMinimum === null ? {} : { minimum: salaryMinimum }),
                negotiable: salaryNegotiable === 1,
                period: salaryPeriod,
              }
            : null,
        statusIsTerminal: application.statusIsTerminal === 1,
        workArrangementDetails:
          workArrangementText !== null ||
          officeDaysPerWeek !== null ||
          remoteDaysPerWeek !== null
            ? {
                ...(officeDaysPerWeek === null ? {} : { officeDaysPerWeek }),
                ...(remoteDaysPerWeek === null ? {} : { remoteDaysPerWeek }),
                ...(workArrangementText === null
                  ? {}
                  : { originalText: workArrangementText }),
              }
            : null,
      } satisfies ApplicationRecord;
    });
    const byId = new Map(
      applications.map((application) => [application.id, application]),
    );
    const applicationIds = stored.map(({ id }) => id);
    const contacts: StoredContact[] = [];
    const links: StoredLink[] = [];
    for (
      let offset = 0;
      offset < applicationIds.length;
      offset += relationHydrationBatchSize
    ) {
      const batch = applicationIds.slice(
        offset,
        offset + relationHydrationBatchSize,
      );
      const placeholders = batch.map(() => "?").join(", ");
      contacts.push(
        ...(this.database
          .prepare(
            `SELECT application_id AS applicationId, name, role, email, phone
             FROM application_contacts
             WHERE workspace_id = ? AND application_id IN (${placeholders})
             ORDER BY application_id, position`,
          )
          .all(workspaceId, ...batch) as StoredContact[]),
      );
      links.push(
        ...(this.database
          .prepare(
            `SELECT application_id AS applicationId, label, url
             FROM application_links
             WHERE workspace_id = ? AND application_id IN (${placeholders})
             ORDER BY application_id, position`,
          )
          .all(workspaceId, ...batch) as StoredLink[]),
      );
    }
    for (const { applicationId, ...contact } of contacts) {
      byId.get(applicationId)?.contacts.push(contact);
    }
    for (const { applicationId, ...link } of links) {
      byId.get(applicationId)?.links.push(link);
    }
    return applications;
  }

  private replaceContacts(
    workspaceId: string,
    applicationId: string,
    contacts: ApplicationContact[],
  ): void {
    this.database
      .prepare(
        `DELETE FROM application_contacts
         WHERE workspace_id = ? AND application_id = ?`,
      )
      .run(workspaceId, applicationId);
    const insert = this.database.prepare(
      `INSERT INTO application_contacts
         (workspace_id, application_id, position, name, role, email, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    contacts.forEach((contact, position) => {
      insert.run(
        workspaceId,
        applicationId,
        position,
        contact.name,
        contact.role,
        contact.email,
        contact.phone,
      );
    });
  }

  private replaceLinks(
    workspaceId: string,
    applicationId: string,
    links: ApplicationLink[],
  ): void {
    this.database
      .prepare(
        `DELETE FROM application_links
         WHERE workspace_id = ? AND application_id = ?`,
      )
      .run(workspaceId, applicationId);
    const insert = this.database.prepare(
      `INSERT INTO application_links
         (workspace_id, application_id, position, label, url)
       VALUES (?, ?, ?, ?, ?)`,
    );
    links.forEach((link, position) => {
      insert.run(workspaceId, applicationId, position, link.label, link.url);
    });
  }

  private requireOutlookGraphConnection(
    workspaceId: string,
    connectionId: string,
  ): void {
    const exists = this.database
      .prepare(
        `SELECT 1
         FROM outlook_graph_connections
         WHERE workspace_id = ? AND id = ?`,
      )
      .pluck()
      .get(workspaceId, connectionId);
    if (exists === undefined) {
      throw new InvalidOutlookGraphConnectionAssignmentError();
    }
  }

  private replaceOutlookGraphConnectionAssignment(
    workspaceId: string,
    applicationId: string,
    connectionId: string | null,
    actorUserId: string,
    assignedAt: string,
  ): void {
    if (connectionId === null) {
      this.database
        .prepare(
          `DELETE FROM application_outlook_graph_connections
           WHERE workspace_id = ? AND application_id = ?`,
        )
        .run(workspaceId, applicationId);
      return;
    }
    this.requireOutlookGraphConnection(workspaceId, connectionId);
    this.database
      .prepare(
        `INSERT INTO application_outlook_graph_connections
           (workspace_id, application_id, connection_id, assigned_at,
            assigned_by_user_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, application_id) DO UPDATE SET
           connection_id = excluded.connection_id,
           assigned_at = excluded.assigned_at,
           assigned_by_user_id = excluded.assigned_by_user_id`,
      )
      .run(workspaceId, applicationId, connectionId, assignedAt, actorUserId);
  }

  public createApplication(input: CreateApplicationRecord): ApplicationRecord {
    const id = randomUUID();
    const eventId = randomUUID();
    const create = this.database.transaction(() => {
      const status = this.activeReference(
        input.workspaceId,
        input.statusId,
        "status",
      );
      if (input.sourceId) {
        this.activeReference(input.workspaceId, input.sourceId, "source");
      }
      if (input.roleTypeId) {
        this.activeReference(input.workspaceId, input.roleTypeId, "role_type");
      }
      this.database
        .prepare(
          `INSERT INTO applications
           (id, workspace_id, agency, company_name, role_title, legacy_status,
            status_reference_id, source_reference_id, role_type_reference_id,
            location, source_url, applied_on, next_action, next_action_due,
            notes, rating, salary, salary_minimum_amount,
            salary_maximum_amount, salary_currency, salary_period,
            salary_disclosed, salary_negotiable, work_arrangement,
            work_arrangement_text, office_days_per_week, remote_days_per_week,
            created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.workspaceId,
          input.agency,
          input.companyName,
          input.roleTitle,
          status.isTerminal ? "closed" : "prospect",
          input.statusId,
          input.sourceId,
          input.roleTypeId,
          input.location,
          input.sourceUrl,
          input.appliedOn,
          input.nextAction,
          input.nextActionDue,
          input.notes,
          input.rating,
          input.salary,
          input.salaryDetails?.minimum ?? null,
          input.salaryDetails?.maximum ?? null,
          input.salaryDetails?.currency ?? null,
          input.salaryDetails?.period ?? null,
          input.salaryDetails == null
            ? null
            : Number(input.salaryDetails.disclosed),
          input.salaryDetails == null
            ? null
            : Number(input.salaryDetails.negotiable),
          input.workArrangement,
          input.workArrangementDetails?.originalText ?? null,
          input.workArrangementDetails?.officeDaysPerWeek ?? null,
          input.workArrangementDetails?.remoteDaysPerWeek ?? null,
          input.createdByUserId,
          input.createdAt,
          input.createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO application_events
             (id, workspace_id, application_id, actor_user_id, event_type,
              from_status, to_status, occurred_at, processed_at,
              source_email_message_id, status_override_reason, sequence)
           VALUES (?, ?, ?, ?, 'application_created', NULL, ?, ?, ?, NULL,
                   NULL, 1)`,
        )
        .run(
          eventId,
          input.workspaceId,
          id,
          input.createdByUserId,
          status.label,
          input.createdAt,
          input.createdAt,
        );
      this.replaceContacts(input.workspaceId, id, input.contacts ?? []);
      this.replaceLinks(input.workspaceId, id, input.links ?? []);
      this.replaceOutlookGraphConnectionAssignment(
        input.workspaceId,
        id,
        input.outlookGraphConnectionId ?? null,
        input.createdByUserId,
        input.createdAt,
      );
      const stored = this.findStoredApplication(input.workspaceId, id);
      if (!stored) throw new Error("Created application could not be read");
      const [created] = this.hydrateApplications(input.workspaceId, [stored]);
      if (!created)
        throw new Error("Created application could not be hydrated");
      return created;
    });
    return create.immediate();
  }

  public listApplications(workspaceId: string): ApplicationRecord[] {
    const stored = this.database
      .prepare(
        `${publicApplicationSelect()}
         WHERE applications.workspace_id = ?
           AND applications.deleted_at IS NULL
         ORDER BY applications.updated_at DESC, applications.id DESC`,
      )
      .all(workspaceId) as StoredApplicationRecord[];
    return this.hydrateApplications(workspaceId, stored);
  }

  public queryApplicationAttention(
    input: QueryApplicationAttentionRecord,
  ): ApplicationAttentionRepositoryResult {
    const parameters: Record<string, number | string> = {
      asOfDate: input.asOfDate,
      limit: input.limit,
      offset: input.offset,
      workspaceId: input.workspaceId,
    };
    const conditions: string[] = [];
    if (input.attentionOnly) conditions.push(anyAttentionReasonCondition);
    if (input.lifecycle === "active") {
      conditions.push("facts.statusIsTerminal = 0");
    } else if (input.lifecycle === "terminal") {
      conditions.push("facts.statusIsTerminal = 1");
    }
    if (input.statusIds?.length) {
      const placeholders = input.statusIds.map((statusId, index) => {
        const name = `statusId${index}`;
        parameters[name] = statusId;
        return `@${name}`;
      });
      conditions.push(`facts.statusId IN (${placeholders.join(", ")})`);
    }
    if (input.appliedFrom) {
      parameters.appliedFrom = input.appliedFrom;
      conditions.push("facts.appliedOn >= @appliedFrom");
    }
    if (input.appliedTo) {
      parameters.appliedTo = input.appliedTo;
      conditions.push("facts.appliedOn <= @appliedTo");
    }
    if (input.updatedFrom) {
      parameters.updatedFrom = input.updatedFrom;
      conditions.push("facts.updatedAt >= @updatedFrom");
    }
    if (input.updatedTo) {
      parameters.updatedTo = input.updatedTo;
      conditions.push("facts.updatedAt <= @updatedTo");
    }
    if (input.nextAction) {
      conditions.push(
        input.nextAction === "overdue"
          ? "facts.nextActionOverdue = 1"
          : "facts.nextActionMissing = 1",
      );
    }
    for (const missing of input.missingFields ?? []) {
      conditions.push(attentionMissingFieldConditions[missing]);
    }
    for (const missing of input.missingEvidence ?? []) {
      conditions.push(attentionMissingEvidenceConditions[missing]);
    }
    if (input.duplicateRisk !== undefined) {
      parameters.duplicateRisk = Number(input.duplicateRisk);
      conditions.push("facts.duplicateRisk = @duplicateRisk");
    }
    if (input.fieldStates?.length) {
      conditions.push(
        `(${input.fieldStates
          .map((state) => attentionFieldStateConditions[state])
          .join(" OR ")})`,
      );
    }
    if (input.reasonCodes?.length) {
      conditions.push(
        `(${input.reasonCodes
          .map((code) => attentionReasonConditions[code])
          .join(" OR ")})`,
      );
    }
    for (const [index, token] of (input.query?.split(/\s+/) ?? []).entries()) {
      const name = `queryToken${index}`;
      parameters[name] = `%${escapeLikePattern(token.toLowerCase())}%`;
      conditions.push(`facts.searchText LIKE @${name} ESCAPE '\\'`);
    }
    const where = conditions.length ? conditions.join(" AND ") : "1 = 1";
    const total = this.database
      .prepare(
        `${applicationAttentionFactsSql}
         SELECT count(*) FROM attention_facts AS facts WHERE ${where}`,
      )
      .pluck()
      .get(parameters) as number;
    const rows = this.database
      .prepare(
        `${applicationAttentionFactsSql}
         SELECT facts.*
         FROM attention_facts AS facts
         WHERE ${where}
         ORDER BY
           facts.statusIsTerminal ASC,
           facts.stagePriority DESC,
           facts.nextActionOverdue DESC,
           (
             facts.emailEvidenceMissing OR facts.originalAdvertMissing OR
             facts.applicationConfirmationMissing
           ) DESC,
           facts.duplicateRisk DESC,
           (length(facts.fieldConflicting) > 0) DESC,
           facts.updatedAt DESC,
           facts.applicationId DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all(parameters) as StoredApplicationAttentionFact[];
    const applicationIds = rows.map(({ applicationId }) => applicationId);
    const applications =
      applicationIds.length === 0
        ? []
        : this.hydrateApplications(
            input.workspaceId,
            this.database
              .prepare(
                `${publicApplicationSelect()}
                 WHERE applications.workspace_id = ?
                   AND applications.deleted_at IS NULL
                   AND applications.id IN (${applicationIds
                     .map(() => "?")
                     .join(", ")})`,
              )
              .all(
                input.workspaceId,
                ...applicationIds,
              ) as StoredApplicationRecord[],
          );
    const applicationById = new Map(
      applications.map((application) => [application.id, application]),
    );

    const reasonSelections = Object.entries(attentionReasonConditions).map(
      ([code, condition]) =>
        `coalesce(sum(CASE WHEN ${condition} THEN 1 ELSE 0 END), 0) AS "${code}"`,
    );
    const stateSelections = Object.entries(attentionFieldStateConditions).map(
      ([state, condition]) =>
        `coalesce(sum(CASE WHEN ${condition} THEN 1 ELSE 0 END), 0) AS "state_${state}"`,
    );
    const summary = this.database
      .prepare(
        `${applicationAttentionFactsSql}
         SELECT
           count(*) AS totalApplications,
           coalesce(sum(CASE WHEN ${anyAttentionReasonCondition}
             THEN 1 ELSE 0 END), 0) AS queuedApplications,
           ${reasonSelections.join(",\n           ")},
           ${stateSelections.join(",\n           ")}
         FROM attention_facts AS facts`,
      )
      .get(parameters) as Record<string, number>;
    const reasonCounts = Object.fromEntries(
      Object.keys(attentionReasonConditions).map((code) => [
        code,
        summary[code] ?? 0,
      ]),
    ) as Record<ApplicationAttentionReasonCode, number>;
    const stateCounts = Object.fromEntries(
      Object.keys(attentionFieldStateConditions).map((state) => [
        state,
        summary[`state_${state}`] ?? 0,
      ]),
    ) as Record<ApplicationAttentionFieldState, number>;
    return {
      items: rows.flatMap((row) => {
        const application = applicationById.get(row.applicationId);
        return application
          ? [{ application, signals: attentionSignals(row) }]
          : [];
      }),
      queuedApplications: summary.queuedApplications ?? 0,
      reasonCounts,
      stateCounts,
      total,
      totalApplications: summary.totalApplications ?? 0,
    };
  }

  private storedApplicationFieldProvenance(
    workspaceId: string,
    applicationId: string,
  ): StoredApplicationFieldProvenance[] {
    return this.database
      .prepare(
        `SELECT
           provenance.id,
           provenance.application_id AS applicationId,
           provenance.field_name AS field,
           provenance.value_json AS valueJson,
           provenance.source_type AS sourceType,
           provenance.source_email_evidence_id AS sourceEmailEvidenceId,
           provenance.source_document_id AS sourceDocumentId,
           provenance.source_job_posting_id AS sourceJobPostingId,
           provenance.observed_at AS observedAt,
           provenance.confidence,
           provenance.field_state AS fieldState,
           provenance.idempotency_key AS idempotencyKey,
           provenance.verified_at AS verifiedAt,
           provenance.verified_by_user_id AS verifiedByUserId,
           verifiers.display_name AS verifiedByDisplayName,
           provenance.created_at AS createdAt
         FROM application_field_provenance AS provenance
         LEFT JOIN users AS verifiers
           ON verifiers.id = provenance.verified_by_user_id
         WHERE provenance.workspace_id = ?
           AND provenance.application_id = ?
         ORDER BY provenance.field_name, provenance.observed_at DESC,
                  provenance.id DESC`,
      )
      .all(workspaceId, applicationId) as StoredApplicationFieldProvenance[];
  }

  public listApplicationFieldProvenance(
    workspaceId: string,
    applicationId: string,
  ): ApplicationFieldProvenanceAssessment[] | undefined {
    if (!this.findStoredApplication(workspaceId, applicationId))
      return undefined;
    const grouped = new Map<
      ApplicationFieldName,
      StoredApplicationFieldProvenance[]
    >();
    for (const record of this.storedApplicationFieldProvenance(
      workspaceId,
      applicationId,
    )) {
      const records = grouped.get(record.field) ?? [];
      records.push(record);
      grouped.set(record.field, records);
    }
    return [...grouped.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([field, records]) => {
        records.sort((first, second) => {
          const verified =
            Number(second.verifiedAt !== null) -
            Number(first.verifiedAt !== null);
          if (verified !== 0) return verified;
          const source =
            provenanceSourcePrecedence[second.sourceType] -
            provenanceSourcePrecedence[first.sourceType];
          if (source !== 0) return source;
          const observed = second.observedAt.localeCompare(first.observedAt);
          if (observed !== 0) return observed;
          const confidence = second.confidence - first.confidence;
          return confidence !== 0
            ? confidence
            : second.id.localeCompare(first.id);
        });
        const selected = records[0];
        if (!selected) {
          return {
            conflicting: 0,
            field,
            records: [],
            selected: null,
            stale: 0,
          };
        }
        const selectedValue = JSON.parse(selected.valueJson) as unknown;
        let conflicting = 0;
        let stale = 0;
        const assessed = records.map((record, index) => {
          let relationship: ApplicationFieldProvenanceRecord["relationship"];
          if (index === 0) {
            relationship = "selected";
          } else if (
            isDeepStrictEqual(JSON.parse(record.valueJson), selectedValue)
          ) {
            relationship = "corroborating";
          } else if (record.observedAt < selected.observedAt) {
            relationship = "stale";
            stale += 1;
          } else {
            relationship = "conflicting";
            conflicting += 1;
          }
          return publicProvenance(record, relationship);
        });
        return {
          conflicting,
          field,
          records: assessed,
          selected: assessed[0] ?? null,
          stale,
        };
      });
  }

  private requireProvenanceSource(
    workspaceId: string,
    applicationId: string,
    source: ApplicationFieldProvenanceSource,
  ): void {
    if (source.type === "imported") return;
    const query =
      source.type === "document"
        ? {
            id: source.documentId,
            sql: `SELECT 1 FROM application_documents
                  WHERE workspace_id = ? AND application_id = ? AND document_id = ?`,
          }
        : source.type === "email_evidence"
          ? {
              id: source.emailEvidenceId,
              sql: `SELECT 1 FROM application_email_evidence
                    WHERE workspace_id = ? AND application_id = ? AND id = ?`,
            }
          : {
              id: source.jobPostingId,
              sql: `SELECT 1 FROM application_job_postings
                    WHERE workspace_id = ? AND application_id = ? AND id = ?`,
            };
    const exists = this.database
      .prepare(query.sql)
      .pluck()
      .get(workspaceId, applicationId, query.id);
    if (exists === undefined) throw new ApplicationFieldProvenanceSourceError();
  }

  public recordApplicationFieldProvenance(
    input: RecordApplicationFieldProvenanceRecord,
  ): ApplicationFieldProvenanceRecord | undefined {
    const record = this.database.transaction(() => {
      if (!this.findStoredApplication(input.workspaceId, input.applicationId)) {
        return undefined;
      }
      const existing = input.idempotencyKey
        ? (this.database
            .prepare(
              `SELECT application_id AS applicationId
               FROM application_field_provenance
               WHERE workspace_id = ? AND idempotency_key = ?`,
            )
            .get(input.workspaceId, input.idempotencyKey) as
            { applicationId: string } | undefined)
        : undefined;
      if (existing) {
        const stored = this.storedApplicationFieldProvenance(
          input.workspaceId,
          existing.applicationId,
        ).find(({ idempotencyKey }) => idempotencyKey === input.idempotencyKey);
        if (
          stored &&
          stored.applicationId === input.applicationId &&
          stored.field === input.field &&
          isDeepStrictEqual(JSON.parse(stored.valueJson), input.value) &&
          isDeepStrictEqual(provenanceSource(stored), input.source) &&
          stored.observedAt === input.observedAt &&
          stored.confidence === input.confidence &&
          stored.fieldState === input.fieldState
        ) {
          return this.listApplicationFieldProvenance(
            input.workspaceId,
            input.applicationId,
          )
            ?.flatMap(({ records }) => records)
            .find(
              ({ idempotencyKey }) => idempotencyKey === input.idempotencyKey,
            );
        }
        throw new ApplicationFieldProvenanceIdempotencyConflictError();
      }
      this.requireProvenanceSource(
        input.workspaceId,
        input.applicationId,
        input.source,
      );
      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO application_field_provenance
             (id, workspace_id, application_id, field_name, value_json,
              source_type, source_email_evidence_id, source_document_id,
              source_job_posting_id, observed_at, confidence, field_state,
              idempotency_key, verified_at, verified_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .run(
          id,
          input.workspaceId,
          input.applicationId,
          input.field,
          JSON.stringify(input.value),
          input.source.type,
          input.source.type === "email_evidence"
            ? input.source.emailEvidenceId
            : null,
          input.source.type === "document" ? input.source.documentId : null,
          input.source.type === "job_posting"
            ? input.source.jobPostingId
            : null,
          input.observedAt,
          input.confidence,
          input.fieldState,
          input.idempotencyKey ?? null,
          input.createdAt,
        );
      return this.listApplicationFieldProvenance(
        input.workspaceId,
        input.applicationId,
      )
        ?.flatMap(({ records }) => records)
        .find((candidate) => candidate.id === id);
    });
    return record.immediate();
  }

  public verifyApplicationFieldProvenance(
    input: VerifyApplicationFieldProvenanceRecord,
  ): ApplicationFieldProvenanceRecord | undefined {
    const verify = this.database.transaction(() => {
      if (!this.findStoredApplication(input.workspaceId, input.applicationId)) {
        return undefined;
      }
      const stored = this.storedApplicationFieldProvenance(
        input.workspaceId,
        input.applicationId,
      ).find(({ id }) => id === input.provenanceId);
      if (!stored) return undefined;
      if (stored.verifiedAt !== null) {
        if (stored.verifiedByUserId !== input.verifiedByUserId) {
          throw new ApplicationFieldProvenanceVerificationConflictError();
        }
      } else {
        const result = this.database
          .prepare(
            `UPDATE application_field_provenance
             SET verified_at = ?, verified_by_user_id = ?
             WHERE workspace_id = ? AND application_id = ? AND id = ?
               AND verified_at IS NULL`,
          )
          .run(
            input.verifiedAt,
            input.verifiedByUserId,
            input.workspaceId,
            input.applicationId,
            input.provenanceId,
          );
        if (result.changes !== 1) {
          throw new ApplicationFieldProvenanceVerificationConflictError();
        }
      }
      return this.listApplicationFieldProvenance(
        input.workspaceId,
        input.applicationId,
      )
        ?.flatMap(({ records }) => records)
        .find(({ id }) => id === input.provenanceId);
    });
    return verify.immediate();
  }

  public deleteApplication(input: DeleteApplicationRecord): boolean {
    const remove = this.database.transaction(() => {
      const stored = this.findStoredApplication(
        input.workspaceId,
        input.applicationId,
      );
      if (!stored) return false;
      const [application] = this.hydrateApplications(input.workspaceId, [
        stored,
      ]);
      if (!application) return false;
      const snapshot = this.deletionRecoverySnapshot(
        input.workspaceId,
        application,
      );
      const result = this.database
        .prepare(
          `UPDATE applications
           SET deleted_at = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .run(
          input.deletedAt,
          input.deletedAt,
          input.workspaceId,
          input.applicationId,
        );
      if (result.changes === 0) return false;

      this.database
        .prepare(
          `INSERT INTO application_deletions
             (id, application_id, workspace_id, actor_user_id, reason,
              deleted_at, merge_id, recovery_snapshot_json)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          randomUUID(),
          input.applicationId,
          input.workspaceId,
          input.actorUserId,
          input.reason,
          input.deletedAt,
          JSON.stringify(snapshot),
        );
      return true;
    });

    return remove.immediate();
  }

  public listDeletedApplications(
    workspaceId: string,
    input: ListDeletedApplicationsInput,
  ): DeletedApplicationsPage {
    const total = this.database
      .prepare(
        `SELECT count(*)
         FROM applications
         JOIN application_deletions AS deletions
           ON deletions.workspace_id = applications.workspace_id
          AND deletions.application_id = applications.id
          AND deletions.deleted_at = applications.deleted_at
         WHERE applications.workspace_id = ?
           AND applications.deleted_at IS NOT NULL`,
      )
      .pluck()
      .get(workspaceId) as number;
    const deletions = this.database
      .prepare(
        `SELECT
           deletions.id,
           deletions.application_id AS applicationId,
           deletions.workspace_id AS workspaceId,
           deletions.actor_user_id AS actorUserId,
           actors.display_name AS actorDisplayName,
           deletions.reason,
           deletions.deleted_at AS deletedAt,
           deletions.merge_id AS mergeId,
           deletions.recovery_snapshot_json AS recoverySnapshotJson,
           merges.target_application_id AS targetApplicationId,
           targets.company_name AS targetCompanyName,
           targets.role_title AS targetRoleTitle
         FROM applications
         JOIN application_deletions AS deletions
           ON deletions.workspace_id = applications.workspace_id
          AND deletions.application_id = applications.id
          AND deletions.deleted_at = applications.deleted_at
         JOIN users AS actors ON actors.id = deletions.actor_user_id
         LEFT JOIN application_merges AS merges
           ON merges.workspace_id = deletions.workspace_id
          AND merges.id = deletions.merge_id
         LEFT JOIN applications AS targets
           ON targets.workspace_id = merges.workspace_id
          AND targets.id = merges.target_application_id
         WHERE applications.workspace_id = ?
           AND applications.deleted_at IS NOT NULL
         ORDER BY deletions.deleted_at DESC, deletions.application_id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(
        workspaceId,
        input.limit,
        input.offset,
      ) as StoredApplicationDeletion[];
    const applicationIds = deletions.map(({ applicationId }) => applicationId);
    const applications =
      applicationIds.length === 0
        ? []
        : this.hydrateApplications(
            workspaceId,
            this.database
              .prepare(
                `${publicApplicationSelect()}
                 WHERE applications.workspace_id = ?
                   AND applications.id IN (${applicationIds
                     .map(() => "?")
                     .join(", ")})`,
              )
              .all(workspaceId, ...applicationIds) as StoredApplicationRecord[],
          );
    const applicationById = new Map(
      applications.map((application) => [application.id, application]),
    );
    const records = deletions.flatMap((deletion) => {
      const application = applicationById.get(deletion.applicationId);
      return application
        ? [this.publicApplicationDeletion(deletion, application)]
        : [];
    });
    const nextOffset = input.offset + records.length;
    return {
      applications: records,
      limit: input.limit,
      nextOffset: nextOffset < total ? nextOffset : null,
      offset: input.offset,
      returned: records.length,
      total,
    };
  }

  public previewApplicationRestore(
    workspaceId: string,
    applicationId: string,
  ): ApplicationRestorePreview {
    const stored = this.findStoredApplicationIncludingDeleted(
      workspaceId,
      applicationId,
    );
    if (!stored) throw new ApplicationRecoveryNotFoundError();
    const deletedAt = this.applicationDeletedAt(workspaceId, applicationId);
    if (deletedAt === null) {
      const restored = this.database
        .prepare(
          `SELECT 1 FROM application_restorations
           WHERE workspace_id = ? AND application_id = ?`,
        )
        .pluck()
        .get(workspaceId, applicationId);
      throw new ApplicationRecoveryStateError(
        restored === 1
          ? "application_already_restored"
          : "application_already_active",
      );
    }
    const deletion = this.findCurrentApplicationDeletion(
      workspaceId,
      applicationId,
    );
    if (!deletion) throw new ApplicationRecoveryNotFoundError();
    const [application] = this.hydrateApplications(workspaceId, [stored]);
    if (!application) throw new ApplicationRecoveryNotFoundError();

    const conflicts: ApplicationRecoveryConflict[] = [];
    if (deletion.mergeId !== null) {
      conflicts.push({
        code: "merge_recovery_required",
        field: null,
        message:
          "This application was deleted by a merge and requires merge recovery.",
        recordId: deletion.mergeId,
      });
    } else {
      const snapshot = parseDeletionRecoverySnapshot(
        deletion.recoverySnapshotJson,
      );
      if (!snapshot || application.updatedAt !== deletion.deletedAt) {
        conflicts.push({
          code: "application_changed",
          field: null,
          message: "The deleted application changed after deletion.",
          recordId: application.id,
        });
      }
      if (snapshot) {
        const currentDocumentIds = sortedUnique(
          this.listApplicationDocuments(workspaceId, application.id).map(
            ({ id }) => id,
          ),
        );
        if (!isDeepStrictEqual(currentDocumentIds, snapshot.documentIds)) {
          conflicts.push({
            code: "document_relationship_changed",
            field: null,
            message: "Document relationships changed after deletion.",
            recordId: null,
          });
        }
        if (
          application.outlookGraphConnectionId !==
          snapshot.outlookGraphConnectionId
        ) {
          conflicts.push({
            code: "outlook_connection_changed",
            field: null,
            message:
              "The Microsoft Graph connection assignment changed after deletion.",
            recordId: snapshot.outlookGraphConnectionId,
          });
        }
        const evidence = this.database.prepare(
          `SELECT id, application_id AS applicationId, updated_at AS updatedAt
           FROM application_email_evidence
           WHERE workspace_id = ? AND id = ?`,
        );
        for (const expected of snapshot.emailEvidence) {
          const current = evidence.get(workspaceId, expected.id) as
            | { applicationId: string; id: string; updatedAt: string }
            | undefined;
          if (!current || current.applicationId !== application.id) {
            conflicts.push({
              code: "email_evidence_moved",
              field: null,
              message: "Email evidence moved after deletion.",
              recordId: expected.id,
            });
          } else if (current.updatedAt !== expected.updatedAt) {
            conflicts.push({
              code: "source_relationship_changed",
              field: null,
              message: "Email evidence changed after deletion.",
              recordId: expected.id,
            });
          }
        }
        const expectedEvidenceIds = new Set(
          snapshot.emailEvidence.map(({ id }) => id),
        );
        for (const current of this.listEmailEvidence(
          workspaceId,
          application.id,
        )) {
          if (!expectedEvidenceIds.has(current.id)) {
            conflicts.push({
              code: "source_relationship_changed",
              field: null,
              message: "Email evidence was attached after deletion.",
              recordId: current.id,
            });
          }
        }
        const postings = this.database.prepare(
          `SELECT id, application_id AS applicationId, updated_at AS updatedAt
           FROM application_job_postings
           WHERE workspace_id = ? AND id = ?`,
        );
        for (const expected of snapshot.jobPostings) {
          const current = postings.get(workspaceId, expected.id) as
            | { applicationId: string; id: string; updatedAt: string }
            | undefined;
          if (!current || current.applicationId !== application.id) {
            conflicts.push({
              code: "posting_moved",
              field: null,
              message: "Job-posting evidence moved after deletion.",
              recordId: expected.id,
            });
          } else if (current.updatedAt !== expected.updatedAt) {
            conflicts.push({
              code: "source_relationship_changed",
              field: null,
              message: "Job-posting evidence changed after deletion.",
              recordId: expected.id,
            });
          }
        }
        const expectedPostingIds = new Set(
          snapshot.jobPostings.map(({ id }) => id),
        );
        for (const current of this.listJobPostings(
          workspaceId,
          application.id,
        )) {
          if (!expectedPostingIds.has(current.id)) {
            conflicts.push({
              code: "source_relationship_changed",
              field: null,
              message: "Job-posting evidence was attached after deletion.",
              recordId: current.id,
            });
          }
        }
      }
    }
    conflicts.push(
      ...this.inactiveReferenceConflicts(workspaceId, [application]),
    );
    const publicDeletion = this.publicApplicationDeletion(
      deletion,
      application,
    );
    return {
      application,
      conflicts,
      deletion: publicDeletion,
      relationships: this.applicationRecoveryRelationships(
        workspaceId,
        application,
      ),
      safeToRestore: conflicts.length === 0,
    };
  }

  public restoreApplication(
    input: RestoreApplicationRecord,
  ): ApplicationRestoreResult {
    const restore = this.database.transaction(() => {
      const preview = this.previewApplicationRestore(
        input.workspaceId,
        input.applicationId,
      );
      if (preview.deletion.merge !== null) {
        throw new ApplicationRecoveryStateError("merge_recovery_required");
      }
      if (
        preview.deletion.deletedAt !== input.expectedDeletedAt ||
        preview.application.updatedAt !== input.expectedUpdatedAt
      ) {
        throw new ApplicationRecoveryVersionConflictError();
      }
      if (!preview.safeToRestore) {
        throw new ApplicationRestoreUnsafeError(preview);
      }
      const updated = this.database
        .prepare(
          `UPDATE applications
           SET deleted_at = NULL, updated_at = ?
           WHERE workspace_id = ? AND id = ?
             AND deleted_at = ? AND updated_at = ?`,
        )
        .run(
          input.restoredAt,
          input.workspaceId,
          input.applicationId,
          input.expectedDeletedAt,
          input.expectedUpdatedAt,
        );
      if (updated.changes !== 1) {
        throw new ApplicationRecoveryVersionConflictError();
      }
      const restorationId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO application_restorations
             (id, workspace_id, deletion_id, application_id, actor_user_id,
              recovery_type, merge_recovery_id, restored_at)
           VALUES (?, ?, ?, ?, ?, 'manual', NULL, ?)`,
        )
        .run(
          restorationId,
          input.workspaceId,
          preview.deletion.id,
          input.applicationId,
          input.actorUserId,
          input.restoredAt,
        );
      const stored = this.findStoredApplication(
        input.workspaceId,
        input.applicationId,
      );
      if (!stored) throw new ApplicationRecoveryNotFoundError();
      const [application] = this.hydrateApplications(input.workspaceId, [
        stored,
      ]);
      const actorDisplayName = this.database
        .prepare("SELECT display_name FROM users WHERE id = ?")
        .pluck()
        .get(input.actorUserId);
      if (!application || typeof actorDisplayName !== "string") {
        throw new ApplicationRecoveryNotFoundError();
      }
      const restoration: ApplicationRestorationRecord = {
        actorDisplayName,
        applicationId: input.applicationId,
        deletionId: preview.deletion.id,
        id: restorationId,
        recoveryType: "manual",
        restoredAt: input.restoredAt,
      };
      return { application, restoration };
    });
    return restore.immediate();
  }

  public listApplicationEvents(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEvent[] | undefined {
    const applicationExists = this.database
      .prepare(
        `SELECT 1 FROM applications
         WHERE workspace_id = ? AND id = ?
           AND (
             deleted_at IS NULL OR EXISTS (
               SELECT 1 FROM application_merges
               WHERE application_merges.workspace_id = applications.workspace_id
                 AND application_merges.source_application_id = applications.id
             )
           )`,
      )
      .pluck()
      .get(workspaceId, applicationId);
    if (applicationExists === undefined) return undefined;

    return this.database
      .prepare(
        `SELECT
           events.id,
           events.event_type AS type,
           events.from_status AS fromStatus,
         events.to_status AS toStatus,
         events.occurred_at AS occurredAt,
         events.processed_at AS processedAt,
         events.summary,
         events.source_email_evidence_id AS sourceEmailEvidenceId,
         events.source_email_message_id AS sourceEmailMessageId,
         events.status_override_reason AS statusOverrideReason,
         events.idempotency_key AS idempotencyKey,
         events.supersedes_event_id AS supersedesEventId,
         events.correction_reason AS correctionReason,
         actors.display_name AS actorDisplayName
         FROM application_events AS events
         JOIN users AS actors ON actors.id = events.actor_user_id
         WHERE events.workspace_id = ? AND events.application_id = ?
         ORDER BY events.occurred_at DESC, events.sequence DESC`,
      )
      .all(workspaceId, applicationId) as ApplicationEvent[];
  }

  public listApplicationEventsPage(
    workspaceId: string,
    applicationId: string,
    input: { limit: number; offset: number },
  ): ApplicationEventsPage | undefined {
    const applicationExists = this.database
      .prepare(
        `SELECT 1 FROM applications
         WHERE workspace_id = ? AND id = ?
           AND (
             deleted_at IS NULL OR EXISTS (
               SELECT 1 FROM application_merges
               WHERE application_merges.workspace_id = applications.workspace_id
                 AND application_merges.source_application_id = applications.id
             )
           )`,
      )
      .pluck()
      .get(workspaceId, applicationId);
    if (applicationExists === undefined) return undefined;
    const total = this.database
      .prepare(
        `SELECT count(*) FROM application_events
         WHERE workspace_id = ? AND application_id = ?`,
      )
      .pluck()
      .get(workspaceId, applicationId) as number;
    const events = this.database
      .prepare(
        `SELECT
           events.id,
           events.event_type AS type,
           events.from_status AS fromStatus,
           events.to_status AS toStatus,
           events.occurred_at AS occurredAt,
           events.processed_at AS processedAt,
           events.summary,
           events.source_email_evidence_id AS sourceEmailEvidenceId,
           events.source_email_message_id AS sourceEmailMessageId,
           events.status_override_reason AS statusOverrideReason,
           events.idempotency_key AS idempotencyKey,
           events.supersedes_event_id AS supersedesEventId,
           events.correction_reason AS correctionReason,
           actors.display_name AS actorDisplayName
         FROM application_events AS events
         JOIN users AS actors ON actors.id = events.actor_user_id
         WHERE events.workspace_id = ? AND events.application_id = ?
         ORDER BY events.occurred_at DESC, events.sequence DESC
         LIMIT ? OFFSET ?`,
      )
      .all(
        workspaceId,
        applicationId,
        input.limit,
        input.offset,
      ) as ApplicationEvent[];
    const returned = events.length;
    return {
      events,
      limit: input.limit,
      nextOffset:
        input.offset + returned < total ? input.offset + returned : null,
      offset: input.offset,
      returned,
      total,
    };
  }

  public addApplicationActivity(
    input: AddApplicationActivityRecord,
  ): ApplicationActivityEvent | undefined {
    const add = this.database.transaction(() => {
      const applicationExists = this.database
        .prepare(
          `SELECT 1 FROM applications
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .pluck()
        .get(input.workspaceId, input.applicationId);
      if (applicationExists === undefined) return undefined;

      if (input.idempotencyKey) {
        const existing = this.database
          .prepare(
            `SELECT
               id,
               application_id AS applicationId,
               actor_user_id AS actorUserId,
               event_type AS type,
               occurred_at AS occurredAt,
               summary,
               source_email_evidence_id AS sourceEmailEvidenceId,
               source_email_message_id AS sourceEmailMessageId,
               supersedes_event_id AS supersedesEventId,
               correction_reason AS correctionReason
             FROM application_events
             WHERE workspace_id = ? AND idempotency_key = ?`,
          )
          .get(input.workspaceId, input.idempotencyKey) as
          | (Omit<
              AddApplicationActivityRecord,
              "idempotencyKey" | "processedAt" | "workspaceId"
            > & {
              id: string;
            })
          | undefined;
        if (existing) {
          const exactRetry =
            existing.actorUserId === input.actorUserId &&
            existing.applicationId === input.applicationId &&
            existing.correctionReason === input.correctionReason &&
            existing.occurredAt === input.occurredAt &&
            existing.sourceEmailEvidenceId === input.sourceEmailEvidenceId &&
            existing.sourceEmailMessageId === input.sourceEmailMessageId &&
            existing.summary === input.summary &&
            existing.supersedesEventId === input.supersedesEventId &&
            existing.type === input.type;
          if (!exactRetry) {
            throw new ApplicationActivityIdempotencyConflictError();
          }
          const event = this.applicationActivityById(
            input.workspaceId,
            existing.id,
          );
          if (!event) throw new Error("Activity retry could not be read back");
          return event;
        }
      }

      if (input.sourceEmailEvidenceId) {
        const evidenceExists = this.database
          .prepare(
            `SELECT 1 FROM application_email_evidence
             WHERE workspace_id = ? AND application_id = ? AND id = ?`,
          )
          .pluck()
          .get(
            input.workspaceId,
            input.applicationId,
            input.sourceEmailEvidenceId,
          );
        if (evidenceExists === undefined) {
          throw new ApplicationActivityEvidenceError();
        }
      }

      if (input.supersedesEventId) {
        const target = this.database
          .prepare(
            `SELECT application_id AS applicationId, event_type AS type
             FROM application_events
             WHERE workspace_id = ? AND id = ?`,
          )
          .get(input.workspaceId, input.supersedesEventId) as
          { applicationId: string; type: string } | undefined;
        if (
          !target ||
          target.applicationId !== input.applicationId ||
          target.type === "application_created" ||
          target.type === "status_changed"
        ) {
          throw new ApplicationActivityCorrectionError(
            "invalid_correction_target",
          );
        }
        const superseded = this.database
          .prepare(
            `SELECT 1 FROM application_events
             WHERE workspace_id = ? AND supersedes_event_id = ?`,
          )
          .pluck()
          .get(input.workspaceId, input.supersedesEventId);
        if (superseded !== undefined) {
          throw new ApplicationActivityCorrectionError(
            "correction_already_exists",
          );
        }
      }

      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO application_events (
             id, workspace_id, application_id, actor_user_id, event_type,
             from_status, to_status, occurred_at, processed_at, summary,
             source_email_evidence_id, source_email_message_id,
             status_override_reason, idempotency_key, supersedes_event_id,
             correction_reason, sequence
           )
           SELECT ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?,
             COALESCE(MAX(sequence), 0) + 1
           FROM application_events
           WHERE workspace_id = ? AND application_id = ?`,
        )
        .run(
          id,
          input.workspaceId,
          input.applicationId,
          input.actorUserId,
          input.type,
          input.occurredAt,
          input.processedAt,
          input.summary,
          input.sourceEmailEvidenceId,
          input.sourceEmailMessageId,
          input.idempotencyKey,
          input.supersedesEventId,
          input.correctionReason,
          input.workspaceId,
          input.applicationId,
        );
      const event = this.applicationActivityById(input.workspaceId, id);
      if (!event) throw new Error("Created activity could not be read back");
      return event;
    });
    return add.immediate();
  }

  private applicationActivityById(
    workspaceId: string,
    eventId: string,
  ): ApplicationActivityEvent | undefined {
    return this.database
      .prepare(
        `SELECT
           events.id,
           events.event_type AS type,
           events.from_status AS fromStatus,
           events.to_status AS toStatus,
           events.occurred_at AS occurredAt,
           events.processed_at AS processedAt,
           events.summary,
           events.source_email_evidence_id AS sourceEmailEvidenceId,
           events.source_email_message_id AS sourceEmailMessageId,
           events.status_override_reason AS statusOverrideReason,
           events.idempotency_key AS idempotencyKey,
           events.supersedes_event_id AS supersedesEventId,
           events.correction_reason AS correctionReason,
           actors.display_name AS actorDisplayName
         FROM application_events AS events
         JOIN users AS actors ON actors.id = events.actor_user_id
         WHERE events.workspace_id = ? AND events.id = ?
           AND events.event_type NOT IN ('application_created', 'status_changed')`,
      )
      .get(workspaceId, eventId) as ApplicationActivityEvent | undefined;
  }

  public updateApplication(
    input: UpdateApplicationRecord,
  ): ApplicationRecord | undefined {
    const update = this.database.transaction(() => {
      const stored = this.findStoredApplication(
        input.workspaceId,
        input.applicationId,
      );
      if (!stored) return undefined;
      const [current] = this.hydrateApplications(input.workspaceId, [stored]);
      if (!current) return undefined;
      if (current.updatedAt !== input.expectedUpdatedAt) {
        throw new ApplicationConflictError(current);
      }

      const statusId = input.statusId ?? current.statusId;
      const status =
        statusId === current.statusId
          ? {
              isTerminal: current.statusIsTerminal,
              label: current.status,
              sortOrder: this.statusSortOrder(
                input.workspaceId,
                current.statusId,
              ),
            }
          : this.activeReference(input.workspaceId, statusId, "status");

      if (statusId !== current.statusId && input.statusEvent) {
        const existingSourceEvent = input.statusEvent.sourceEmailMessageId
          ? (this.database
              .prepare(
                `SELECT application_id AS applicationId, to_status AS toStatus,
                        occurred_at AS occurredAt
                 FROM application_events
                 WHERE workspace_id = ? AND source_email_message_id = ?`,
              )
              .get(
                input.workspaceId,
                input.statusEvent.sourceEmailMessageId,
              ) as
              | { applicationId: string; occurredAt: string; toStatus: string }
              | undefined)
          : undefined;
        if (existingSourceEvent) {
          if (
            existingSourceEvent.applicationId === input.applicationId &&
            existingSourceEvent.occurredAt === input.statusEvent.effectiveAt &&
            existingSourceEvent.toStatus === status.label
          ) {
            return current;
          }
          throw new ApplicationStatusEventConflictError();
        }

        const latestStatusEvent = this.database
          .prepare(
            `SELECT occurred_at AS occurredAt
             FROM application_events
             WHERE workspace_id = ? AND application_id = ?
               AND event_type IN ('application_created', 'status_changed')
             ORDER BY occurred_at DESC, sequence DESC
             LIMIT 1`,
          )
          .get(input.workspaceId, input.applicationId) as
          { occurredAt: string } | undefined;
        if (
          latestStatusEvent &&
          input.statusEvent.effectiveAt === latestStatusEvent.occurredAt
        ) {
          throw new ApplicationStatusEventConflictError();
        }
        if (
          !input.statusEvent.overrideReason &&
          latestStatusEvent &&
          input.statusEvent.effectiveAt < latestStatusEvent.occurredAt
        ) {
          throw new ApplicationStatusStaleError();
        }
        const currentStatusSortOrder = this.statusSortOrder(
          input.workspaceId,
          current.statusId,
        );
        if (
          !input.statusEvent.overrideReason &&
          status.sortOrder < currentStatusSortOrder
        ) {
          throw new ApplicationStatusRegressionError();
        }
      }
      const sourceId =
        input.sourceId === undefined ? current.sourceId : input.sourceId;
      const roleTypeId =
        input.roleTypeId === undefined ? current.roleTypeId : input.roleTypeId;
      if (sourceId && sourceId !== current.sourceId) {
        this.activeReference(input.workspaceId, sourceId, "source");
      }
      if (roleTypeId && roleTypeId !== current.roleTypeId) {
        this.activeReference(input.workspaceId, roleTypeId, "role_type");
      }
      if (
        input.outlookGraphConnectionId !== undefined &&
        input.outlookGraphConnectionId !== null
      ) {
        this.requireOutlookGraphConnection(
          input.workspaceId,
          input.outlookGraphConnectionId,
        );
      }

      const salaryDetails =
        input.salaryDetails === undefined
          ? current.salaryDetails
          : input.salaryDetails;
      const workArrangement =
        input.workArrangement === undefined
          ? current.workArrangement
          : input.workArrangement;
      const workArrangementDetails =
        input.workArrangementDetails === undefined
          ? current.workArrangementDetails
          : input.workArrangementDetails;
      const officeDays = workArrangementDetails?.officeDaysPerWeek ?? 0;
      const remoteDays = workArrangementDetails?.remoteDaysPerWeek ?? 0;
      if (
        (workArrangement === "remote" && officeDays > 0) ||
        (workArrangement === "office" && remoteDays > 0)
      ) {
        throw new RangeError(
          "Work-arrangement details are incompatible with the classification",
        );
      }

      const updateResult = this.database
        .prepare(
          `UPDATE applications
           SET agency = ?, company_name = ?, role_title = ?, legacy_status = ?,
               status_reference_id = ?, source_reference_id = ?,
               role_type_reference_id = ?, location = ?, source_url = ?,
               applied_on = ?, next_action = ?, next_action_due = ?,
               notes = ?, rating = ?, salary = ?, salary_minimum_amount = ?,
               salary_maximum_amount = ?, salary_currency = ?, salary_period = ?,
               salary_disclosed = ?, salary_negotiable = ?, work_arrangement = ?,
               work_arrangement_text = ?, office_days_per_week = ?,
               remote_days_per_week = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
             AND updated_at = ?`,
        )
        .run(
          input.agency === undefined ? current.agency : input.agency,
          input.companyName ?? current.companyName,
          input.roleTitle ?? current.roleTitle,
          status.isTerminal ? "closed" : "prospect",
          statusId,
          sourceId,
          roleTypeId,
          input.location === undefined ? current.location : input.location,
          input.sourceUrl === undefined ? current.sourceUrl : input.sourceUrl,
          input.appliedOn === undefined ? current.appliedOn : input.appliedOn,
          input.nextAction === undefined
            ? current.nextAction
            : input.nextAction,
          input.nextActionDue === undefined
            ? current.nextActionDue
            : input.nextActionDue,
          input.notes === undefined ? current.notes : input.notes,
          input.rating === undefined ? current.rating : input.rating,
          input.salary === undefined ? current.salary : input.salary,
          salaryDetails?.minimum ?? null,
          salaryDetails?.maximum ?? null,
          salaryDetails?.currency ?? null,
          salaryDetails?.period ?? null,
          salaryDetails === null ? null : Number(salaryDetails.disclosed),
          salaryDetails === null ? null : Number(salaryDetails.negotiable),
          workArrangement,
          workArrangementDetails?.originalText ?? null,
          workArrangementDetails?.officeDaysPerWeek ?? null,
          workArrangementDetails?.remoteDaysPerWeek ?? null,
          input.updatedAt,
          input.workspaceId,
          input.applicationId,
          input.expectedUpdatedAt,
        );

      if (updateResult.changes !== 1) {
        const latestStored = this.findStoredApplication(
          input.workspaceId,
          input.applicationId,
        );
        if (!latestStored) return undefined;
        const [latest] = this.hydrateApplications(input.workspaceId, [
          latestStored,
        ]);
        if (!latest) return undefined;
        throw new ApplicationConflictError(latest);
      }

      if (input.contacts !== undefined) {
        this.replaceContacts(
          input.workspaceId,
          input.applicationId,
          input.contacts,
        );
      }
      if (input.links !== undefined) {
        this.replaceLinks(input.workspaceId, input.applicationId, input.links);
      }
      if (input.outlookGraphConnectionId !== undefined) {
        this.replaceOutlookGraphConnectionAssignment(
          input.workspaceId,
          input.applicationId,
          input.outlookGraphConnectionId,
          input.actorUserId,
          input.updatedAt,
        );
      }

      if (statusId !== current.statusId) {
        this.database
          .prepare(
            `INSERT INTO application_events
               (id, workspace_id, application_id, actor_user_id, event_type,
                from_status, to_status, occurred_at, processed_at,
                source_email_message_id, status_override_reason, sequence)
             VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?, ?, ?, ?,
               (SELECT COALESCE(MAX(sequence), 0) + 1
                FROM application_events
                WHERE workspace_id = ? AND application_id = ?))`,
          )
          .run(
            randomUUID(),
            input.workspaceId,
            input.applicationId,
            input.actorUserId,
            current.status,
            status.label,
            input.statusEvent?.effectiveAt ?? input.updatedAt,
            input.updatedAt,
            input.statusEvent?.sourceEmailMessageId ?? null,
            input.statusEvent?.overrideReason ?? null,
            input.workspaceId,
            input.applicationId,
          );
      }
      const updatedStored = this.findStoredApplication(
        input.workspaceId,
        input.applicationId,
      );
      if (!updatedStored) return undefined;
      const [updated] = this.hydrateApplications(input.workspaceId, [
        updatedStored,
      ]);
      return updated;
    });

    return update.immediate();
  }

  private activeReference(
    workspaceId: string,
    referenceValueId: string,
    category: "role_type" | "source" | "status",
  ): { isTerminal: boolean; label: string; sortOrder: number } {
    const row = this.database
      .prepare(
        `SELECT label, is_terminal AS isTerminal, sort_order AS sortOrder
         FROM reference_values
         WHERE workspace_id = ? AND id = ? AND category = ? AND is_active = 1`,
      )
      .get(workspaceId, referenceValueId, category) as
      { isTerminal: number; label: string; sortOrder: number } | undefined;
    if (!row) throw new InvalidApplicationReferenceError();
    return {
      isTerminal: row.isTerminal === 1,
      label: row.label,
      sortOrder: row.sortOrder,
    };
  }

  private statusSortOrder(
    workspaceId: string,
    referenceValueId: string,
  ): number {
    const sortOrder = this.database
      .prepare(
        `SELECT sort_order
         FROM reference_values
         WHERE workspace_id = ? AND id = ? AND category = 'status'`,
      )
      .pluck()
      .get(workspaceId, referenceValueId);
    if (typeof sortOrder !== "number") {
      throw new InvalidApplicationReferenceError();
    }
    return sortOrder;
  }

  private findStoredApplication(
    workspaceId: string,
    applicationId: string,
  ): StoredApplicationRecord | undefined {
    return this.database
      .prepare(
        `${publicApplicationSelect()}
         WHERE applications.workspace_id = ? AND applications.id = ?
           AND applications.deleted_at IS NULL`,
      )
      .get(workspaceId, applicationId) as StoredApplicationRecord | undefined;
  }
}
