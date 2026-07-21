import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  JobEmailEvidenceConflictError,
  type ApplicationEmailEvidence,
  type ApplicationJobPosting,
  type EvidenceLinkResult,
  type JobEmailReconciliationRepository,
  type LinkApplicationEmailEvidenceInput,
  type LinkApplicationJobPostingInput,
} from "../../application/job_email_reconciliation.js";
import type { JobBoardProvider } from "../../domain/job_board.js";

function jobPostingSelect(): string {
  return `SELECT
            id,
            application_id AS applicationId,
            provider,
            external_posting_id AS externalPostingId,
            canonical_url AS canonicalUrl,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM application_job_postings`;
}

function emailEvidenceSelect(): string {
  return `SELECT
            id,
            application_id AS applicationId,
            message_id AS messageId,
            web_url AS webUrl,
            received_at AS receivedAt,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM application_email_evidence`;
}

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}

export class SqliteJobEmailReconciliationRepository implements JobEmailReconciliationRepository {
  public constructor(private readonly database: Database.Database) {}

  public findApplicationIdsByCanonicalUrl(
    workspaceId: string,
    canonicalUrl: string,
  ): string[] {
    return this.database
      .prepare(
        `SELECT postings.application_id
         FROM application_job_postings AS postings
         JOIN applications
           ON applications.workspace_id = postings.workspace_id
          AND applications.id = postings.application_id
         WHERE postings.workspace_id = ? AND postings.canonical_url = ?
           AND applications.deleted_at IS NULL`,
      )
      .pluck()
      .all(workspaceId, canonicalUrl) as string[];
  }

  public findApplicationIdsByEmailMessageId(
    workspaceId: string,
    messageId: string,
  ): string[] {
    return this.database
      .prepare(
        `SELECT evidence.application_id
         FROM application_email_evidence AS evidence
         JOIN applications
           ON applications.workspace_id = evidence.workspace_id
          AND applications.id = evidence.application_id
         WHERE evidence.workspace_id = ? AND evidence.message_id = ?
           AND applications.deleted_at IS NULL`,
      )
      .pluck()
      .all(workspaceId, messageId) as string[];
  }

  public findApplicationIdsByPostingId(
    workspaceId: string,
    provider: JobBoardProvider,
    externalPostingId: string,
  ): string[] {
    return this.database
      .prepare(
        `SELECT postings.application_id
         FROM application_job_postings AS postings
         JOIN applications
           ON applications.workspace_id = postings.workspace_id
          AND applications.id = postings.application_id
         WHERE postings.workspace_id = ? AND postings.provider = ?
           AND postings.external_posting_id = ?
           AND applications.deleted_at IS NULL`,
      )
      .pluck()
      .all(workspaceId, provider, externalPostingId) as string[];
  }

  public linkEmailEvidence(
    input: LinkApplicationEmailEvidenceInput,
  ): EvidenceLinkResult<ApplicationEmailEvidence> {
    const existing = this.database
      .prepare(
        `${emailEvidenceSelect()}
         WHERE workspace_id = ? AND message_id = ?`,
      )
      .get(input.workspaceId, input.messageId) as
      ApplicationEmailEvidence | undefined;
    if (existing) {
      if (
        existing.applicationId !== input.applicationId ||
        existing.receivedAt !== input.receivedAt ||
        (existing.webUrl !== null &&
          input.webUrl !== null &&
          existing.webUrl !== input.webUrl)
      ) {
        throw new JobEmailEvidenceConflictError();
      }
      if (existing.webUrl === null && input.webUrl !== null) {
        this.database
          .prepare(
            `UPDATE application_email_evidence
             SET web_url = ?, updated_at = ?
             WHERE workspace_id = ? AND id = ?`,
          )
          .run(input.webUrl, input.occurredAt, input.workspaceId, existing.id);
        return {
          created: false,
          record: {
            ...existing,
            updatedAt: input.occurredAt,
            webUrl: input.webUrl,
          },
        };
      }
      return { created: false, record: existing };
    }

    const record: ApplicationEmailEvidence = {
      applicationId: input.applicationId,
      createdAt: input.occurredAt,
      id: randomUUID(),
      messageId: input.messageId,
      receivedAt: input.receivedAt,
      updatedAt: input.occurredAt,
      webUrl: input.webUrl,
    };
    try {
      this.database
        .prepare(
          `INSERT INTO application_email_evidence
             (id, workspace_id, application_id, message_id, web_url,
              received_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          input.workspaceId,
          record.applicationId,
          record.messageId,
          record.webUrl,
          record.receivedAt,
          record.createdAt,
          record.updatedAt,
        );
      return { created: true, record };
    } catch (error) {
      if (isConstraintError(error)) {
        throw new JobEmailEvidenceConflictError();
      }
      throw error;
    }
  }

  public linkJobPosting(
    input: LinkApplicationJobPostingInput,
  ): EvidenceLinkResult<ApplicationJobPosting> {
    const byIdentity = input.externalPostingId
      ? (this.database
          .prepare(
            `${jobPostingSelect()}
             WHERE workspace_id = ? AND provider = ?
               AND external_posting_id = ?`,
          )
          .get(input.workspaceId, input.provider, input.externalPostingId) as
          ApplicationJobPosting | undefined)
      : undefined;
    const byUrl = input.canonicalUrl
      ? (this.database
          .prepare(
            `${jobPostingSelect()}
             WHERE workspace_id = ? AND canonical_url = ?`,
          )
          .get(input.workspaceId, input.canonicalUrl) as
          ApplicationJobPosting | undefined)
      : undefined;
    if (byIdentity && byUrl && byIdentity.id !== byUrl.id) {
      throw new JobEmailEvidenceConflictError();
    }
    const existing = byIdentity ?? byUrl;
    if (existing) {
      if (existing.applicationId !== input.applicationId) {
        throw new JobEmailEvidenceConflictError();
      }
      const canUpgradeGeneric =
        existing.provider === "generic" &&
        existing.externalPostingId === null &&
        input.externalPostingId !== null;
      if (
        (!canUpgradeGeneric && existing.provider !== input.provider) ||
        (existing.externalPostingId !== null &&
          existing.externalPostingId !== input.externalPostingId) ||
        (existing.canonicalUrl !== null &&
          input.canonicalUrl !== null &&
          existing.canonicalUrl !== input.canonicalUrl)
      ) {
        throw new JobEmailEvidenceConflictError();
      }
      const provider = canUpgradeGeneric ? input.provider : existing.provider;
      const externalPostingId =
        existing.externalPostingId ?? input.externalPostingId;
      const canonicalUrl = existing.canonicalUrl ?? input.canonicalUrl;
      if (
        provider !== existing.provider ||
        externalPostingId !== existing.externalPostingId ||
        canonicalUrl !== existing.canonicalUrl
      ) {
        try {
          this.database
            .prepare(
              `UPDATE application_job_postings
               SET provider = ?, external_posting_id = ?, canonical_url = ?,
                   updated_at = ?
               WHERE workspace_id = ? AND id = ?`,
            )
            .run(
              provider,
              externalPostingId,
              canonicalUrl,
              input.occurredAt,
              input.workspaceId,
              existing.id,
            );
        } catch (error) {
          if (isConstraintError(error)) {
            throw new JobEmailEvidenceConflictError();
          }
          throw error;
        }
        return {
          created: false,
          record: {
            ...existing,
            canonicalUrl,
            externalPostingId,
            provider,
            updatedAt: input.occurredAt,
          },
        };
      }
      return { created: false, record: existing };
    }

    const record: ApplicationJobPosting = {
      applicationId: input.applicationId,
      canonicalUrl: input.canonicalUrl,
      createdAt: input.occurredAt,
      externalPostingId: input.externalPostingId,
      id: randomUUID(),
      provider: input.provider,
      updatedAt: input.occurredAt,
    };
    try {
      this.database
        .prepare(
          `INSERT INTO application_job_postings
             (id, workspace_id, application_id, provider,
              external_posting_id, canonical_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          input.workspaceId,
          record.applicationId,
          record.provider,
          record.externalPostingId,
          record.canonicalUrl,
          record.createdAt,
          record.updatedAt,
        );
      return { created: true, record };
    } catch (error) {
      if (isConstraintError(error)) {
        throw new JobEmailEvidenceConflictError();
      }
      throw error;
    }
  }

  public listEmailEvidence(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEmailEvidence[] {
    return this.database
      .prepare(
        `${emailEvidenceSelect()}
         WHERE workspace_id = ? AND application_id = ?
         ORDER BY received_at DESC, id`,
      )
      .all(workspaceId, applicationId) as ApplicationEmailEvidence[];
  }

  public listJobPostings(
    workspaceId: string,
    applicationId: string,
  ): ApplicationJobPosting[] {
    return this.database
      .prepare(
        `${jobPostingSelect()}
         WHERE workspace_id = ? AND application_id = ?
         ORDER BY created_at, id`,
      )
      .all(workspaceId, applicationId) as ApplicationJobPosting[];
  }
}
