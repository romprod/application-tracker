import { describe, expect, it } from "vitest";
import { openApplicationDatabase } from "./connection.js";
import { SqliteOutlookGraphConnectionsRepository } from "./outlook_graph_connections_repository.js";
import { SqliteOutlookJobDigestReviewRepository } from "./outlook_job_digest_review_repository.js";

describe("SqliteOutlookJobDigestReviewRepository", () => {
  it("stores bounded review metadata and rejects stale checkpoint commits", () => {
    const database = openApplicationDatabase(":memory:");
    const workspaceId = "workspace-review";
    const userId = "user-review";
    const connectionId = "33333333-3333-4333-8333-333333333333";
    const connectionUpdatedAt = "2026-08-06T08:00:00.000Z";
    const sourceFingerprint = "a".repeat(64);
    try {
      database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES (?, 'Review', 'review', ?)`,
        )
        .run(workspaceId, connectionUpdatedAt);
      database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES (?, 'reviewer', 'Reviewer', 'active', ?, ?)`,
        )
        .run(userId, connectionUpdatedAt, connectionUpdatedAt);
      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'admin', ?)`,
        )
        .run(workspaceId, userId, connectionUpdatedAt);
      new SqliteOutlookGraphConnectionsRepository(database).save({
        clientId: "22222222-2222-4222-8222-222222222222",
        clientSecretEncrypted: "v1.encrypted-client-secret-material",
        createdAt: connectionUpdatedAt,
        enabled: true,
        folderPath: "Inbox\\Jobs",
        id: connectionId,
        lastErrorCode: null,
        lastReconciledAt: null,
        lastTestedAt: connectionUpdatedAt,
        mailbox: "jobs@example.com",
        name: "Work tenant",
        tenantId: "11111111-1111-4111-8111-111111111111",
        updatedAt: connectionUpdatedAt,
        updatedByUserId: userId,
        verifiedAt: connectionUpdatedAt,
        workspaceId,
      });
      const repository = new SqliteOutlookJobDigestReviewRepository(database);
      const initializedAt = "2026-08-06T09:00:00.000Z";
      const initialized = repository.commitReview({
        completedAt: initializedAt,
        connectionId,
        connectionUpdatedAt,
        expectedCheckpoint: null,
        messages: [],
        reviewedAt: initializedAt,
        sourceFingerprint,
        updatedByUserId: userId,
        workspaceId,
      });
      expect(initialized).toMatchObject({ lastCompletedAt: initializedAt });

      const reviewedAt = "2026-08-06T10:00:00.000Z";
      const messageId = "<digest-1@example.com>";
      const updated = repository.commitReview({
        completedAt: reviewedAt,
        connectionId,
        connectionUpdatedAt,
        expectedCheckpoint: initialized!,
        messages: [
          {
            classification: "marketing_or_digest",
            messageId,
            postingCount: 1,
            postings: [
              {
                canonicalUrl: "https://www.linkedin.com/jobs/view/4405273020",
                externalPostingId: "4405273020",
                occurrenceIndex: 0,
                outcome: "unavailable",
                postingIdentity: "a".repeat(64),
                provider: "linkedin",
                retryAfter: "2026-08-06T10:15:00.000Z",
                retryEligible: true,
                unavailableReason: "provider_challenge",
              },
            ],
            receivedAt: "2026-08-06T09:30:00.000Z",
          },
        ],
        reviewedAt,
        sourceFingerprint,
        updatedByUserId: userId,
        workspaceId,
      });

      expect(updated).toMatchObject({ lastCompletedAt: reviewedAt });
      expect(
        repository.findReviewedMessageIds(workspaceId, connectionId, [
          messageId,
          "<missing@example.com>",
        ]),
      ).toEqual(new Set([messageId]));
      expect(
        database
          .prepare(
            `SELECT outcome, unavailable_reason AS unavailableReason,
                    retry_eligible AS retryEligible,
                    retry_after AS retryAfter
             FROM outlook_job_digest_review_postings`,
          )
          .get(),
      ).toEqual({
        outcome: "unavailable",
        retryAfter: "2026-08-06T10:15:00.000Z",
        retryEligible: 1,
        unavailableReason: "provider_challenge",
      });
      expect(
        repository.commitReview({
          completedAt: "2026-08-06T11:00:00.000Z",
          connectionId,
          connectionUpdatedAt,
          expectedCheckpoint: initialized!,
          messages: [],
          reviewedAt: "2026-08-06T11:00:00.000Z",
          sourceFingerprint,
          updatedByUserId: userId,
          workspaceId,
        }),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
