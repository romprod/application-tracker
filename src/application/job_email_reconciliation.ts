import type {
  ApplicationRecord,
  ApplicationLedgerService,
} from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import {
  JobBoardProviderRegistry,
  type JobBoardMatch,
} from "./job_board_provider_registry.js";
import type {
  JobEmailEvidenceInput,
  JobPostingEvidenceInput,
  MatchJobApplicationEmailInput,
  UpsertApplicationFromEmailInput,
} from "../domain/job_email_reconciliation.js";
import type { JobBoardProvider } from "../domain/job_board.js";
import type { ApplicationChangesInput } from "../domain/applications.js";

export type JobEmailMatchLevel =
  "posting_id" | "canonical_url" | "email_message_id" | "company_title";

export type JobEmailMatchOutcome =
  "matched" | "none" | "ambiguous" | "conflict";

export interface JobEmailMatchCandidate {
  companyName: string;
  id: string;
  roleTitle: string;
  status: string;
  statusId: string;
  updatedAt: string;
}

export interface JobEmailMatchResult {
  level: JobEmailMatchLevel | null;
  matches: JobEmailMatchCandidate[];
  outcome: JobEmailMatchOutcome;
}

export interface ApplicationJobPosting {
  applicationId: string;
  canonicalUrl: string | null;
  createdAt: string;
  externalPostingId: string | null;
  id: string;
  provider: JobBoardProvider;
  updatedAt: string;
}

export interface ApplicationEmailEvidence {
  applicationId: string;
  createdAt: string;
  id: string;
  messageId: string;
  receivedAt: string;
  updatedAt: string;
  webUrl: string | null;
}

export interface ResolvedJobPostingEvidence {
  canonicalUrl: string | null;
  externalPostingId: string | null;
  provider: JobBoardProvider;
}

export interface LinkApplicationJobPostingInput extends ResolvedJobPostingEvidence {
  applicationId: string;
  occurredAt: string;
  workspaceId: string;
}

export interface LinkApplicationEmailEvidenceInput {
  applicationId: string;
  messageId: string;
  occurredAt: string;
  receivedAt: string;
  webUrl: string | null;
  workspaceId: string;
}

export interface EvidenceLinkResult<Record> {
  created: boolean;
  record: Record;
}

export interface JobEmailReconciliationRepository {
  findApplicationIdsByCanonicalUrl(
    workspaceId: string,
    canonicalUrl: string,
  ): string[];
  findApplicationIdsByEmailMessageId(
    workspaceId: string,
    messageId: string,
  ): string[];
  findApplicationIdsByPostingId(
    workspaceId: string,
    provider: JobBoardProvider,
    externalPostingId: string,
  ): string[];
  linkEmailEvidence(
    input: LinkApplicationEmailEvidenceInput,
  ): EvidenceLinkResult<ApplicationEmailEvidence>;
  linkJobPosting(
    input: LinkApplicationJobPostingInput,
  ): EvidenceLinkResult<ApplicationJobPosting>;
  listEmailEvidence(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEmailEvidence[];
  listJobPostings(
    workspaceId: string,
    applicationId: string,
  ): ApplicationJobPosting[];
}

export interface JobEmailApplicationEvidence {
  emailEvidence: ApplicationEmailEvidence[];
  jobPostings: ApplicationJobPosting[];
}

export interface UpsertApplicationFromEmailResult extends JobEmailApplicationEvidence {
  action: "created" | "matched" | "updated";
  application: ApplicationRecord;
  emailEvidenceLinked: boolean;
  matchLevel: JobEmailMatchLevel | null;
  postingLinked: boolean;
}

export class InvalidJobPostingEvidenceError extends Error {
  public constructor() {
    super("The job posting evidence is invalid or internally inconsistent");
    this.name = "InvalidJobPostingEvidenceError";
  }
}

export class JobEmailMatchAmbiguousError extends Error {
  public constructor(public readonly match: JobEmailMatchResult) {
    super("The email matches more than one application");
    this.name = "JobEmailMatchAmbiguousError";
  }
}

export class JobEmailEvidenceConflictError extends Error {
  public constructor() {
    super("The job or email evidence conflicts with an existing application");
    this.name = "JobEmailEvidenceConflictError";
  }
}

export class JobEmailReconciliationUnavailableError extends Error {
  public constructor() {
    super("Job email reconciliation is unavailable");
    this.name = "JobEmailReconciliationUnavailableError";
  }
}

interface MatchCriterion {
  applicationIds: Set<string>;
  level: JobEmailMatchLevel;
}

function normalizeIdentityText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function normalizeExternalPostingId(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

function candidate(application: ApplicationRecord): JobEmailMatchCandidate {
  return {
    companyName: application.companyName,
    id: application.id,
    roleTitle: application.roleTitle,
    status: application.status,
    statusId: application.statusId,
    updatedAt: application.updatedAt,
  };
}

function normalizedUrl(url: string): URL {
  const parsed = new URL(url);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.href.length > 2048
  ) {
    throw new InvalidJobPostingEvidenceError();
  }
  parsed.hash = "";
  return parsed;
}

function samePosting(
  input: JobPostingEvidenceInput,
  matched: JobBoardMatch,
): boolean {
  return (
    (input.provider === undefined || input.provider === matched.provider) &&
    (input.externalPostingId === undefined ||
      (matched.externalPostingId !== null &&
        normalizeExternalPostingId(input.externalPostingId) ===
          normalizeExternalPostingId(matched.externalPostingId)))
  );
}

function comparableUpdateValue(
  key: keyof ApplicationChangesInput,
  value: NonNullable<ApplicationChangesInput[keyof ApplicationChangesInput]>,
): unknown {
  if (key === "contacts") {
    return (value as NonNullable<ApplicationChangesInput["contacts"]>).map(
      (contact) => ({
        email: contact.email ?? null,
        name: contact.name,
        phone: contact.phone ?? null,
        role: contact.role ?? null,
      }),
    );
  }
  return value;
}

function requiresApplicationUpdate(
  application: ApplicationRecord,
  update: ApplicationChangesInput,
): boolean {
  for (const [key, rawValue] of Object.entries(update) as Array<
    [
      keyof ApplicationChangesInput,
      ApplicationChangesInput[keyof ApplicationChangesInput],
    ]
  >) {
    if (rawValue === undefined) continue;
    const expected = comparableUpdateValue(key, rawValue as never);
    if (JSON.stringify(application[key]) !== JSON.stringify(expected)) {
      return true;
    }
  }
  return false;
}

export class JobEmailReconciliationService {
  public constructor(
    private readonly repository: JobEmailReconciliationRepository,
    private readonly applications: ApplicationLedgerService,
    private readonly runAtomically: <Result>(operation: () => Result) => Result,
    private readonly clock: () => Date = () => new Date(),
    private readonly providers = new JobBoardProviderRegistry(),
  ) {}

  public getApplicationEvidence(
    actor: AuthenticatedActor,
    applicationId: string,
  ): JobEmailApplicationEvidence {
    return {
      emailEvidence: this.repository.listEmailEvidence(
        actor.workspaceId,
        applicationId,
      ),
      jobPostings: this.repository.listJobPostings(
        actor.workspaceId,
        applicationId,
      ),
    };
  }

  public match(
    actor: AuthenticatedActor,
    input: MatchJobApplicationEmailInput,
  ): JobEmailMatchResult {
    const applications = this.applications.listApplications(actor);
    const applicationById = new Map(
      applications.map((application) => [application.id, application]),
    );
    const criteria: MatchCriterion[] = [];
    const posting = input.posting
      ? this.resolvePostingEvidence(input.posting)
      : undefined;

    if (posting?.externalPostingId) {
      criteria.push({
        applicationIds: new Set([
          ...this.repository.findApplicationIdsByPostingId(
            actor.workspaceId,
            posting.provider,
            posting.externalPostingId,
          ),
          ...this.findLegacyPostingMatches(applications, posting, "posting_id"),
        ]),
        level: "posting_id",
      });
    }
    if (posting?.canonicalUrl) {
      criteria.push({
        applicationIds: new Set([
          ...this.repository.findApplicationIdsByCanonicalUrl(
            actor.workspaceId,
            posting.canonicalUrl,
          ),
          ...this.findLegacyPostingMatches(
            applications,
            posting,
            "canonical_url",
          ),
        ]),
        level: "canonical_url",
      });
    }
    if (input.emailMessageId) {
      criteria.push({
        applicationIds: new Set(
          this.repository.findApplicationIdsByEmailMessageId(
            actor.workspaceId,
            input.emailMessageId,
          ),
        ),
        level: "email_message_id",
      });
    }
    if (input.companyName && input.roleTitle) {
      const companyName = normalizeIdentityText(input.companyName);
      const roleTitle = normalizeIdentityText(input.roleTitle);
      criteria.push({
        applicationIds: new Set(
          applications
            .filter(
              (application) =>
                normalizeIdentityText(application.companyName) ===
                  companyName &&
                normalizeIdentityText(application.roleTitle) === roleTitle,
            )
            .map(({ id }) => id),
        ),
        level: "company_title",
      });
    }

    const primaryIndex = criteria.findIndex(
      ({ applicationIds }) => applicationIds.size > 0,
    );
    if (primaryIndex === -1) {
      return { level: null, matches: [], outcome: "none" };
    }
    const primary = criteria[primaryIndex];
    if (!primary) return { level: null, matches: [], outcome: "none" };
    const primaryMatches = [...primary.applicationIds]
      .map((id) => applicationById.get(id))
      .filter((application): application is ApplicationRecord => !!application);
    if (primaryMatches.length !== 1) {
      return {
        level: primary.level,
        matches: primaryMatches.map(candidate),
        outcome: "ambiguous",
      };
    }

    const primaryApplication = primaryMatches[0];
    if (!primaryApplication) {
      return { level: primary.level, matches: [], outcome: "conflict" };
    }
    const conflictingIds = new Set<string>();
    for (const criterion of criteria.slice(primaryIndex + 1)) {
      if (
        criterion.applicationIds.size > 0 &&
        !criterion.applicationIds.has(primaryApplication.id)
      ) {
        for (const id of criterion.applicationIds) conflictingIds.add(id);
      }
    }
    if (conflictingIds.size > 0) {
      conflictingIds.add(primaryApplication.id);
      return {
        level: primary.level,
        matches: [...conflictingIds]
          .map((id) => applicationById.get(id))
          .filter(
            (application): application is ApplicationRecord => !!application,
          )
          .map(candidate),
        outcome: "conflict",
      };
    }
    return {
      level: primary.level,
      matches: [candidate(primaryApplication)],
      outcome: "matched",
    };
  }

  public upsert(
    actor: AuthenticatedActor,
    input: UpsertApplicationFromEmailInput,
  ): UpsertApplicationFromEmailResult {
    return this.runAtomically(() => {
      const match = this.match(actor, {
        companyName: input.application.companyName,
        emailMessageId: input.email.messageId,
        ...(input.posting ? { posting: input.posting } : {}),
        roleTitle: input.application.roleTitle,
      });
      if (match.outcome === "ambiguous") {
        throw new JobEmailMatchAmbiguousError(match);
      }
      if (match.outcome === "conflict") {
        throw new JobEmailEvidenceConflictError();
      }

      let created = false;
      let application: ApplicationRecord;
      if (match.outcome === "matched") {
        const applicationId = match.matches[0]?.id;
        const matchedApplication = this.applications
          .listApplications(actor)
          .find(({ id }) => id === applicationId);
        if (!matchedApplication) throw new JobEmailEvidenceConflictError();
        application = matchedApplication;
      } else {
        application = this.applications.createApplication(
          actor,
          input.application,
        );
        created = true;
      }
      let updated = false;
      if (
        input.update &&
        requiresApplicationUpdate(application, input.update)
      ) {
        application = this.applications.updateApplication(
          actor,
          application.id,
          { ...input.update, expectedUpdatedAt: application.updatedAt },
        );
        updated = true;
      }

      const occurredAt = this.clock().toISOString();
      const posting = input.posting
        ? this.resolvePostingEvidence(input.posting)
        : undefined;
      const postingResult = posting
        ? this.repository.linkJobPosting({
            ...posting,
            applicationId: application.id,
            occurredAt,
            workspaceId: actor.workspaceId,
          })
        : undefined;
      const emailResult = this.repository.linkEmailEvidence({
        applicationId: application.id,
        messageId: input.email.messageId,
        occurredAt,
        receivedAt: new Date(input.email.receivedAt).toISOString(),
        webUrl: this.normalizedOptionalUrl(input.email),
        workspaceId: actor.workspaceId,
      });
      const evidence = this.getApplicationEvidence(actor, application.id);
      return {
        action: created ? "created" : updated ? "updated" : "matched",
        application,
        emailEvidence: evidence.emailEvidence,
        emailEvidenceLinked: emailResult.created,
        jobPostings: evidence.jobPostings,
        matchLevel: match.level,
        postingLinked: postingResult?.created ?? false,
      };
    });
  }

  private findLegacyPostingMatches(
    applications: ApplicationRecord[],
    posting: ResolvedJobPostingEvidence,
    level: "posting_id" | "canonical_url",
  ): string[] {
    const matches = new Set<string>();
    for (const application of applications) {
      const urls = [
        application.sourceUrl,
        ...application.links.map(({ url }) => url),
      ].filter((url): url is string => url !== null);
      for (const url of urls) {
        try {
          const parsed = normalizedUrl(url);
          const candidatePosting = this.providers.match(parsed);
          if (
            level === "posting_id" &&
            posting.externalPostingId &&
            candidatePosting?.externalPostingId &&
            candidatePosting.provider === posting.provider &&
            normalizeExternalPostingId(candidatePosting.externalPostingId) ===
              posting.externalPostingId
          ) {
            matches.add(application.id);
          }
          const candidateUrl = candidatePosting?.url.href ?? parsed.href;
          if (
            level === "canonical_url" &&
            posting.canonicalUrl === candidateUrl
          ) {
            matches.add(application.id);
          }
        } catch {
          continue;
        }
      }
    }
    return [...matches];
  }

  private normalizedOptionalUrl(input: JobEmailEvidenceInput): string | null {
    return input.webUrl ? normalizedUrl(input.webUrl).href : null;
  }

  private resolvePostingEvidence(
    input: JobPostingEvidenceInput,
  ): ResolvedJobPostingEvidence {
    const parsed = input.url ? normalizedUrl(input.url) : undefined;
    const matched = parsed ? this.providers.match(parsed) : undefined;
    if (matched) {
      if (!samePosting(input, matched)) {
        throw new InvalidJobPostingEvidenceError();
      }
      return {
        canonicalUrl: matched.url.href,
        externalPostingId: matched.externalPostingId
          ? normalizeExternalPostingId(matched.externalPostingId)
          : null,
        provider: matched.provider,
      };
    }
    if (parsed && input.provider && input.externalPostingId) {
      throw new InvalidJobPostingEvidenceError();
    }
    if (input.provider && input.externalPostingId) {
      return {
        canonicalUrl: parsed?.href ?? null,
        externalPostingId: normalizeExternalPostingId(input.externalPostingId),
        provider: input.provider,
      };
    }
    if (parsed) {
      return {
        canonicalUrl: parsed.href,
        externalPostingId: null,
        provider: "generic",
      };
    }
    throw new InvalidJobPostingEvidenceError();
  }
}
