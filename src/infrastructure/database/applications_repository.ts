import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type Database from "better-sqlite3";

import {
  ApplicationConflictError,
  ApplicationMergeNotFoundError,
  ApplicationMergeStateError,
  ApplicationMergeUnsafeError,
  ApplicationMergeVersionConflictError,
  ApplicationStatusEventConflictError,
  ApplicationStatusRegressionError,
  ApplicationStatusStaleError,
  InvalidApplicationReferenceError,
  type ApplicationDuplicateAudit,
  type ApplicationDuplicateCandidate,
  type ApplicationDuplicateReason,
  type ApplicationContact,
  type ApplicationEvent,
  type ApplicationLink,
  type ApplicationMergeFieldConflict,
  type ApplicationMergeFieldValue,
  type ApplicationMergeLineage,
  type ApplicationMergePreview,
  type ApplicationMergeRelationshipPreview,
  type ApplicationMergeResult,
  type ApplicationRecord,
  type ApplyApplicationMergeRecord,
  type ApplicationsRepository,
  type CreateApplicationRecord,
  type DeleteApplicationRecord,
  type UpdateApplicationRecord,
} from "../../application/applications.js";
import type {
  ApplicationEmailEvidence,
  ApplicationJobPosting,
} from "../../application/job_email_reconciliation.js";
import type { DocumentRecord } from "../../application/documents.js";
import {
  maximumApplicationRelations,
  type ApplicationMergeField,
  type ApplicationMergeResolutions,
  type AuditDuplicateApplicationsInput,
} from "../../domain/applications.js";

interface StoredApplicationRecord extends Omit<
  ApplicationRecord,
  "contacts" | "links" | "statusIsTerminal"
> {
  statusIsTerminal: number;
}

type StoredContact = ApplicationContact & { applicationId: string };
type StoredLink = ApplicationLink & { applicationId: string };

interface StoredApplicationMerge extends ApplicationMergeLineage {
  resolutionsJson: string;
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
const duplicateCandidatePairsSql = `
  WITH candidate_pairs AS (
    SELECT first.id AS firstId, second.id AS secondId
    FROM applications AS first
    JOIN applications AS second
      ON second.workspace_id = first.workspace_id
     AND second.id > first.id
    WHERE first.workspace_id = ?
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
            applications.rating,
            applications.salary,
            applications.created_at AS createdAt,
            applications.updated_at AS updatedAt,
            applications.work_arrangement AS workArrangement
          FROM applications AS applications
          JOIN reference_values AS statuses
            ON statuses.id = applications.status_reference_id
          LEFT JOIN reference_values AS sources
            ON sources.id = applications.source_reference_id
          LEFT JOIN reference_values AS role_types
            ON role_types.id = applications.role_type_reference_id`;
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
           merges.merged_at AS mergedAt,
           actors.display_name AS actorDisplayName
         FROM application_merges AS merges
         JOIN users AS actors ON actors.id = merges.actor_user_id
         WHERE merges.workspace_id = ? AND merges.source_application_id = ?`,
      )
      .get(workspaceId, sourceApplicationId) as
      StoredApplicationMerge | undefined;
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
           events.source_email_message_id AS sourceEmailMessageId,
           events.status_override_reason AS statusOverrideReason,
           actors.display_name AS actorDisplayName
         FROM application_events AS events
         JOIN users AS actors ON actors.id = events.actor_user_id
         WHERE events.workspace_id = ? AND events.application_id = ?
         ORDER BY events.occurred_at DESC, events.rowid DESC`,
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
      .get(workspaceId) as number;
    const pairs = this.database
      .prepare(
        `${duplicateCandidatePairsSql}
         SELECT firstId, secondId
         FROM candidate_pairs
         ORDER BY firstId, secondId
         LIMIT ? OFFSET ?`,
      )
      .all(workspaceId, input.limit, input.offset) as {
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
               work_arrangement = ?,
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
          survivor.workArrangement,
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
                source_email_message_id, status_override_reason)
             VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?, ?, NULL, NULL)`,
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
          );
      }

      const lineageId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO application_merges
             (id, workspace_id, source_application_id, target_application_id,
              actor_user_id, source_updated_at, target_updated_at,
              resolutions_json, merged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  private hydrateApplications(
    workspaceId: string,
    stored: StoredApplicationRecord[],
  ): ApplicationRecord[] {
    if (stored.length === 0) return [];
    const applications = stored.map((application) => ({
      ...application,
      contacts: [] as ApplicationContact[],
      statusIsTerminal: application.statusIsTerminal === 1,
      links: [] as ApplicationLink[],
    }));
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
            notes, rating, salary, work_arrangement, created_by_user_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.workArrangement,
          input.createdByUserId,
          input.createdAt,
          input.createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO application_events
             (id, workspace_id, application_id, actor_user_id, event_type,
              from_status, to_status, occurred_at, processed_at,
              source_email_message_id, status_override_reason)
           VALUES (?, ?, ?, ?, 'application_created', NULL, ?, ?, ?, NULL,
                   NULL)`,
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

  public deleteApplication(input: DeleteApplicationRecord): boolean {
    const remove = this.database.transaction(() => {
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
             (application_id, workspace_id, actor_user_id, deleted_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          input.applicationId,
          input.workspaceId,
          input.actorUserId,
          input.deletedAt,
        );
      return true;
    });

    return remove.immediate();
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
         events.source_email_message_id AS sourceEmailMessageId,
         events.status_override_reason AS statusOverrideReason,
         actors.display_name AS actorDisplayName
         FROM application_events AS events
         JOIN users AS actors ON actors.id = events.actor_user_id
         WHERE events.workspace_id = ? AND events.application_id = ?
         ORDER BY events.occurred_at DESC, events.rowid DESC`,
      )
      .all(workspaceId, applicationId) as ApplicationEvent[];
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
        const existingSourceEvent = this.database
          .prepare(
            `SELECT application_id AS applicationId, to_status AS toStatus,
                    occurred_at AS occurredAt
             FROM application_events
             WHERE workspace_id = ? AND source_email_message_id = ?`,
          )
          .get(input.workspaceId, input.statusEvent.sourceEmailMessageId) as
          | { applicationId: string; occurredAt: string; toStatus: string }
          | undefined;
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
             ORDER BY occurred_at DESC, rowid DESC
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

      const updateResult = this.database
        .prepare(
          `UPDATE applications
           SET agency = ?, company_name = ?, role_title = ?, legacy_status = ?,
               status_reference_id = ?, source_reference_id = ?,
               role_type_reference_id = ?, location = ?, source_url = ?,
               applied_on = ?, next_action = ?, next_action_due = ?,
               notes = ?, rating = ?, salary = ?, work_arrangement = ?,
               updated_at = ?
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
          input.workArrangement === undefined
            ? current.workArrangement
            : input.workArrangement,
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

      if (statusId !== current.statusId) {
        this.database
          .prepare(
            `INSERT INTO application_events
               (id, workspace_id, application_id, actor_user_id, event_type,
                from_status, to_status, occurred_at, processed_at,
                source_email_message_id, status_override_reason)
             VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?, ?, ?, ?)`,
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
