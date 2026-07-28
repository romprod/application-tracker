import { DomUtils, parseDocument } from "htmlparser2";

import {
  ApplicationConflictError,
  ApplicationNotFoundError,
  type ApplicationRecord,
} from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import type {
  EmailLinkExtractionService,
  EmailLinkCandidate,
} from "./email_links.js";
import { normalizeJobEmailIdentityText } from "./job_email_reconciliation.js";
import type {
  JobEmailReconciliationService,
  ApplicationEmailEvidence,
  ApplicationJobPosting,
} from "./job_email_reconciliation.js";

export const outlookEmailSyncScoringVersion = 1;
export const outlookEmailSyncThreshold = 80;
export const maximumExistingOutlookEvidence = 20;
export const maximumOutlookSearchCandidates = 20;
export const maximumOutlookMessageDetails = 5;

export type OutlookEmailClassification =
  | "account_or_security"
  | "application_acknowledgement"
  | "interview_or_assessment"
  | "irrelevant"
  | "marketing_or_digest"
  | "offer"
  | "recruiter_conversation"
  | "status_or_rejection";

export type OutlookEmailScoreReason =
  | "canonical_url_match"
  | "company_match"
  | "contact_match"
  | "plausible_date"
  | "posting_id_match"
  | "role_match"
  | "transactional_message";

export type OutlookEmailDisqualifier =
  | "below_threshold"
  | "detail_unavailable"
  | "existing_metadata_mismatch"
  | "inconsistent_message_id"
  | "insufficient_identity"
  | "marketing_or_account_message"
  | "missing_message_id"
  | "non_transactional_message"
  | "tracker_match_ambiguous"
  | "tracker_match_conflict";

export type OutlookExistingEvidenceStatus =
  "metadata_mismatch" | "not_found" | "valid";

export interface OutlookEvidenceValidationInput {
  messageId: string;
  receivedAt: string;
}

export interface OutlookExistingEvidenceValidation {
  messageId: string;
  status: OutlookExistingEvidenceStatus;
}

export interface OutlookMailAddress {
  address: string;
  name: string | null;
}

export type OutlookSearchKind = "company_role" | "posting_id";

export interface OutlookMailMessageSummary {
  bodyPreview: string;
  from: OutlookMailAddress | null;
  id: string;
  internetMessageId: string | null;
  receivedAt: string;
  searchKinds: OutlookSearchKind[];
  subject: string;
  webUrl: string | null;
}

export interface OutlookMailHeader {
  name: string;
  value: string;
}

export interface OutlookMailMessageDetail extends Omit<
  OutlookMailMessageSummary,
  "searchKinds"
> {
  body: {
    content: string;
    contentType: "html" | "text";
  };
  headers: OutlookMailHeader[];
  replyTo: OutlookMailAddress[];
}

export interface OutlookMailSearchInput {
  companyName: string;
  postingIds: string[];
  roleTitle: string;
}

export interface OutlookMailSearchResult {
  messages: OutlookMailMessageSummary[];
  queriesRun: number;
}

export interface OutlookMailReader {
  getMessages(ids: string[]): Promise<OutlookMailMessageDetail[]>;
  searchMessages(
    input: OutlookMailSearchInput,
  ): Promise<OutlookMailSearchResult>;
  validateEvidence(
    evidence: OutlookEvidenceValidationInput[],
  ): Promise<OutlookExistingEvidenceValidation[]>;
}

export interface OutlookMailReaderProvider {
  forApplication(workspaceId: string, applicationId: string): OutlookMailReader;
}

export interface OutlookEmailCandidateAssessment {
  classification: OutlookEmailClassification;
  disqualifiers: OutlookEmailDisqualifier[];
  messageId: string | null;
  qualified: boolean;
  reasons: OutlookEmailScoreReason[];
  receivedAt: string;
  score: number;
  sender: string | null;
  subject: string;
}

export type OutlookEmailSyncOutcome =
  "already_linked" | "ambiguous" | "conflict" | "linked" | "no_match";

export interface OutlookEmailSyncResult {
  application: ApplicationRecord;
  candidateAssessments: OutlookEmailCandidateAssessment[];
  emailEvidence: ApplicationEmailEvidence[];
  existingEvidenceValidation: OutlookExistingEvidenceValidation[];
  link: {
    attempted: boolean;
    created: boolean;
  };
  outcome: OutlookEmailSyncOutcome;
  scoringVersion: number;
  search: {
    candidatesRetrieved: number;
    detailsRead: number;
    queriesRun: number;
  };
  selectedEvidence: OutlookEmailCandidateAssessment | null;
  threshold: number;
  verification: {
    applicationReread: true;
    evidenceStored: boolean;
    storedMessageId: string | null;
  };
}

export type OutlookEmailSyncOperationalErrorCode =
  | "outlook_email_sync_unavailable"
  | "outlook_existing_evidence_limit"
  | "outlook_folder_not_found"
  | "outlook_graph_connection_unassigned"
  | "outlook_graph_authentication_failed"
  | "outlook_graph_forbidden"
  | "outlook_graph_throttled"
  | "outlook_graph_unavailable"
  | "outlook_mailbox_unavailable";

export class OutlookEmailSyncOperationalError extends Error {
  public constructor(
    public readonly code: OutlookEmailSyncOperationalErrorCode,
  ) {
    super("Outlook email evidence synchronization is unavailable");
    this.name = "OutlookEmailSyncOperationalError";
  }
}

export class OutlookEmailSyncVerificationError extends Error {
  public constructor() {
    super("Stored Outlook evidence could not be verified");
    this.name = "OutlookEmailSyncVerificationError";
  }
}

interface OutlookEmailSyncApplications {
  listApplications(actor: AuthenticatedActor): ApplicationRecord[];
}

interface OutlookEmailSyncPrepared {
  applicationId: string;
  assessments: OutlookEmailCandidateAssessment[];
  detailsRead: number;
  expectedEvidenceSnapshot: string[];
  existingValidation: OutlookExistingEvidenceValidation[];
  expectedUpdatedAt: string;
  outcome: OutlookEmailSyncOutcome;
  queriesRun: number;
  searchCandidates: number;
  selected: {
    assessment: OutlookEmailCandidateAssessment;
    message: OutlookMailMessageDetail;
  } | null;
}

function evidenceSnapshot(evidence: ApplicationEmailEvidence[]): string[] {
  return evidence
    .map(({ id, messageId, receivedAt, updatedAt, webUrl }) =>
      JSON.stringify([id, messageId, receivedAt, updatedAt, webUrl]),
    )
    .sort();
}

const marketingSubjectPattern =
  /\b(?:daily|weekly)?\s*(?:job alerts?|job digest|jobs? you may like|new jobs? for you|newsletter|recommended jobs?|similar jobs?)\b/i;
const accountOrSecurityPattern =
  /\b(?:confirm your email|login alert|password reset|security code|sign-in|verification code)\b/i;
const acknowledgementPattern =
  /\b(?:application (?:has been )?received|application confirmation|thank you for applying|we (?:have )?received your application)\b/i;
const interviewPattern =
  /\b(?:assessment|coding challenge|interview|screening (?:call|interview)|technical test)\b/i;
const offerPattern = /\b(?:job offer|offer of employment|pleased to offer)\b/i;
const statusPattern =
  /\b(?:application update|not moving forward|rejection|unsuccessful|unfortunately|update on your application)\b/i;
const recruiterPattern =
  /\b(?:availability|call|chat|conversation|discuss|opportunity|role)\b/i;
const wordCharacterPattern = /[\p{L}\p{N}]/u;

function inertBodyText(message: OutlookMailMessageDetail): string {
  if (message.body.contentType === "text") {
    return message.body.content.slice(0, 200_000);
  }
  const document = parseDocument(message.body.content.slice(0, 200_000), {
    decodeEntities: true,
  });
  return DomUtils.innerText(document.children).slice(0, 200_000);
}

function containsPhrase(content: string, phrase: string): boolean {
  const normalizedContent = normalizeJobEmailIdentityText(content);
  const normalizedPhrase = normalizeJobEmailIdentityText(phrase);
  if (normalizedPhrase.length === 0) return false;
  let offset = normalizedContent.indexOf(normalizedPhrase);
  while (offset !== -1) {
    const before = normalizedContent[offset - 1] ?? "";
    const after = normalizedContent[offset + normalizedPhrase.length] ?? "";
    if (
      (before === "" || !wordCharacterPattern.test(before)) &&
      (after === "" || !wordCharacterPattern.test(after))
    ) {
      return true;
    }
    offset = normalizedContent.indexOf(normalizedPhrase, offset + 1);
  }
  return false;
}

function normalizedEmailAddress(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

function classification(
  message: OutlookMailMessageDetail,
  content: string,
  senderIsContact: boolean,
): OutlookEmailClassification {
  const subject = message.subject;
  const hasListUnsubscribe = message.headers.some(
    ({ name }) => name.toLocaleLowerCase("en") === "list-unsubscribe",
  );
  if (accountOrSecurityPattern.test(subject)) return "account_or_security";
  if (
    marketingSubjectPattern.test(subject) ||
    (hasListUnsubscribe &&
      /\b(?:alert|digest|jobs?|newsletter)\b/i.test(subject))
  ) {
    return "marketing_or_digest";
  }
  if (offerPattern.test(content)) return "offer";
  if (interviewPattern.test(content)) return "interview_or_assessment";
  if (statusPattern.test(content)) return "status_or_rejection";
  if (acknowledgementPattern.test(content)) {
    return "application_acknowledgement";
  }
  if (senderIsContact && recruiterPattern.test(content)) {
    return "recruiter_conversation";
  }
  return "irrelevant";
}

function isTransactional(value: OutlookEmailClassification): boolean {
  return (
    value === "application_acknowledgement" ||
    value === "interview_or_assessment" ||
    value === "offer" ||
    value === "recruiter_conversation" ||
    value === "status_or_rejection"
  );
}

function postingKey(
  posting: Pick<EmailLinkCandidate, "externalPostingId" | "provider">,
) {
  return posting.externalPostingId
    ? `${posting.provider}:${posting.externalPostingId.toLocaleLowerCase("en")}`
    : null;
}

function applicationSearchPostings(
  application: ApplicationRecord,
  jobPostings: ApplicationJobPosting[],
  emailLinks: EmailLinkExtractionService,
): {
  canonicalUrls: Set<string>;
  postingIds: string[];
  postingKeys: Set<string>;
} {
  const applicationUrls = [
    application.sourceUrl,
    ...application.links.map(({ url }) => url),
  ].filter((url): url is string => url !== null);
  const extracted = emailLinks.extract({ content: applicationUrls.join("\n") });
  const canonicalUrls = new Set<string>();
  const postingKeys = new Set<string>();
  const postingIds = new Set<string>();

  for (const posting of jobPostings) {
    if (posting.canonicalUrl) canonicalUrls.add(posting.canonicalUrl);
    if (posting.externalPostingId) {
      postingIds.add(posting.externalPostingId);
      postingKeys.add(
        `${posting.provider}:${posting.externalPostingId.toLocaleLowerCase("en")}`,
      );
    }
  }
  for (const posting of extracted) {
    canonicalUrls.add(posting.url);
    const key = postingKey(posting);
    if (key) postingKeys.add(key);
    if (posting.externalPostingId) postingIds.add(posting.externalPostingId);
  }
  return {
    canonicalUrls,
    postingIds: [...postingIds].sort(),
    postingKeys,
  };
}

function preliminaryScore(
  summary: OutlookMailMessageSummary,
  application: ApplicationRecord,
  postingIds: string[],
): number {
  const content = `${summary.subject}\n${summary.bodyPreview}`;
  let score = 0;
  if (containsPhrase(content, application.companyName)) score += 2;
  if (containsPhrase(content, application.roleTitle)) score += 2;
  const sender = summary.from?.address;
  if (
    sender &&
    application.contacts.some(
      ({ email }) =>
        email !== null &&
        normalizedEmailAddress(email) === normalizedEmailAddress(sender),
    )
  ) {
    score += 2;
  }
  if (postingIds.some((postingId) => content.includes(postingId))) score += 3;
  score += summary.searchKinds.length;
  return score;
}

function shortlistMessages(
  messages: OutlookMailMessageSummary[],
  application: ApplicationRecord,
  postingIds: string[],
): OutlookMailMessageSummary[] {
  return [...messages]
    .sort((left, right) => {
      const scoreDifference =
        preliminaryScore(right, application, postingIds) -
        preliminaryScore(left, application, postingIds);
      if (scoreDifference !== 0) return scoreDifference;
      const receivedDifference =
        Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
      if (receivedDifference !== 0) return receivedDifference;
      return (left.internetMessageId ?? left.id).localeCompare(
        right.internetMessageId ?? right.id,
      );
    })
    .slice(0, maximumOutlookMessageDetails);
}

function selectedEvidence(
  assessments: OutlookEmailCandidateAssessment[],
  detailsByMessageId: Map<string, OutlookMailMessageDetail>,
): {
  assessment: OutlookEmailCandidateAssessment;
  message: OutlookMailMessageDetail;
} | null {
  const qualified = assessments
    .filter(
      (
        assessment,
      ): assessment is OutlookEmailCandidateAssessment & {
        messageId: string;
      } => assessment.qualified && assessment.messageId !== null,
    )
    .sort((left, right) => {
      const scoreDifference = right.score - left.score;
      if (scoreDifference !== 0) return scoreDifference;
      const receivedDifference =
        Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
      if (receivedDifference !== 0) return receivedDifference;
      return left.messageId.localeCompare(right.messageId);
    });
  for (const assessment of qualified) {
    const message = detailsByMessageId.get(assessment.messageId);
    if (message) return { assessment, message };
  }
  return null;
}

function decisionWithoutSelection(
  assessments: OutlookEmailCandidateAssessment[],
): OutlookEmailSyncOutcome {
  const highConfidence = assessments.filter(
    ({ score }) => score >= outlookEmailSyncThreshold,
  );
  if (
    highConfidence.some(({ disqualifiers }) =>
      disqualifiers.includes("tracker_match_conflict"),
    )
  ) {
    return "conflict";
  }
  if (
    highConfidence.some(({ disqualifiers }) =>
      disqualifiers.includes("tracker_match_ambiguous"),
    )
  ) {
    return "ambiguous";
  }
  return "no_match";
}

function expectedEvidence(
  prepared: OutlookEmailSyncPrepared,
  currentEvidence: ApplicationEmailEvidence[],
): Pick<
  ApplicationEmailEvidence,
  "messageId" | "receivedAt" | "webUrl"
> | null {
  const validExisting = prepared.existingValidation.find(
    ({ status }) => status === "valid",
  );
  if (validExisting) {
    return (
      currentEvidence.find(
        ({ messageId }) => messageId === validExisting.messageId,
      ) ?? null
    );
  }
  const selected = prepared.selected?.message;
  if (!selected?.internetMessageId) return null;
  return {
    messageId: selected.internetMessageId,
    receivedAt: selected.receivedAt,
    webUrl: selected.webUrl,
  };
}

export class OutlookEmailSyncService {
  public constructor(
    private readonly applications: OutlookEmailSyncApplications,
    private readonly jobEmails: JobEmailReconciliationService,
    private readonly emailLinks: EmailLinkExtractionService,
    private readonly mail: OutlookMailReader | OutlookMailReaderProvider,
  ) {}

  public async prepare(
    actor: AuthenticatedActor,
    applicationId: string,
  ): Promise<OutlookEmailSyncPrepared> {
    const application = this.applications
      .listApplications(actor)
      .find(({ id }) => id === applicationId);
    if (!application) throw new ApplicationNotFoundError();
    const mail =
      "forApplication" in this.mail
        ? this.mail.forApplication(actor.workspaceId, application.id)
        : this.mail;

    const evidence = this.jobEmails.getApplicationEvidence(
      actor,
      applicationId,
    );
    if (evidence.emailEvidence.length > maximumExistingOutlookEvidence) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_existing_evidence_limit",
      );
    }
    const existingValidation = await mail.validateEvidence(
      evidence.emailEvidence.map(({ messageId, receivedAt }) => ({
        messageId,
        receivedAt,
      })),
    );
    const targetPostings = applicationSearchPostings(
      application,
      evidence.jobPostings,
      this.emailLinks,
    );
    const search = await mail.searchMessages({
      companyName: application.companyName,
      postingIds: targetPostings.postingIds,
      roleTitle: application.roleTitle,
    });
    const boundedMessages = search.messages.slice(
      0,
      maximumOutlookSearchCandidates,
    );
    const shortlist = shortlistMessages(
      boundedMessages,
      application,
      targetPostings.postingIds,
    );
    const details = await mail.getMessages(shortlist.map(({ id }) => id));
    const detailsById = new Map(details.map((detail) => [detail.id, detail]));
    const assessments = shortlist.map((summary) =>
      this.assessCandidate(
        actor,
        application,
        targetPostings,
        summary,
        detailsById.get(summary.id),
        existingValidation,
      ),
    );
    const detailsByMessageId = new Map(
      details.flatMap((detail) =>
        detail.internetMessageId
          ? [[detail.internetMessageId, detail] as const]
          : [],
      ),
    );
    const selected = selectedEvidence(assessments, detailsByMessageId);
    const hasValidExisting = existingValidation.some(
      ({ status }) => status === "valid",
    );
    const outcome: OutlookEmailSyncOutcome = hasValidExisting
      ? "already_linked"
      : selected
        ? "linked"
        : decisionWithoutSelection(assessments);

    return {
      applicationId,
      assessments,
      detailsRead: details.length,
      expectedEvidenceSnapshot: evidenceSnapshot(evidence.emailEvidence),
      existingValidation,
      expectedUpdatedAt: application.updatedAt,
      outcome,
      queriesRun: search.queriesRun,
      searchCandidates: boundedMessages.length,
      selected: hasValidExisting ? null : selected,
    };
  }

  public commit(
    actor: AuthenticatedActor,
    prepared: OutlookEmailSyncPrepared,
  ): OutlookEmailSyncResult {
    const application = this.applications
      .listApplications(actor)
      .find(({ id }) => id === prepared.applicationId);
    if (!application) throw new ApplicationNotFoundError();
    if (application.updatedAt !== prepared.expectedUpdatedAt) {
      throw new ApplicationConflictError(application);
    }
    const currentEvidence = this.jobEmails.getApplicationEvidence(
      actor,
      prepared.applicationId,
    ).emailEvidence;
    if (
      JSON.stringify(evidenceSnapshot(currentEvidence)) !==
      JSON.stringify(prepared.expectedEvidenceSnapshot)
    ) {
      throw new ApplicationConflictError(application);
    }

    let created = false;
    let outcome = prepared.outcome;
    if (prepared.outcome === "linked" && prepared.selected) {
      const messageId = prepared.selected.message.internetMessageId;
      if (!messageId) throw new OutlookEmailSyncVerificationError();
      const linked = this.jobEmails.linkEvidence(
        actor,
        {
          applicationId: prepared.applicationId,
          email: {
            messageId,
            receivedAt: prepared.selected.message.receivedAt,
            ...(prepared.selected.message.webUrl
              ? { webUrl: prepared.selected.message.webUrl }
              : {}),
          },
        },
        prepared.expectedUpdatedAt,
      );
      created = linked.emailEvidenceLinked;
      if (!created) outcome = "already_linked";
    }

    const rereadApplication = this.applications
      .listApplications(actor)
      .find(({ id }) => id === prepared.applicationId);
    if (!rereadApplication) throw new ApplicationNotFoundError();
    const rereadEvidence = this.jobEmails.getApplicationEvidence(
      actor,
      prepared.applicationId,
    ).emailEvidence;
    const expected = expectedEvidence(prepared, currentEvidence);
    const evidenceStored =
      expected !== null &&
      rereadEvidence.some(
        ({ messageId, receivedAt, webUrl }) =>
          messageId === expected.messageId &&
          receivedAt === expected.receivedAt &&
          (expected.webUrl === null || webUrl === expected.webUrl),
      );
    if (
      (outcome === "linked" || outcome === "already_linked") &&
      !evidenceStored
    ) {
      throw new OutlookEmailSyncVerificationError();
    }

    return {
      application: rereadApplication,
      candidateAssessments: prepared.assessments,
      emailEvidence: rereadEvidence,
      existingEvidenceValidation: prepared.existingValidation,
      link: {
        attempted: prepared.outcome === "linked",
        created,
      },
      outcome,
      scoringVersion: outlookEmailSyncScoringVersion,
      search: {
        candidatesRetrieved: prepared.searchCandidates,
        detailsRead: prepared.detailsRead,
        queriesRun: prepared.queriesRun,
      },
      selectedEvidence: prepared.selected?.assessment ?? null,
      threshold: outlookEmailSyncThreshold,
      verification: {
        applicationReread: true,
        evidenceStored,
        storedMessageId: evidenceStored ? (expected?.messageId ?? null) : null,
      },
    };
  }

  private assessCandidate(
    actor: AuthenticatedActor,
    application: ApplicationRecord,
    targetPostings: ReturnType<typeof applicationSearchPostings>,
    summary: OutlookMailMessageSummary,
    detail: OutlookMailMessageDetail | undefined,
    existingValidation: OutlookExistingEvidenceValidation[],
  ): OutlookEmailCandidateAssessment {
    const reasons: OutlookEmailScoreReason[] = [];
    const disqualifiers: OutlookEmailDisqualifier[] = [];
    let score = 0;
    if (!detail) {
      return {
        classification: "irrelevant",
        disqualifiers: ["detail_unavailable"],
        messageId: summary.internetMessageId,
        qualified: false,
        reasons,
        receivedAt: summary.receivedAt,
        score,
        sender: summary.from?.address ?? null,
        subject: summary.subject.slice(0, 255),
      };
    }

    const messageId = summary.internetMessageId?.trim() || null;
    const detailedMessageId = detail.internetMessageId?.trim() || null;
    if (!messageId || !detailedMessageId) {
      disqualifiers.push("missing_message_id");
    } else if (messageId !== detailedMessageId) {
      disqualifiers.push("inconsistent_message_id");
    }
    if (
      detailedMessageId &&
      existingValidation.some(
        (validation) =>
          validation.messageId === detailedMessageId &&
          validation.status === "metadata_mismatch",
      )
    ) {
      disqualifiers.push("existing_metadata_mismatch");
    }

    const bodyText = inertBodyText(detail);
    const content = `${detail.subject}\n${detail.bodyPreview}\n${bodyText}`;
    const companyMatches = containsPhrase(content, application.companyName);
    const roleMatches = containsPhrase(content, application.roleTitle);
    if (companyMatches) {
      score += 30;
      reasons.push("company_match");
    }
    if (roleMatches) {
      score += 30;
      reasons.push("role_match");
    }

    const sender = detail.from?.address ?? null;
    const senderIsContact =
      sender !== null &&
      application.contacts.some(
        ({ email }) =>
          email !== null &&
          normalizedEmailAddress(email) === normalizedEmailAddress(sender),
      );
    if (senderIsContact) {
      score += 30;
      reasons.push("contact_match");
    }

    const messageClassification = classification(
      detail,
      content,
      senderIsContact,
    );
    if (isTransactional(messageClassification)) {
      score += 20;
      reasons.push("transactional_message");
    } else if (
      messageClassification === "marketing_or_digest" ||
      messageClassification === "account_or_security"
    ) {
      disqualifiers.push("marketing_or_account_message");
    } else {
      disqualifiers.push("non_transactional_message");
    }

    if (application.appliedOn) {
      const appliedAt = Date.parse(`${application.appliedOn}T00:00:00.000Z`);
      const receivedAt = Date.parse(detail.receivedAt);
      const earliest = appliedAt - 30 * 24 * 60 * 60 * 1000;
      if (receivedAt >= earliest) {
        score += 5;
        reasons.push("plausible_date");
      }
    }

    let postingAnchor = false;
    const postingCandidates = this.emailLinks.extract({
      content: detail.body.content.slice(0, 200_000),
    });
    for (const posting of postingCandidates) {
      const match = this.jobEmails.match(actor, {
        posting: { url: posting.url },
      });
      if (match.outcome === "matched") {
        if (match.matches[0]?.id !== application.id) {
          disqualifiers.push("tracker_match_conflict");
          continue;
        }
        if (match.level === "posting_id") {
          if (!reasons.includes("posting_id_match")) {
            score += 80;
            reasons.push("posting_id_match");
          }
          postingAnchor = true;
        } else if (match.level === "canonical_url") {
          if (!reasons.includes("canonical_url_match")) {
            score += 70;
            reasons.push("canonical_url_match");
          }
          postingAnchor = true;
        }
      } else if (match.outcome === "ambiguous") {
        disqualifiers.push("tracker_match_ambiguous");
      } else if (match.outcome === "conflict") {
        disqualifiers.push("tracker_match_conflict");
      } else {
        const key = postingKey(posting);
        if (key && targetPostings.postingKeys.has(key)) {
          if (!reasons.includes("posting_id_match")) {
            score += 80;
            reasons.push("posting_id_match");
          }
          postingAnchor = true;
        } else if (targetPostings.canonicalUrls.has(posting.url)) {
          if (!reasons.includes("canonical_url_match")) {
            score += 70;
            reasons.push("canonical_url_match");
          }
          postingAnchor = true;
        }
      }
    }

    if (detailedMessageId) {
      const emailMatch = this.jobEmails.match(actor, {
        emailMessageId: detailedMessageId,
      });
      if (
        emailMatch.outcome === "matched" &&
        emailMatch.matches[0]?.id !== application.id
      ) {
        disqualifiers.push("tracker_match_conflict");
      } else if (emailMatch.outcome === "ambiguous") {
        disqualifiers.push("tracker_match_ambiguous");
      } else if (emailMatch.outcome === "conflict") {
        disqualifiers.push("tracker_match_conflict");
      }
    }

    let textAnchor = companyMatches && roleMatches;
    if (textAnchor) {
      const companyTitleMatch = this.jobEmails.match(actor, {
        companyName: application.companyName,
        roleTitle: application.roleTitle,
      });
      if (companyTitleMatch.outcome === "ambiguous") {
        disqualifiers.push("tracker_match_ambiguous");
        textAnchor = false;
      } else if (
        companyTitleMatch.outcome === "conflict" ||
        (companyTitleMatch.outcome === "matched" &&
          companyTitleMatch.matches[0]?.id !== application.id)
      ) {
        disqualifiers.push("tracker_match_conflict");
        textAnchor = false;
      }
    }
    const identityAnchor =
      postingAnchor ||
      textAnchor ||
      (senderIsContact && (companyMatches || roleMatches));
    if (!identityAnchor) disqualifiers.push("insufficient_identity");
    if (score < outlookEmailSyncThreshold) {
      disqualifiers.push("below_threshold");
    }

    const uniqueDisqualifiers = [...new Set(disqualifiers)];
    return {
      classification: messageClassification,
      disqualifiers: uniqueDisqualifiers,
      messageId: detailedMessageId,
      qualified:
        uniqueDisqualifiers.length === 0 &&
        identityAnchor &&
        isTransactional(messageClassification) &&
        score >= outlookEmailSyncThreshold,
      reasons: [...new Set(reasons)],
      receivedAt: detail.receivedAt,
      score,
      sender,
      subject: detail.subject.slice(0, 255),
    };
  }
}
