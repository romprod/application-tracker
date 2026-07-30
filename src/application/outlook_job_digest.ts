import type { AuthenticatedActor } from "./auth.js";
import type {
  JobEmailMatchResult,
  JobEmailReconciliationService,
} from "./job_email_reconciliation.js";
import {
  type JobLinkResolutionResult,
  JobLinkResolutionService,
  type ResolvedJobLinkCandidate,
} from "./job_links.js";
import {
  type JobPostingInspectionResult,
  JobPostingInspectionService,
} from "./job_posting_inspection.js";
import {
  classifyOutlookMailMessage,
  OutlookEmailSyncOperationalError,
  type OutlookMailMessageDetail,
} from "./outlook_email_sync.js";
import type { OutlookGraphConnectionsService } from "./outlook_graph_connections.js";
import type { ProcessOutlookJobDigestInput } from "../domain/outlook_job_digest.js";
import type { EmailLinkExtractionService } from "./email_links.js";

export const maximumOutlookDigestPostingsPerPage = 5;
export const maximumOutlookDigestDescriptionCharacters = 4_000;

export type OutlookJobDigestProcessingOutcome =
  "ambiguous" | "not_digest" | "not_found" | "processed";

export interface OutlookJobDigestPosting {
  candidate: ResolvedJobLinkCandidate;
  descriptionTruncated: boolean;
  inspection: JobPostingInspectionResult;
  match: JobEmailMatchResult;
}

export interface OutlookJobDigestProcessingResult {
  classification: ReturnType<typeof classifyOutlookMailMessage> | null;
  connection: {
    folderPath: string;
    id: string;
    mailbox: string;
    name: string;
  };
  digest: {
    messageId: string;
    receivedAt: string;
    sender: string | null;
    subject: string;
  } | null;
  outcome: OutlookJobDigestProcessingOutcome;
  page: {
    nextOffset: number | null;
    offset: number;
    returned: number;
    total: number;
  };
  postings: OutlookJobDigestPosting[];
  tracking: JobLinkResolutionResult["tracking"];
  verification: {
    exactMessageMatches: number;
    mailboxReadOnly: true;
    messageBodyReturned: false;
  };
}

interface OutlookDigestConnections {
  forReconciliation(
    workspaceId: string,
    selector: string,
  ): ReturnType<OutlookGraphConnectionsService["forReconciliation"]>;
}

interface OutlookDigestJobEmails {
  match: JobEmailReconciliationService["match"];
}

interface OutlookDigestJobLinkResolver {
  resolve: JobLinkResolutionService["resolve"];
}

interface OutlookDigestJobPostingInspector {
  inspect: JobPostingInspectionService["inspect"];
}

const emptyTracking: JobLinkResolutionResult["tracking"] = {
  attempted: 0,
  resolved: 0,
  unavailable: [],
};

function connectionResult(
  connection: ReturnType<
    OutlookGraphConnectionsService["forReconciliation"]
  >["connection"],
): OutlookJobDigestProcessingResult["connection"] {
  return {
    folderPath: connection.folderPath,
    id: connection.id,
    mailbox: connection.mailbox,
    name: connection.name,
  };
}

function digestResult(
  message: OutlookMailMessageDetail,
): NonNullable<OutlookJobDigestProcessingResult["digest"]> {
  return {
    messageId: message.internetMessageId!.trim(),
    receivedAt: message.receivedAt,
    sender: message.from?.address ?? null,
    subject: message.subject.slice(0, 255),
  };
}

function emptyPage(offset: number): OutlookJobDigestProcessingResult["page"] {
  return { nextOffset: null, offset, returned: 0, total: 0 };
}

function boundedInspection(inspection: JobPostingInspectionResult): {
  descriptionTruncated: boolean;
  inspection: JobPostingInspectionResult;
} {
  if (
    inspection.status !== "available" ||
    inspection.description === null ||
    inspection.description.length <= maximumOutlookDigestDescriptionCharacters
  ) {
    return { descriptionTruncated: false, inspection };
  }
  return {
    descriptionTruncated: true,
    inspection: {
      ...inspection,
      description: inspection.description.slice(
        0,
        maximumOutlookDigestDescriptionCharacters,
      ),
    },
  };
}

export class OutlookJobDigestProcessingService {
  private readonly jobLinkResolver: OutlookDigestJobLinkResolver;
  private readonly jobPostingInspector: OutlookDigestJobPostingInspector;

  public constructor(
    private readonly connections: OutlookDigestConnections,
    private readonly jobEmails: OutlookDigestJobEmails,
    emailLinks: EmailLinkExtractionService,
    jobLinkResolver: OutlookDigestJobLinkResolver = new JobLinkResolutionService(
      emailLinks,
    ),
    jobPostingInspector: OutlookDigestJobPostingInspector = new JobPostingInspectionService(),
  ) {
    this.jobLinkResolver = jobLinkResolver;
    this.jobPostingInspector = jobPostingInspector;
  }

  public async process(
    actor: AuthenticatedActor,
    input: ProcessOutlookJobDigestInput,
  ): Promise<OutlookJobDigestProcessingResult> {
    const target = this.connections.forReconciliation(
      actor.workspaceId,
      input.connection,
    );
    if (!target.mail.findMessagesByInternetMessageId) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_email_sync_unavailable",
      );
    }
    const messages = (
      await target.mail.findMessagesByInternetMessageId(input.messageId)
    ).filter(
      ({ internetMessageId }) => internetMessageId?.trim() === input.messageId,
    );
    const base = {
      connection: connectionResult(target.connection),
      page: emptyPage(input.offset),
      postings: [],
      tracking: emptyTracking,
      verification: {
        exactMessageMatches: Math.min(messages.length, 2),
        mailboxReadOnly: true as const,
        messageBodyReturned: false as const,
      },
    };
    if (messages.length === 0) {
      return {
        ...base,
        classification: null,
        digest: null,
        outcome: "not_found",
      };
    }
    if (messages.length !== 1) {
      return {
        ...base,
        classification: null,
        digest: null,
        outcome: "ambiguous",
      };
    }

    const message = messages[0]!;
    const classification = classifyOutlookMailMessage(message);
    if (classification !== "marketing_or_digest") {
      return {
        ...base,
        classification,
        digest: digestResult(message),
        outcome: "not_digest",
      };
    }

    const resolution = await this.jobLinkResolver.resolve({
      content: message.body.content.slice(0, 200_000),
    });
    const selected = resolution.candidates.slice(
      input.offset,
      input.offset + maximumOutlookDigestPostingsPerPage,
    );
    const postings = await Promise.all(
      selected.map(async (candidate): Promise<OutlookJobDigestPosting> => {
        const inspection = boundedInspection(
          await this.jobPostingInspector.inspect({ url: candidate.url }),
        );
        return {
          candidate,
          ...inspection,
          match: this.jobEmails.match(actor, {
            posting: {
              url: inspection.inspection.canonicalUrl ?? candidate.url,
            },
          }),
        };
      }),
    );
    const nextOffset = input.offset + postings.length;
    return {
      classification,
      connection: connectionResult(target.connection),
      digest: digestResult(message),
      outcome: "processed",
      page: {
        nextOffset:
          nextOffset < resolution.candidates.length ? nextOffset : null,
        offset: input.offset,
        returned: postings.length,
        total: resolution.candidates.length,
      },
      postings,
      tracking: resolution.tracking,
      verification: {
        exactMessageMatches: 1,
        mailboxReadOnly: true,
        messageBodyReturned: false,
      },
    };
  }
}
