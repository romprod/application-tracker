import { createHash } from "node:crypto";
import type { AuthenticatedActor } from "./auth.js";
import type {
  OutlookJobDigestConnection,
  OutlookJobDigestPosting,
  OutlookJobDigestProcessingResult,
} from "./outlook_job_digest.js";
import type {
  OutlookEmailClassification,
  OutlookMailMessageDetail,
  OutlookMailMessageSummary,
} from "./outlook_email_sync.js";
import { OutlookEmailSyncOperationalError } from "./outlook_email_sync.js";
import type { OutlookGraphConnectionsService } from "./outlook_graph_connections.js";
import type { ReviewNewOutlookJobDigestsInput } from "../domain/outlook_job_digest_review.js";
import type { JobPostingInspectionResult } from "./job_posting_inspection.js";

export const maximumIncrementalDigestReviewMessages = 5;

export interface OutlookJobDigestReviewCheckpoint {
  connectionId: string;
  connectionUpdatedAt: string;
  lastCompletedAt: string;
  sourceFingerprint: string;
  updatedAt: string;
  workspaceId: string;
}

export type OutlookJobDigestReviewPostingOutcome =
  | "already_tracked"
  | "ambiguous"
  | "conflict"
  | "expired"
  | "unavailable"
  | "unprocessed";

export type OutlookJobDigestReviewInspection =
  | Omit<
      Extract<JobPostingInspectionResult, { status: "available" }>,
      "description"
    >
  | Extract<JobPostingInspectionResult, { status: "unavailable" }>;

export interface OutlookJobDigestReviewedPosting extends Omit<
  OutlookJobDigestPosting,
  "descriptionTruncated" | "inspection"
> {
  inspection: OutlookJobDigestReviewInspection;
  outcome: OutlookJobDigestReviewPostingOutcome;
  postingIdentity: string;
  retry: {
    eligible: boolean;
    retryAfter: string | null;
  };
}

export interface OutlookJobDigestReviewedMessage {
  classification: "marketing_or_digest";
  digest: NonNullable<OutlookJobDigestProcessingResult["digest"]>;
  postings: OutlookJobDigestReviewedPosting[];
  tracking: OutlookJobDigestProcessingResult["tracking"];
}

export interface OutlookJobDigestReviewResult {
  checkpoint: {
    hasMore: boolean;
    initializationReason: "connection_changed" | "first_use" | null;
    initialized: boolean;
    previousCompletedAt: string | null;
    storedCompletedAt: string;
  };
  connection: OutlookJobDigestProcessingResult["connection"];
  counts: {
    alreadyReviewedMessages: number;
    alreadyTracked: number;
    ambiguous: number;
    conflicting: number;
    detailsRead: number;
    digestsProcessed: number;
    expired: number;
    messagesScanned: number;
    postingsInspected: number;
    unavailable: number;
    unprocessed: number;
  };
  digests: OutlookJobDigestReviewedMessage[];
  outcome: "initialized" | "reviewed" | "up_to_date";
  reviewedMessageIds: string[];
  unavailableReasons: Array<{ count: number; reason: string }>;
  verification: {
    applicationStateChanged: false;
    checkpointStored: true;
    mailboxReadOnly: true;
    messageBodyPersisted: false;
    messageBodyReturned: false;
  };
  window: {
    after: string | null;
    through: string;
  };
}

export interface OutlookJobDigestReviewStoredPosting {
  canonicalUrl: string;
  externalPostingId: string | null;
  occurrenceIndex: number;
  outcome: OutlookJobDigestReviewPostingOutcome;
  postingIdentity: string;
  provider: OutlookJobDigestPosting["candidate"]["provider"];
  retryAfter: string | null;
  retryEligible: boolean;
  unavailableReason: string | null;
}

export interface OutlookJobDigestReviewStoredMessage {
  classification: OutlookEmailClassification;
  messageId: string;
  postingCount: number;
  postings: OutlookJobDigestReviewStoredPosting[];
  receivedAt: string;
}

export interface OutlookJobDigestReviewCommitInput {
  completedAt: string;
  connectionId: string;
  connectionUpdatedAt: string;
  expectedCheckpoint: OutlookJobDigestReviewCheckpoint | null;
  messages: OutlookJobDigestReviewStoredMessage[];
  reviewedAt: string;
  sourceFingerprint: string;
  updatedByUserId: string;
  workspaceId: string;
}

export interface OutlookJobDigestReviewRepository {
  commitReview(
    input: OutlookJobDigestReviewCommitInput,
  ): OutlookJobDigestReviewCheckpoint | undefined;
  findCheckpoint(
    workspaceId: string,
    connectionId: string,
  ): OutlookJobDigestReviewCheckpoint | undefined;
  findReviewedMessageIds(
    workspaceId: string,
    connectionId: string,
    messageIds: string[],
  ): Set<string>;
}

interface OutlookDigestReviewConnections {
  forReconciliation(
    workspaceId: string,
    selector: string,
  ): ReturnType<OutlookGraphConnectionsService["forReconciliation"]>;
}

interface OutlookDigestReviewProcessor {
  reviewMessage(
    actor: AuthenticatedActor,
    connection: OutlookJobDigestConnection,
    message: OutlookMailMessageDetail,
  ):
    | OutlookJobDigestProcessingResult
    | Promise<OutlookJobDigestProcessingResult>;
}

export interface OutlookJobDigestReviewPrepared {
  commitInput: OutlookJobDigestReviewCommitInput;
  result: Omit<OutlookJobDigestReviewResult, "verification">;
}

function publicConnection(
  connection: OutlookJobDigestConnection,
): OutlookJobDigestReviewResult["connection"] {
  return {
    folderPath: connection.folderPath,
    id: connection.id,
    mailbox: connection.mailbox,
    name: connection.name,
  };
}

function postingIdentity(posting: OutlookJobDigestPosting): string {
  return createHash("sha256")
    .update(posting.candidate.provider)
    .update("\0")
    .update(posting.candidate.externalPostingId ?? "")
    .update("\0")
    .update(posting.inspection.canonicalUrl ?? posting.candidate.url)
    .digest("hex");
}

function sourceFingerprint(connection: OutlookJobDigestConnection): string {
  return createHash("sha256")
    .update(connection.mailbox.trim().toLocaleLowerCase("en"))
    .update("\0")
    .update(connection.folderPath)
    .digest("hex");
}

function postingOutcome(posting: OutlookJobDigestPosting): {
  outcome: OutlookJobDigestReviewPostingOutcome;
  retryAfter: string | null;
  retryEligible: boolean;
  unavailableReason: string | null;
} {
  if (posting.match.outcome === "matched") {
    return {
      outcome: "already_tracked",
      retryAfter: null,
      retryEligible: false,
      unavailableReason: null,
    };
  }
  if (posting.match.outcome === "ambiguous") {
    return {
      outcome: "ambiguous",
      retryAfter: null,
      retryEligible: false,
      unavailableReason: null,
    };
  }
  if (posting.match.outcome === "conflict") {
    return {
      outcome: "conflict",
      retryAfter: null,
      retryEligible: false,
      unavailableReason: null,
    };
  }
  if (posting.inspection.status === "unavailable") {
    const reason = posting.inspection.reason;
    if (reason === "expired") {
      return {
        outcome: "expired",
        retryAfter: null,
        retryEligible: false,
        unavailableReason: reason,
      };
    }
    return {
      outcome: "unavailable",
      retryAfter: posting.inspection.retryAfter ?? null,
      retryEligible: ["blocked", "fetch_failed", "provider_challenge"].includes(
        reason,
      ),
      unavailableReason: reason,
    };
  }
  if (!posting.inspection.employer || !posting.inspection.title) {
    const unavailableReason =
      !posting.inspection.employer && !posting.inspection.title
        ? "employer_and_title_missing"
        : !posting.inspection.employer
          ? "employer_missing"
          : "title_missing";
    return {
      outcome: "unavailable",
      retryAfter: null,
      retryEligible: false,
      unavailableReason,
    };
  }
  return {
    outcome: "unprocessed",
    retryAfter: null,
    retryEligible: false,
    unavailableReason: null,
  };
}

function inspectionSummary(
  inspection: JobPostingInspectionResult,
): OutlookJobDigestReviewInspection {
  if (inspection.status === "unavailable") return inspection;
  return {
    applyUrl: inspection.applyUrl,
    canonicalUrl: inspection.canonicalUrl,
    closingDate: inspection.closingDate,
    employer: inspection.employer,
    location: inspection.location,
    salary: inspection.salary,
    status: inspection.status,
    title: inspection.title,
    workArrangement: inspection.workArrangement,
  };
}

function increment(map: Map<string, number>, reason: string): void {
  map.set(reason, (map.get(reason) ?? 0) + 1);
}

function safeBatch(input: {
  after: string;
  messages: OutlookMailMessageSummary[];
  scanThrough: string;
  truncated: boolean;
}): {
  hasMore: boolean;
  messages: OutlookMailMessageSummary[];
  through: string;
} {
  const eligible = input.messages
    .filter(({ receivedAt }) => {
      const received = Date.parse(receivedAt);
      return (
        received > Date.parse(input.after) &&
        received <= Date.parse(input.scanThrough)
      );
    })
    .sort((left, right) => {
      const difference =
        Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
      if (difference !== 0) return difference;
      return (left.internetMessageId ?? left.id).localeCompare(
        right.internetMessageId ?? right.id,
      );
    })
    .slice(0, maximumIncrementalDigestReviewMessages + 1);
  const hasMore =
    input.truncated || eligible.length > maximumIncrementalDigestReviewMessages;
  const overflowBoundary = hasMore
    ? (eligible.at(maximumIncrementalDigestReviewMessages)?.receivedAt ??
      eligible.at(-1)?.receivedAt)
    : undefined;
  const messages = (
    overflowBoundary
      ? eligible.filter(
          ({ receivedAt }) =>
            Date.parse(receivedAt) < Date.parse(overflowBoundary),
        )
      : eligible
  ).slice(0, maximumIncrementalDigestReviewMessages);
  if (hasMore && messages.length === 0) {
    throw new OutlookEmailSyncOperationalError(
      "outlook_digest_review_message_limit",
    );
  }
  return {
    hasMore,
    messages,
    through: hasMore ? messages.at(-1)!.receivedAt : input.scanThrough,
  };
}

function emptyCounts(): OutlookJobDigestReviewResult["counts"] {
  return {
    alreadyReviewedMessages: 0,
    alreadyTracked: 0,
    ambiguous: 0,
    conflicting: 0,
    detailsRead: 0,
    digestsProcessed: 0,
    expired: 0,
    messagesScanned: 0,
    postingsInspected: 0,
    unavailable: 0,
    unprocessed: 0,
  };
}

export class OutlookJobDigestReviewService {
  public constructor(
    private readonly connections: OutlookDigestReviewConnections,
    private readonly processor: OutlookDigestReviewProcessor,
    private readonly repository: OutlookJobDigestReviewRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async prepare(
    actor: AuthenticatedActor,
    input: ReviewNewOutlookJobDigestsInput,
  ): Promise<OutlookJobDigestReviewPrepared> {
    const target = this.connections.forReconciliation(
      actor.workspaceId,
      input.connection,
    );
    const scanThrough = this.clock().toISOString();
    const checkpoint = this.repository.findCheckpoint(
      actor.workspaceId,
      target.connection.id,
    );
    const currentSourceFingerprint = sourceFingerprint(target.connection);
    const initializationReason = !checkpoint
      ? "first_use"
      : checkpoint.sourceFingerprint !== currentSourceFingerprint
        ? "connection_changed"
        : null;

    if (initializationReason) {
      return {
        commitInput: {
          completedAt: scanThrough,
          connectionId: target.connection.id,
          connectionUpdatedAt: target.connection.updatedAt,
          expectedCheckpoint: checkpoint ?? null,
          messages: [],
          reviewedAt: scanThrough,
          sourceFingerprint: currentSourceFingerprint,
          updatedByUserId: actor.userId,
          workspaceId: actor.workspaceId,
        },
        result: {
          checkpoint: {
            hasMore: false,
            initializationReason,
            initialized: true,
            previousCompletedAt: checkpoint?.lastCompletedAt ?? null,
            storedCompletedAt: scanThrough,
          },
          connection: publicConnection(target.connection),
          counts: emptyCounts(),
          digests: [],
          outcome: "initialized",
          reviewedMessageIds: [],
          unavailableReasons: [],
          window: { after: null, through: scanThrough },
        },
      };
    }
    if (!checkpoint) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_digest_review_conflict",
      );
    }

    if (!target.mail.listMessagesReceivedBetween) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_email_sync_unavailable",
      );
    }
    if (Date.parse(checkpoint.lastCompletedAt) > Date.parse(scanThrough)) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_digest_review_conflict",
      );
    }

    const listed = await target.mail.listMessagesReceivedBetween({
      after: checkpoint.lastCompletedAt,
      through: scanThrough,
    });
    const batch = safeBatch({
      after: checkpoint.lastCompletedAt,
      messages: listed.messages,
      scanThrough,
      truncated: listed.truncated,
    });
    const details = await target.mail.getMessages(
      batch.messages.map(({ id }) => id),
    );
    const detailsById = new Map(details.map((detail) => [detail.id, detail]));
    const candidateMessageIds = details.flatMap(({ internetMessageId }) => {
      const value = internetMessageId?.trim();
      return value ? [value] : [];
    });
    const alreadyReviewed = this.repository.findReviewedMessageIds(
      actor.workspaceId,
      target.connection.id,
      candidateMessageIds,
    );
    const seenMessageIds = new Set(alreadyReviewed);
    const counts = emptyCounts();
    counts.detailsRead = details.length;
    counts.messagesScanned = batch.messages.length;
    const unavailableReasons = new Map<string, number>();
    const digests: OutlookJobDigestReviewedMessage[] = [];
    const messages: OutlookJobDigestReviewStoredMessage[] = [];

    for (const summary of batch.messages) {
      const detail = detailsById.get(summary.id);
      if (!detail) {
        increment(unavailableReasons, "message_detail_unavailable");
        continue;
      }
      const summaryMessageId = summary.internetMessageId?.trim() || null;
      const detailMessageId = detail.internetMessageId?.trim() || null;
      if (!detailMessageId) {
        increment(unavailableReasons, "message_id_missing");
        continue;
      }
      if (summaryMessageId && summaryMessageId !== detailMessageId) {
        increment(unavailableReasons, "message_id_mismatch");
        continue;
      }
      if (seenMessageIds.has(detailMessageId)) {
        counts.alreadyReviewedMessages += 1;
        continue;
      }
      seenMessageIds.add(detailMessageId);

      const processed = await this.processor.reviewMessage(
        actor,
        target.connection,
        detail,
      );
      if (!processed.classification) {
        increment(unavailableReasons, "message_classification_unavailable");
        continue;
      }

      const storedPostings: OutlookJobDigestReviewStoredPosting[] = [];
      if (
        processed.outcome === "processed" &&
        processed.classification === "marketing_or_digest" &&
        processed.digest
      ) {
        counts.digestsProcessed += 1;
        if (
          processed.postings.length === 0 &&
          processed.tracking.unavailable.length === 0
        ) {
          increment(unavailableReasons, "no_job_links");
        }
        for (const unavailable of processed.tracking.unavailable) {
          increment(unavailableReasons, unavailable.reason);
        }

        const postings = processed.postings.map((posting, occurrenceIndex) => {
          const disposition = postingOutcome(posting);
          counts.postingsInspected += 1;
          if (disposition.outcome === "already_tracked")
            counts.alreadyTracked += 1;
          if (disposition.outcome === "ambiguous") counts.ambiguous += 1;
          if (disposition.outcome === "conflict") counts.conflicting += 1;
          if (disposition.outcome === "expired") counts.expired += 1;
          if (disposition.outcome === "unavailable") counts.unavailable += 1;
          if (disposition.outcome === "unprocessed") counts.unprocessed += 1;
          if (disposition.unavailableReason) {
            increment(unavailableReasons, disposition.unavailableReason);
          }
          if (posting.digestFallback.unavailableReason) {
            increment(
              unavailableReasons,
              posting.digestFallback.unavailableReason,
            );
          }
          const identity = postingIdentity(posting);
          storedPostings.push({
            canonicalUrl:
              posting.inspection.canonicalUrl ?? posting.candidate.url,
            externalPostingId: posting.candidate.externalPostingId,
            occurrenceIndex,
            outcome: disposition.outcome,
            postingIdentity: identity,
            provider: posting.candidate.provider,
            retryAfter: disposition.retryAfter,
            retryEligible: disposition.retryEligible,
            unavailableReason: disposition.unavailableReason,
          });
          return {
            candidate: posting.candidate,
            digestFallback: posting.digestFallback,
            inspection: inspectionSummary(posting.inspection),
            inspectionSource: posting.inspectionSource,
            match: posting.match,
            outcome: disposition.outcome,
            postingIdentity: identity,
            retry: {
              eligible: disposition.retryEligible,
              retryAfter: disposition.retryAfter,
            },
          } satisfies OutlookJobDigestReviewedPosting;
        });
        digests.push({
          classification: processed.classification,
          digest: processed.digest,
          postings,
          tracking: processed.tracking,
        });
      }

      messages.push({
        classification: processed.classification,
        messageId: detailMessageId,
        postingCount: storedPostings.length,
        postings: storedPostings,
        receivedAt: detail.receivedAt,
      });
    }

    return {
      commitInput: {
        completedAt: batch.through,
        connectionId: target.connection.id,
        connectionUpdatedAt: target.connection.updatedAt,
        expectedCheckpoint: checkpoint,
        messages,
        reviewedAt: scanThrough,
        sourceFingerprint: currentSourceFingerprint,
        updatedByUserId: actor.userId,
        workspaceId: actor.workspaceId,
      },
      result: {
        checkpoint: {
          hasMore: batch.hasMore,
          initializationReason: null,
          initialized: false,
          previousCompletedAt: checkpoint.lastCompletedAt,
          storedCompletedAt: batch.through,
        },
        connection: publicConnection(target.connection),
        counts,
        digests,
        outcome: batch.messages.length === 0 ? "up_to_date" : "reviewed",
        reviewedMessageIds: messages.map(({ messageId }) => messageId),
        unavailableReasons: [...unavailableReasons]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([reason, count]) => ({ count, reason })),
        window: {
          after: checkpoint.lastCompletedAt,
          through: batch.through,
        },
      },
    };
  }

  public commit(
    actor: AuthenticatedActor,
    prepared: OutlookJobDigestReviewPrepared,
  ): OutlookJobDigestReviewResult {
    if (
      actor.workspaceId !== prepared.commitInput.workspaceId ||
      actor.userId !== prepared.commitInput.updatedByUserId
    ) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_digest_review_conflict",
      );
    }
    const checkpoint = this.repository.commitReview(prepared.commitInput);
    if (
      !checkpoint ||
      checkpoint.lastCompletedAt !== prepared.commitInput.completedAt ||
      checkpoint.connectionUpdatedAt !==
        prepared.commitInput.connectionUpdatedAt ||
      checkpoint.sourceFingerprint !== prepared.commitInput.sourceFingerprint
    ) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_digest_review_conflict",
      );
    }
    return {
      ...prepared.result,
      checkpoint: {
        ...prepared.result.checkpoint,
        storedCompletedAt: checkpoint.lastCompletedAt,
      },
      verification: {
        applicationStateChanged: false,
        checkpointStored: true,
        mailboxReadOnly: true,
        messageBodyPersisted: false,
        messageBodyReturned: false,
      },
    };
  }
}
