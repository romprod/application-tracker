import { afterEach, describe, expect, it, vi } from "vitest";

import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteJobEmailReconciliationRepository } from "../infrastructure/database/job_email_reconciliation_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import {
  ApplicationConflictError,
  ApplicationLedgerService,
} from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import { EmailLinkExtractionService } from "./email_links.js";
import { JobEmailReconciliationService } from "./job_email_reconciliation.js";
import {
  OutlookEmailSyncOperationalError,
  OutlookEmailSyncService,
  type OutlookMailMessageDetail,
  type OutlookMailMessageSummary,
  type OutlookMailReader,
  type OutlookMailReaderProvider,
} from "./outlook_email_sync.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function transactionalMessage(
  overrides: Partial<OutlookMailMessageDetail> = {},
): OutlookMailMessageDetail {
  return {
    body: {
      content:
        "Thank you for applying for Platform Engineer at Example Company. We received your application.",
      contentType: "text",
    },
    bodyPreview:
      "Thank you for applying for Platform Engineer at Example Company.",
    from: { address: "recruiter@example.com", name: "Recruiter" },
    headers: [],
    id: "message-1",
    internetMessageId: "<message-1@example.com>",
    receivedAt: "2026-07-21T15:30:00.000Z",
    replyTo: [],
    subject: "Application received: Platform Engineer",
    webUrl: "https://outlook.office.com/mail/inbox/id/message-1",
    ...overrides,
  };
}

function summary(message: OutlookMailMessageDetail): OutlookMailMessageSummary {
  return {
    bodyPreview: message.bodyPreview,
    from: message.from,
    id: message.id,
    internetMessageId: message.internetMessageId,
    receivedAt: message.receivedAt,
    searchKinds: ["company_role"],
    subject: message.subject,
    webUrl: message.webUrl,
  };
}

interface InstrumentedMailReader extends OutlookMailReader {
  callCounts: {
    details: number;
    searches: number;
  };
}

function mailReader(message: OutlookMailMessageDetail): InstrumentedMailReader {
  const callCounts = { details: 0, searches: 0 };
  return {
    callCounts,
    getMessages: () => {
      callCounts.details += 1;
      return Promise.resolve([message]);
    },
    searchMessages: () => {
      callCounts.searches += 1;
      return Promise.resolve({
        messages: [summary(message)],
        queriesRun: 1,
      });
    },
    validateEvidence: (evidence) =>
      Promise.resolve(
        evidence.map(({ messageId }) => ({
          messageId,
          status: "valid" as const,
        })),
      ),
  };
}

function harness(
  reader: OutlookMailReader | OutlookMailReaderProvider = mailReader(
    transactionalMessage(),
  ),
) {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-20T12:00:00.000Z",
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  const actor: AuthenticatedActor = {
    authenticated: true,
    user: {
      displayName: setup.administrator.displayName,
      role: "admin",
      username: setup.administrator.username,
    },
    userId: setup.administrator.id,
    workspace: { name: setup.workspace.name },
    workspaceId: setup.workspace.id,
  };
  const applications = new ApplicationLedgerService(
    new SqliteApplicationsRepository(database),
    () => new Date("2026-07-20T13:00:00.000Z"),
  );
  const jobEmails = new JobEmailReconciliationService(
    new SqliteJobEmailReconciliationRepository(database),
    applications,
    (operation) => database.transaction(operation).immediate(),
    () => new Date("2026-07-21T16:00:00.000Z"),
  );
  const statusId = database
    .prepare(
      `SELECT id FROM reference_values
       WHERE workspace_id = ? AND category = 'status'
       ORDER BY sort_order LIMIT 1`,
    )
    .pluck()
    .get(setup.workspace.id) as string;
  const application = applications.createApplication(actor, {
    appliedOn: "2026-07-20",
    companyName: "Example Company",
    contacts: [
      {
        email: "recruiter@example.com",
        name: "Recruiter",
      },
    ],
    roleTitle: "Platform Engineer",
    statusId,
  });
  const sync = new OutlookEmailSyncService(
    applications,
    jobEmails,
    new EmailLinkExtractionService(),
    reader,
  );
  return {
    actor,
    application,
    applications,
    database,
    jobEmails,
    statusId,
    sync,
  };
}

describe("OutlookEmailSyncService", () => {
  it("fails closed when the application has no assigned Outlook reader", async () => {
    const forApplication = vi.fn(() => {
      throw new OutlookEmailSyncOperationalError(
        "outlook_graph_connection_unassigned",
      );
    });
    const provider: OutlookMailReaderProvider = {
      forApplication,
    };
    const { actor, application, sync } = harness(provider);

    await expect(sync.prepare(actor, application.id)).rejects.toMatchObject({
      code: "outlook_graph_connection_unassigned",
    });
    expect(forApplication).toHaveBeenCalledWith(
      actor.workspaceId,
      application.id,
    );
  });

  it("resolves the application's assigned reader for every synchronization", async () => {
    const reader = mailReader(transactionalMessage());
    const forApplication = vi.fn(() => reader);
    const provider: OutlookMailReaderProvider = {
      forApplication,
    };
    const { actor, application, sync } = harness(provider);

    await sync.prepare(actor, application.id);
    await sync.prepare(actor, application.id);

    expect(forApplication).toHaveBeenCalledTimes(2);
    expect(forApplication).toHaveBeenCalledWith(
      actor.workspaceId,
      application.id,
    );
  });

  it("links one high-confidence transactional message and verifies the read-back", async () => {
    const { actor, application, database, sync } = harness();

    const prepared = await sync.prepare(actor, application.id);
    const result = sync.commit(actor, prepared);

    expect(result).toMatchObject({
      application: { id: application.id },
      candidateAssessments: [
        {
          classification: "application_acknowledgement",
          messageId: "<message-1@example.com>",
          qualified: true,
        },
      ],
      emailEvidence: [
        {
          evidenceType: "application_confirmation",
          messageId: "<message-1@example.com>",
        },
      ],
      link: { attempted: true, created: true },
      outcome: "linked",
      verification: {
        applicationReread: true,
        evidenceStored: true,
        storedMessageId: "<message-1@example.com>",
      },
    });
    expect(result.candidateAssessments[0]?.reasons).toEqual(
      expect.arrayContaining([
        "company_match",
        "contact_match",
        "role_match",
        "transactional_message",
      ]),
    );
    expect(
      database
        .prepare(
          "SELECT count(*) FROM application_email_evidence WHERE application_id = ?",
        )
        .pluck()
        .get(application.id),
    ).toBe(1);
  });

  it("rejects a marketing message even when it names the company and role", async () => {
    const message = transactionalMessage({
      headers: [{ name: "List-Unsubscribe", value: "<https://unsubscribe>" }],
      subject: "Daily job alert: Platform Engineer at Example Company",
    });
    const { actor, application, database, sync } = harness(mailReader(message));

    const result = sync.commit(
      actor,
      await sync.prepare(actor, application.id),
    );

    expect(result.outcome).toBe("no_match");
    expect(result.candidateAssessments[0]).toMatchObject({
      classification: "marketing_or_digest",
      qualified: false,
    });
    expect(result.candidateAssessments[0]?.disqualifiers).toContain(
      "marketing_or_account_message",
    );
    expect(
      database
        .prepare("SELECT count(*) FROM application_email_evidence")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("returns ambiguity instead of linking when company and title identify duplicates", async () => {
    const { actor, application, applications, database, statusId, sync } =
      harness();
    applications.createApplication(actor, {
      appliedOn: "2026-07-20",
      companyName: "Example Company",
      roleTitle: "Platform Engineer",
      statusId,
    });

    const result = sync.commit(
      actor,
      await sync.prepare(actor, application.id),
    );

    expect(result.outcome).toBe("ambiguous");
    expect(result.candidateAssessments[0]?.disqualifiers).toContain(
      "tracker_match_ambiguous",
    );
    expect(
      database
        .prepare("SELECT count(*) FROM application_email_evidence")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("rejects a candidate whose Message-ID belongs to another application", async () => {
    const {
      actor,
      application,
      applications,
      database,
      jobEmails,
      statusId,
      sync,
    } = harness();
    const other = applications.createApplication(actor, {
      companyName: "Other Company",
      roleTitle: "Other Role",
      statusId,
    });
    jobEmails.linkEvidence(actor, {
      applicationId: other.id,
      email: {
        messageId: "<message-1@example.com>",
        receivedAt: "2026-07-21T15:30:00.000Z",
      },
      evidenceType: "other",
    });

    const result = sync.commit(
      actor,
      await sync.prepare(actor, application.id),
    );

    expect(result.outcome).toBe("conflict");
    expect(result.candidateAssessments[0]?.disqualifiers).toContain(
      "tracker_match_conflict",
    );
    expect(
      database
        .prepare(
          "SELECT count(*) FROM application_email_evidence WHERE application_id = ?",
        )
        .pluck()
        .get(application.id),
    ).toBe(0);
  });

  it("scores an exact legacy posting identity even when the persisted matcher has no posting row", async () => {
    const message = transactionalMessage({
      body: {
        content:
          "We received your application. https://www.linkedin.com/jobs/view/4405273020",
        contentType: "text",
      },
      bodyPreview: "We received your application.",
      from: { address: "notifications@job-board.example", name: "Job board" },
      subject: "Application received",
    });
    const { actor, application, applications, jobEmails, sync } = harness(
      mailReader(message),
    );
    applications.updateApplication(actor, application.id, {
      expectedUpdatedAt: application.updatedAt,
      sourceUrl: "https://www.linkedin.com/jobs/view/4405273020",
    });
    const realMatch = jobEmails.match.bind(jobEmails);
    vi.spyOn(jobEmails, "match").mockImplementation((matchActor, input) =>
      input.posting
        ? { level: null, matches: [], outcome: "none" }
        : realMatch(matchActor, input),
    );

    const result = sync.commit(
      actor,
      await sync.prepare(actor, application.id),
    );

    expect(result).toMatchObject({
      candidateAssessments: [
        {
          qualified: true,
        },
      ],
      outcome: "linked",
    });
    expect(result.candidateAssessments[0]?.reasons).toEqual(
      expect.arrayContaining(["posting_id_match", "transactional_message"]),
    );
  });

  it("detects an application change between Graph preparation and commit", async () => {
    const { actor, application, applications, database, sync } = harness();
    const prepared = await sync.prepare(actor, application.id);
    applications.updateApplication(actor, application.id, {
      expectedUpdatedAt: application.updatedAt,
      notes: "Changed while Graph reads were running",
    });

    expect(() => sync.commit(actor, prepared)).toThrow(
      ApplicationConflictError,
    );
    expect(
      database
        .prepare("SELECT count(*) FROM application_email_evidence")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("detects a new evidence row between Graph preparation and commit", async () => {
    const { actor, application, database, jobEmails, sync } = harness();
    const prepared = await sync.prepare(actor, application.id);
    jobEmails.linkEvidence(actor, {
      applicationId: application.id,
      email: {
        messageId: "<concurrent@example.com>",
        receivedAt: "2026-07-21T15:45:00.000Z",
      },
      evidenceType: "other",
    });

    expect(() => sync.commit(actor, prepared)).toThrow(
      ApplicationConflictError,
    );
    expect(
      database
        .prepare(
          "SELECT message_id FROM application_email_evidence ORDER BY message_id",
        )
        .pluck()
        .all(),
    ).toEqual(["<concurrent@example.com>"]);
  });

  it("treats an exact retry as already linked while still searching the folder", async () => {
    const reader = mailReader(transactionalMessage());
    const { actor, application, database, sync } = harness(reader);
    const first = sync.commit(actor, await sync.prepare(actor, application.id));
    const repeated = sync.commit(
      actor,
      await sync.prepare(actor, application.id),
    );

    expect(first.outcome).toBe("linked");
    expect(repeated).toMatchObject({
      link: { attempted: false, created: false },
      outcome: "already_linked",
      verification: {
        evidenceStored: true,
        storedMessageId: "<message-1@example.com>",
      },
    });
    expect(reader.callCounts).toEqual({ details: 2, searches: 2 });
    expect(
      database
        .prepare("SELECT count(*) FROM application_email_evidence")
        .pluck()
        .get(),
    ).toBe(1);
  });
});
