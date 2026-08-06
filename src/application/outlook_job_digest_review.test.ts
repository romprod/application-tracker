import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "./auth.js";
import type {
  OutlookJobDigestConnection,
  OutlookJobDigestProcessingResult,
} from "./outlook_job_digest.js";
import type {
  OutlookJobDigestReviewCheckpoint,
  OutlookJobDigestReviewCommitInput,
  OutlookJobDigestReviewRepository,
} from "./outlook_job_digest_review.js";
import { OutlookJobDigestReviewService } from "./outlook_job_digest_review.js";
import type {
  OutlookMailMessageDetail,
  OutlookMailMessageSummary,
  OutlookMailReader,
} from "./outlook_email_sync.js";

const actor: AuthenticatedActor = {
  user: {
    displayName: "Alex Example",
    role: "admin",
    username: "alex",
  },
  userId: "user-1",
  workspaceId: "workspace-1",
};
const sourceFingerprint =
  "a2c2e30dcf03d542aa8620b0b1d2a4c701c79530dad5c9b73060dd2990f56c1c";

function message(
  receivedAt = "2026-08-06T08:30:00.000Z",
): OutlookMailMessageDetail {
  return {
    body: {
      content:
        '<a href="https://www.linkedin.com/jobs/view/4405273020">Platform role</a>',
      contentType: "html",
    },
    bodyPreview: "A new job matches your preferences",
    from: { address: "alerts@example.com", name: "Job alerts" },
    headers: [
      { name: "List-Unsubscribe", value: "<https://example.com/unsubscribe>" },
    ],
    id: `graph-${receivedAt}`,
    internetMessageId: `<digest-${receivedAt}@example.com>`,
    receivedAt,
    replyTo: [],
    subject: "Daily job alert",
    webUrl: null,
  };
}

function summary(value: OutlookMailMessageDetail): OutlookMailMessageSummary {
  return {
    bodyPreview: value.bodyPreview,
    from: value.from,
    id: value.id,
    internetMessageId: value.internetMessageId,
    receivedAt: value.receivedAt,
    searchKinds: [],
    subject: value.subject,
    webUrl: value.webUrl,
  };
}

function processed(
  value: OutlookMailMessageDetail,
): OutlookJobDigestProcessingResult {
  return {
    classification: "marketing_or_digest",
    connection: {
      folderPath: "Inbox\\Jobs",
      id: "11111111-1111-4111-8111-111111111111",
      mailbox: "jobs@example.com",
      name: "Work tenant",
    },
    digest: {
      messageId: value.internetMessageId!,
      receivedAt: value.receivedAt,
      sender: value.from!.address,
      subject: value.subject,
    },
    outcome: "processed",
    page: { nextOffset: null, offset: 0, returned: 1, total: 1 },
    postings: [
      {
        candidate: {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin",
          redirectsFollowed: 0,
          resolution: "deterministic",
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
        descriptionTruncated: false,
        digestFallback: { attempted: false, unavailableReason: null },
        inspection: {
          applyUrl: null,
          canonicalUrl: "https://www.linkedin.com/jobs/view/4405273020",
          closingDate: "2026-08-31",
          description: "Long description that the review result must omit",
          employer: "Example Company",
          location: "London",
          salary: "GBP 80,000 YEAR",
          status: "available",
          title: "Platform Engineer",
          workArrangement: "hybrid",
        },
        inspectionSource: "provider_page",
        match: { level: null, matches: [], outcome: "none" },
      },
    ],
    tracking: { attempted: 0, resolved: 0, unavailable: [] },
    verification: {
      exactMessageMatches: 1,
      mailboxReadOnly: true,
      messageBodyReturned: false,
    },
  };
}

function harness(
  checkpoint?: OutlookJobDigestReviewCheckpoint,
  options: {
    commitConflict?: boolean;
    connectionUpdatedAt?: string;
    mailbox?: string;
    messages?: OutlookMailMessageDetail[];
    reviewedMessageIds?: Set<string>;
  } = {},
) {
  let storedCheckpoint = checkpoint;
  const storedCommits: OutlookJobDigestReviewCommitInput[] = [];
  const details = options.messages ?? [message()];
  const listMessagesReceivedBetween = vi.fn(() =>
    Promise.resolve({ messages: details.map(summary), truncated: false }),
  );
  const getMessages = vi.fn(() => Promise.resolve(details));
  const reader: OutlookMailReader = {
    getMessages,
    listMessagesReceivedBetween,
    searchMessages: () => Promise.resolve({ messages: [], queriesRun: 0 }),
    validateEvidence: () => Promise.resolve([]),
  };
  const repository: OutlookJobDigestReviewRepository = {
    commitReview: (input) => {
      storedCommits.push(input);
      if (options.commitConflict) return undefined;
      storedCheckpoint = {
        connectionId: input.connectionId,
        connectionUpdatedAt: input.connectionUpdatedAt,
        lastCompletedAt: input.completedAt,
        sourceFingerprint: input.sourceFingerprint,
        updatedAt: input.reviewedAt,
        workspaceId: input.workspaceId,
      };
      return storedCheckpoint;
    },
    findCheckpoint: () => storedCheckpoint,
    findReviewedMessageIds: () => options.reviewedMessageIds ?? new Set(),
  };
  const processor = {
    reviewMessage: vi.fn(
      (
        _actor: AuthenticatedActor,
        _connection: OutlookJobDigestConnection,
        value: OutlookMailMessageDetail,
      ) => processed(value),
    ),
  };
  const service = new OutlookJobDigestReviewService(
    {
      forReconciliation: vi.fn(() => ({
        connection: {
          createdAt: "2026-07-01T00:00:00.000Z",
          folderPath: "Inbox\\Jobs",
          id: "11111111-1111-4111-8111-111111111111",
          lastReconciledAt: null,
          mailbox: options.mailbox ?? "jobs@example.com",
          name: "Work tenant",
          updatedAt: options.connectionUpdatedAt ?? "2026-07-01T00:00:00.000Z",
        },
        mail: reader,
      })),
    },
    processor,
    repository,
    () => new Date("2026-08-06T09:00:00.000Z"),
  );
  return {
    getMessages,
    listMessagesReceivedBetween,
    processor,
    service,
    storedCommits,
  };
}

describe("OutlookJobDigestReviewService", () => {
  it("bootstraps from now without reading or processing historical mail", async () => {
    const value = harness();

    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });
    const result = value.service.commit(actor, prepared);

    expect(result).toMatchObject({
      checkpoint: {
        hasMore: false,
        initialized: true,
        previousCompletedAt: null,
        storedCompletedAt: "2026-08-06T09:00:00.000Z",
      },
      counts: {
        digestsProcessed: 0,
        messagesScanned: 0,
        postingsInspected: 0,
      },
      outcome: "initialized",
      verification: {
        applicationStateChanged: false,
        checkpointStored: true,
        mailboxReadOnly: true,
        messageBodyPersisted: false,
        messageBodyReturned: false,
      },
    });
    expect(value.listMessagesReceivedBetween).not.toHaveBeenCalled();
    expect(value.processor.reviewMessage).not.toHaveBeenCalled();
  });

  it("reviews only the bounded window after the stored checkpoint", async () => {
    const value = harness({
      connectionId: "11111111-1111-4111-8111-111111111111",
      connectionUpdatedAt: "2026-07-01T00:00:00.000Z",
      lastCompletedAt: "2026-08-06T08:00:00.000Z",
      sourceFingerprint,
      updatedAt: "2026-08-06T08:00:00.000Z",
      workspaceId: "workspace-1",
    });

    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });
    const result = value.service.commit(actor, prepared);

    expect(value.listMessagesReceivedBetween).toHaveBeenCalledWith({
      after: "2026-08-06T08:00:00.000Z",
      through: "2026-08-06T09:00:00.000Z",
    });
    expect(result).toMatchObject({
      checkpoint: {
        hasMore: false,
        initialized: false,
        previousCompletedAt: "2026-08-06T08:00:00.000Z",
        storedCompletedAt: "2026-08-06T09:00:00.000Z",
      },
      counts: {
        alreadyTracked: 0,
        ambiguous: 0,
        conflicting: 0,
        digestsProcessed: 1,
        expired: 0,
        messagesScanned: 1,
        postingsInspected: 1,
        unavailable: 0,
        unprocessed: 1,
      },
      outcome: "reviewed",
    });
    expect(result.digests[0]?.postings[0]).toMatchObject({
      outcome: "unprocessed",
      retry: { eligible: false, retryAfter: null },
    });
    expect(JSON.stringify(result)).not.toContain("Long description");
    expect(value.storedCommits[0]?.messages[0]).toMatchObject({
      classification: "marketing_or_digest",
      postingCount: 1,
    });
  });

  it("advances through at most five timestamp-safe messages and reports more", async () => {
    const details = Array.from({ length: 6 }, (_, index) =>
      message(`2026-08-06T08:0${String(index + 1)}:00.000Z`),
    );
    const value = harness(
      {
        connectionId: "11111111-1111-4111-8111-111111111111",
        connectionUpdatedAt: "2026-07-01T00:00:00.000Z",
        lastCompletedAt: "2026-08-06T08:00:00.000Z",
        sourceFingerprint,
        updatedAt: "2026-08-06T08:00:00.000Z",
        workspaceId: "workspace-1",
      },
      { messages: details },
    );

    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });
    const result = value.service.commit(actor, prepared);

    expect(result.checkpoint).toMatchObject({
      hasMore: true,
      storedCompletedAt: "2026-08-06T08:05:00.000Z",
    });
    expect(result.counts).toMatchObject({
      digestsProcessed: 5,
      messagesScanned: 5,
      postingsInspected: 5,
    });
    expect(value.processor.reviewMessage).toHaveBeenCalledTimes(5);
  });

  it("does not process a duplicate RFC Message-ID again", async () => {
    const detail = message();
    const value = harness(
      {
        connectionId: "11111111-1111-4111-8111-111111111111",
        connectionUpdatedAt: "2026-07-01T00:00:00.000Z",
        lastCompletedAt: "2026-08-06T08:00:00.000Z",
        sourceFingerprint,
        updatedAt: "2026-08-06T08:00:00.000Z",
        workspaceId: "workspace-1",
      },
      { reviewedMessageIds: new Set([detail.internetMessageId!]) },
    );

    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });
    const result = value.service.commit(actor, prepared);

    expect(result.counts.alreadyReviewedMessages).toBe(1);
    expect(result.reviewedMessageIds).toEqual([]);
    expect(value.processor.reviewMessage).not.toHaveBeenCalled();
  });

  it("keeps the checkpoint when connection metadata changes but its mail source does not", async () => {
    const value = harness(
      {
        connectionId: "11111111-1111-4111-8111-111111111111",
        connectionUpdatedAt: "2026-07-01T00:00:00.000Z",
        lastCompletedAt: "2026-08-06T08:00:00.000Z",
        sourceFingerprint,
        updatedAt: "2026-08-06T08:00:00.000Z",
        workspaceId: "workspace-1",
      },
      { connectionUpdatedAt: "2026-08-06T08:15:00.000Z" },
    );

    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });
    const result = value.service.commit(actor, prepared);

    expect(result.outcome).toBe("reviewed");
    expect(result.checkpoint.initialized).toBe(false);
    expect(value.listMessagesReceivedBetween).toHaveBeenCalled();
    expect(value.storedCommits[0]?.connectionUpdatedAt).toBe(
      "2026-08-06T08:15:00.000Z",
    );
  });

  it("initializes a new boundary when the configured mailbox changes", async () => {
    const value = harness(
      {
        connectionId: "11111111-1111-4111-8111-111111111111",
        connectionUpdatedAt: "2026-07-01T00:00:00.000Z",
        lastCompletedAt: "2026-08-06T08:00:00.000Z",
        sourceFingerprint,
        updatedAt: "2026-08-06T08:00:00.000Z",
        workspaceId: "workspace-1",
      },
      {
        connectionUpdatedAt: "2026-08-06T08:15:00.000Z",
        mailbox: "other-jobs@example.com",
      },
    );

    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });
    const result = value.service.commit(actor, prepared);

    expect(result).toMatchObject({
      checkpoint: {
        initializationReason: "connection_changed",
        initialized: true,
        previousCompletedAt: "2026-08-06T08:00:00.000Z",
      },
      outcome: "initialized",
    });
    expect(value.listMessagesReceivedBetween).not.toHaveBeenCalled();
  });

  it("preserves stable unavailable reasons and retry eligibility", async () => {
    const detail = message();
    const value = harness({
      connectionId: "11111111-1111-4111-8111-111111111111",
      connectionUpdatedAt: "2026-07-01T00:00:00.000Z",
      lastCompletedAt: "2026-08-06T08:00:00.000Z",
      sourceFingerprint,
      updatedAt: "2026-08-06T08:00:00.000Z",
      workspaceId: "workspace-1",
    });
    const result = processed(detail);
    result.postings[0] = {
      ...result.postings[0]!,
      digestFallback: {
        attempted: true,
        unavailableReason: "employer_missing",
      },
      inspection: {
        canonicalUrl: "https://www.linkedin.com/jobs/view/4405273020",
        reason: "provider_challenge",
        retryAfter: "2026-08-06T09:15:00.000Z",
        status: "unavailable",
      },
    };
    value.processor.reviewMessage.mockReturnValue(result);

    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });
    const reviewed = value.service.commit(actor, prepared);

    expect(reviewed.counts).toMatchObject({ unavailable: 1, unprocessed: 0 });
    expect(reviewed.unavailableReasons).toEqual([
      { count: 1, reason: "employer_missing" },
      { count: 1, reason: "provider_challenge" },
    ]);
    expect(reviewed.digests[0]?.postings[0]?.retry).toEqual({
      eligible: true,
      retryAfter: "2026-08-06T09:15:00.000Z",
    });
    expect(value.storedCommits[0]?.messages[0]?.postings[0]).toMatchObject({
      retryEligible: true,
      unavailableReason: "provider_challenge",
    });
  });

  it("reports an optimistic checkpoint conflict without verification", async () => {
    const value = harness(
      {
        connectionId: "11111111-1111-4111-8111-111111111111",
        connectionUpdatedAt: "2026-07-01T00:00:00.000Z",
        lastCompletedAt: "2026-08-06T08:00:00.000Z",
        sourceFingerprint,
        updatedAt: "2026-08-06T08:00:00.000Z",
        workspaceId: "workspace-1",
      },
      { commitConflict: true },
    );
    const prepared = await value.service.prepare(actor, {
      connection: "Work tenant",
    });

    expect(() => value.service.commit(actor, prepared)).toThrowError(
      expect.objectContaining({ code: "outlook_digest_review_conflict" }),
    );
  });
});
