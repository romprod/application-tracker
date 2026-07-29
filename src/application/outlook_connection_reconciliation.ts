import type { ApplicationRecord } from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import type {
  JobEmailMatchCandidate,
  JobEmailReconciliationService,
} from "./job_email_reconciliation.js";
import {
  maximumOutlookReconciliationMessages,
  OutlookEmailSyncOperationalError,
  OutlookEmailSyncVerificationError,
  outlookEmailSyncScoringVersion,
  outlookEmailSyncThreshold,
  type OutlookEmailCandidateAssessment,
  type OutlookEmailClassification,
  type OutlookMailMessageDetail,
  type OutlookMailMessageSummary,
  type OutlookEmailSyncService,
} from "./outlook_email_sync.js";
import type {
  OutlookGraphConnectionsService,
  OutlookGraphReconciliationTarget,
} from "./outlook_graph_connections.js";

export type OutlookConnectionMessageOutcome =
  "already_linked" | "ambiguous" | "conflict" | "linked" | "no_match";

export interface OutlookConnectionReconciliationMessage {
  application: {
    companyName: string;
    id: string;
    roleTitle: string;
  } | null;
  candidateApplicationIds: string[];
  classification: OutlookEmailClassification | null;
  messageId: string | null;
  outcome: OutlookConnectionMessageOutcome;
  receivedAt: string;
  score: number | null;
  sender: string | null;
  subject: string;
}

export interface OutlookConnectionReconciliationResult {
  connection: {
    folderPath: string;
    id: string;
    mailbox: string;
    name: string;
  };
  messages: OutlookConnectionReconciliationMessage[];
  reconciliation: {
    alreadyLinked: number;
    ambiguous: number;
    assignedApplications: number;
    conflicts: number;
    detailsRead: number;
    linked: number;
    messagesRetrieved: number;
    noMatch: number;
  };
  scoringVersion: number;
  threshold: number;
  verification: {
    connectionReread: true;
    cursorStored: boolean;
    linkedMessageIds: string[];
  };
  window: {
    previousReconciledAt: string | null;
    since: string;
    storedLastReconciledAt: string;
    through: string;
  };
}

interface PreparedMessage {
  publicResult: OutlookConnectionReconciliationMessage;
  selected: {
    application: ApplicationRecord;
    assessment: OutlookEmailCandidateAssessment;
    message: OutlookMailMessageDetail;
  } | null;
}

export interface OutlookConnectionReconciliationPrepared {
  assignedApplications: number;
  connection: OutlookGraphReconciliationTarget["connection"];
  detailsRead: number;
  messages: PreparedMessage[];
  previousReconciledAt: string | null;
  since: string;
  through: string;
}

interface ReconciliationApplications {
  listApplications(actor: AuthenticatedActor): ApplicationRecord[];
}

function applicationSummary(
  application: Pick<ApplicationRecord, "companyName" | "id" | "roleTitle">,
): OutlookConnectionReconciliationMessage["application"] {
  return {
    companyName: application.companyName,
    id: application.id,
    roleTitle: application.roleTitle,
  };
}

function candidateIds(candidates: JobEmailMatchCandidate[]): string[] {
  return [...new Set(candidates.map(({ id }) => id))].sort().slice(0, 10);
}

function baseMessage(
  summary: OutlookMailMessageSummary,
  detail?: OutlookMailMessageDetail,
): Pick<
  OutlookConnectionReconciliationMessage,
  "messageId" | "receivedAt" | "sender" | "subject"
> {
  return {
    messageId:
      detail?.internetMessageId?.trim() ||
      summary.internetMessageId?.trim() ||
      null,
    receivedAt: detail?.receivedAt ?? summary.receivedAt,
    sender: detail?.from?.address ?? summary.from?.address ?? null,
    subject: (detail?.subject ?? summary.subject).slice(0, 255),
  };
}

function rankedAssessments(
  assessments: Array<{
    application: ApplicationRecord;
    assessment: OutlookEmailCandidateAssessment;
  }>,
): typeof assessments {
  return [...assessments].sort((left, right) => {
    const scoreDifference = right.assessment.score - left.assessment.score;
    if (scoreDifference !== 0) return scoreDifference;
    return left.application.id.localeCompare(right.application.id);
  });
}

function noSelectionOutcome(
  assessments: ReturnType<typeof rankedAssessments>,
): "ambiguous" | "conflict" | "no_match" {
  const highConfidence = assessments.filter(
    ({ assessment }) => assessment.score >= outlookEmailSyncThreshold,
  );
  if (
    highConfidence.some(({ assessment }) =>
      assessment.disqualifiers.includes("tracker_match_conflict"),
    )
  ) {
    return "conflict";
  }
  if (
    highConfidence.some(({ assessment }) =>
      assessment.disqualifiers.includes("tracker_match_ambiguous"),
    )
  ) {
    return "ambiguous";
  }
  return "no_match";
}

function counts(
  messages: OutlookConnectionReconciliationMessage[],
): Pick<
  OutlookConnectionReconciliationResult["reconciliation"],
  "alreadyLinked" | "ambiguous" | "conflicts" | "linked" | "noMatch"
> {
  const count = (outcome: OutlookConnectionMessageOutcome) =>
    messages.filter((message) => message.outcome === outcome).length;
  return {
    alreadyLinked: count("already_linked"),
    ambiguous: count("ambiguous"),
    conflicts: count("conflict"),
    linked: count("linked"),
    noMatch: count("no_match"),
  };
}

export class OutlookConnectionReconciliationService {
  public constructor(
    private readonly applications: ReconciliationApplications,
    private readonly jobEmails: JobEmailReconciliationService,
    private readonly emailSync: OutlookEmailSyncService,
    private readonly connections: OutlookGraphConnectionsService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async prepare(
    actor: AuthenticatedActor,
    selector: string,
  ): Promise<OutlookConnectionReconciliationPrepared> {
    const target = this.connections.forReconciliation(
      actor.workspaceId,
      selector,
    );
    const through = this.clock().toISOString();
    const previousReconciledAt = target.connection.lastReconciledAt;
    const since = previousReconciledAt ?? target.connection.createdAt;
    if (Date.parse(since) > Date.parse(through)) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_graph_reconciliation_conflict",
      );
    }
    const applications = this.applications
      .listApplications(actor)
      .filter(
        ({ outlookGraphConnectionId }) =>
          outlookGraphConnectionId === target.connection.id,
      );
    const listed = await target.mail.listMessagesReceivedBetween!({
      after: since,
      through,
    });
    if (
      listed.truncated ||
      listed.messages.length > maximumOutlookReconciliationMessages
    ) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_reconcile_message_limit",
      );
    }
    const summaries = listed.messages
      .filter(({ receivedAt }) => {
        const received = Date.parse(receivedAt);
        return received > Date.parse(since) && received <= Date.parse(through);
      })
      .sort((left, right) => {
        const receivedDifference =
          Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
        if (receivedDifference !== 0) return receivedDifference;
        return (left.internetMessageId ?? left.id).localeCompare(
          right.internetMessageId ?? right.id,
        );
      })
      .slice(0, maximumOutlookReconciliationMessages);
    const details = await target.mail.getMessages(
      summaries.map(({ id }) => id),
    );
    const detailsById = new Map(details.map((detail) => [detail.id, detail]));
    const applicationById = new Map(
      this.applications
        .listApplications(actor)
        .map((application) => [application.id, application]),
    );
    const messages = summaries.map((summary): PreparedMessage => {
      const detail = detailsById.get(summary.id);
      const base = baseMessage(summary, detail);
      if (!detail || !base.messageId) {
        return {
          publicResult: {
            ...base,
            application: null,
            candidateApplicationIds: [],
            classification: null,
            outcome: "no_match",
            score: null,
          },
          selected: null,
        };
      }

      const summaryMessageId = summary.internetMessageId?.trim() || null;
      const detailMessageId = detail.internetMessageId?.trim() || null;
      const existing =
        summaryMessageId !== null &&
        detailMessageId !== null &&
        summaryMessageId === detailMessageId
          ? this.jobEmails.match(actor, { emailMessageId: detailMessageId })
          : { level: null, matches: [], outcome: "none" as const };
      if (existing.outcome !== "none") {
        const matched =
          existing.outcome === "matched"
            ? applicationById.get(existing.matches[0]?.id ?? "")
            : undefined;
        const belongsToConnection =
          matched?.outlookGraphConnectionId === target.connection.id;
        return {
          publicResult: {
            ...base,
            application:
              existing.outcome === "matched" && matched
                ? applicationSummary(matched)
                : null,
            candidateApplicationIds: candidateIds(existing.matches),
            classification: null,
            outcome:
              existing.outcome === "matched" && belongsToConnection
                ? "already_linked"
                : existing.outcome === "ambiguous"
                  ? "ambiguous"
                  : "conflict",
            score: null,
          },
          selected: null,
        };
      }

      const ranked = rankedAssessments(
        applications.map((application) => ({
          application,
          assessment: this.emailSync.assessMessage(
            actor,
            application,
            detail,
            summary,
          ),
        })),
      );
      const qualified = ranked.filter(({ assessment }) => assessment.qualified);
      if (qualified.length === 1) {
        const selected = qualified[0]!;
        return {
          publicResult: {
            ...base,
            application: applicationSummary(selected.application),
            candidateApplicationIds: [selected.application.id],
            classification: selected.assessment.classification,
            outcome: "linked",
            score: selected.assessment.score,
          },
          selected: { ...selected, message: detail },
        };
      }
      const best = ranked[0];
      const outcome =
        qualified.length > 1 ? "ambiguous" : noSelectionOutcome(ranked);
      return {
        publicResult: {
          ...base,
          application: null,
          candidateApplicationIds:
            qualified.length > 1
              ? qualified.map(({ application }) => application.id).slice(0, 10)
              : [],
          classification: best?.assessment.classification ?? null,
          outcome,
          score: best?.assessment.score ?? null,
        },
        selected: null,
      };
    });

    return {
      assignedApplications: applications.length,
      connection: target.connection,
      detailsRead: details.length,
      messages,
      previousReconciledAt,
      since,
      through,
    };
  }

  public commit(
    actor: AuthenticatedActor,
    prepared: OutlookConnectionReconciliationPrepared,
  ): OutlookConnectionReconciliationResult {
    const messages = prepared.messages.map(
      ({ publicResult, selected }): OutlookConnectionReconciliationMessage => {
        if (!selected) return publicResult;
        const messageId = selected.message.internetMessageId?.trim();
        if (!messageId) throw new OutlookEmailSyncVerificationError();
        const linked = this.jobEmails.linkEvidence(
          actor,
          {
            applicationId: selected.application.id,
            email: {
              messageId,
              receivedAt: selected.message.receivedAt,
              ...(selected.message.webUrl
                ? { webUrl: selected.message.webUrl }
                : {}),
            },
          },
          selected.application.updatedAt,
        );
        const stored = linked.emailEvidence.find(
          (evidence) =>
            evidence.messageId === messageId &&
            evidence.receivedAt === selected.message.receivedAt &&
            (!selected.message.webUrl ||
              evidence.webUrl === selected.message.webUrl),
        );
        if (!stored) throw new OutlookEmailSyncVerificationError();
        return {
          ...publicResult,
          outcome: linked.emailEvidenceLinked ? "linked" : "already_linked",
        };
      },
    );
    const rereadConnection = this.connections.recordSuccessfulReconciliation({
      connectionId: prepared.connection.id,
      expectedLastReconciledAt: prepared.previousReconciledAt,
      expectedUpdatedAt: prepared.connection.updatedAt,
      reconciledAt: prepared.through,
      workspaceId: actor.workspaceId,
    });
    const cursorStored = rereadConnection.lastReconciledAt === prepared.through;
    if (!cursorStored) throw new OutlookEmailSyncVerificationError();
    const linkedMessageIds = messages
      .filter(({ outcome }) => outcome === "linked")
      .flatMap(({ messageId }) => (messageId ? [messageId] : []));

    return {
      connection: {
        folderPath: rereadConnection.folderPath,
        id: rereadConnection.id,
        mailbox: rereadConnection.mailbox,
        name: rereadConnection.name,
      },
      messages,
      reconciliation: {
        ...counts(messages),
        assignedApplications: prepared.assignedApplications,
        detailsRead: prepared.detailsRead,
        messagesRetrieved: prepared.messages.length,
      },
      scoringVersion: outlookEmailSyncScoringVersion,
      threshold: outlookEmailSyncThreshold,
      verification: {
        connectionReread: true,
        cursorStored,
        linkedMessageIds,
      },
      window: {
        previousReconciledAt: prepared.previousReconciledAt,
        since: prepared.since,
        storedLastReconciledAt: rereadConnection.lastReconciledAt!,
        through: prepared.through,
      },
    };
  }
}
