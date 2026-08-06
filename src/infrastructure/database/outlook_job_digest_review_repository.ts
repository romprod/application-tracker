import type Database from "better-sqlite3";
import type {
  OutlookJobDigestReviewCheckpoint,
  OutlookJobDigestReviewCommitInput,
  OutlookJobDigestReviewRepository,
} from "../../application/outlook_job_digest_review.js";

interface CheckpointRow {
  connectionId: string;
  connectionUpdatedAt: string;
  lastCompletedAt: string;
  sourceFingerprint: string;
  updatedAt: string;
  workspaceId: string;
}

export class SqliteOutlookJobDigestReviewRepository implements OutlookJobDigestReviewRepository {
  public constructor(private readonly database: Database.Database) {}

  public findCheckpoint(
    workspaceId: string,
    connectionId: string,
  ): OutlookJobDigestReviewCheckpoint | undefined {
    return this.database
      .prepare(
        `SELECT workspace_id AS workspaceId,
                connection_id AS connectionId,
                connection_updated_at AS connectionUpdatedAt,
                source_fingerprint AS sourceFingerprint,
                last_completed_at AS lastCompletedAt,
                updated_at AS updatedAt
         FROM outlook_job_digest_review_checkpoints
         WHERE workspace_id = ? AND connection_id = ?`,
      )
      .get(workspaceId, connectionId) as CheckpointRow | undefined;
  }

  public findReviewedMessageIds(
    workspaceId: string,
    connectionId: string,
    messageIds: string[],
  ): Set<string> {
    if (messageIds.length === 0) return new Set();
    const unique = [...new Set(messageIds)].slice(0, 5);
    const placeholders = unique.map(() => "?").join(", ");
    const stored = this.database
      .prepare(
        `SELECT message_id
         FROM outlook_job_digest_review_messages
         WHERE workspace_id = ?
           AND connection_id = ?
           AND message_id IN (${placeholders})`,
      )
      .pluck()
      .all(workspaceId, connectionId, ...unique) as string[];
    return new Set(stored);
  }

  public commitReview(
    input: OutlookJobDigestReviewCommitInput,
  ): OutlookJobDigestReviewCheckpoint | undefined {
    const connectionUpdatedAt = this.database
      .prepare(
        `SELECT updated_at
         FROM outlook_graph_connections
         WHERE workspace_id = ? AND id = ?`,
      )
      .pluck()
      .get(input.workspaceId, input.connectionId) as string | undefined;
    if (connectionUpdatedAt !== input.connectionUpdatedAt) return undefined;

    const checkpointChanged = input.expectedCheckpoint
      ? this.database
          .prepare(
            `UPDATE outlook_job_digest_review_checkpoints
             SET connection_updated_at = ?,
                 source_fingerprint = ?,
                 last_completed_at = ?,
                 updated_at = ?,
                 updated_by_user_id = ?
             WHERE workspace_id = ?
               AND connection_id = ?
               AND connection_updated_at = ?
               AND source_fingerprint = ?
               AND last_completed_at = ?
               AND updated_at = ?`,
          )
          .run(
            input.connectionUpdatedAt,
            input.sourceFingerprint,
            input.completedAt,
            input.reviewedAt,
            input.updatedByUserId,
            input.workspaceId,
            input.connectionId,
            input.expectedCheckpoint.connectionUpdatedAt,
            input.expectedCheckpoint.sourceFingerprint,
            input.expectedCheckpoint.lastCompletedAt,
            input.expectedCheckpoint.updatedAt,
          ).changes
      : this.database
          .prepare(
            `INSERT OR IGNORE INTO outlook_job_digest_review_checkpoints
               (workspace_id, connection_id, connection_updated_at, source_fingerprint,
                last_completed_at, created_at, updated_at, updated_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.workspaceId,
            input.connectionId,
            input.connectionUpdatedAt,
            input.sourceFingerprint,
            input.completedAt,
            input.reviewedAt,
            input.reviewedAt,
            input.updatedByUserId,
          ).changes;
    if (checkpointChanged !== 1) return undefined;

    const insertMessage = this.database.prepare(
      `INSERT OR IGNORE INTO outlook_job_digest_review_messages
         (workspace_id, connection_id, message_id, received_at,
          classification, posting_count, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPosting = this.database.prepare(
      `INSERT OR IGNORE INTO outlook_job_digest_review_postings
         (workspace_id, connection_id, message_id, occurrence_index,
          posting_identity, provider, external_posting_id, canonical_url,
          outcome, unavailable_reason, retry_eligible, retry_after, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const message of input.messages) {
      insertMessage.run(
        input.workspaceId,
        input.connectionId,
        message.messageId,
        message.receivedAt,
        message.classification,
        message.postingCount,
        input.reviewedAt,
      );
      for (const posting of message.postings) {
        insertPosting.run(
          input.workspaceId,
          input.connectionId,
          message.messageId,
          posting.occurrenceIndex,
          posting.postingIdentity,
          posting.provider,
          posting.externalPostingId,
          posting.canonicalUrl,
          posting.outcome,
          posting.unavailableReason,
          posting.retryEligible ? 1 : 0,
          posting.retryAfter,
          input.reviewedAt,
        );
      }
    }

    return this.findCheckpoint(input.workspaceId, input.connectionId);
  }
}
