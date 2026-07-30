import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import { EmailLinkExtractionService } from "./email_links.js";
import type { ResolvedJobLinkCandidate } from "./job_links.js";
import { OutlookJobDigestProcessingService } from "./outlook_job_digest.js";
import type {
  OutlookMailMessageDetail,
  OutlookMailMessageSummary,
  OutlookMailReader,
} from "./outlook_email_sync.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex Example", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};

function message(
  overrides: Partial<OutlookMailMessageDetail> = {},
): OutlookMailMessageDetail {
  return {
    body: {
      content:
        '<a href="https://www.linkedin.com/jobs/view/4405273020">Platform role</a>',
      contentType: "html",
    },
    bodyPreview: "Recommended jobs for you",
    from: { address: "alerts@example.com", name: "Job alerts" },
    headers: [
      { name: "List-Unsubscribe", value: "<https://example.com/unsubscribe>" },
    ],
    id: "graph-message-1",
    internetMessageId: "<digest-1@example.com>",
    receivedAt: "2026-07-30T08:00:00.000Z",
    replyTo: [],
    subject: "Daily job alert",
    webUrl: "https://outlook.office.com/mail/inbox/id/graph-message-1",
    ...overrides,
  };
}

function candidate(index: number): ResolvedJobLinkCandidate {
  return {
    externalPostingId: `440527302${String(index)}`,
    host: "www.linkedin.com",
    provider: "linkedin",
    redirectsFollowed: 0,
    resolution: "deterministic",
    url: `https://www.linkedin.com/jobs/view/440527302${String(index)}`,
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

function harness(messages: OutlookMailMessageDetail[]) {
  const findMessagesByInternetMessageId = vi.fn(() =>
    Promise.resolve(messages),
  );
  const getMessages = vi.fn(() => Promise.resolve(messages));
  const listMessagesReceivedBackward = vi.fn(() =>
    Promise.resolve({
      messages: messages.map((value) => summary(value)),
      truncated: false,
    }),
  );
  const reader: OutlookMailReader = {
    findMessagesByInternetMessageId,
    getMessages,
    listMessagesReceivedBackward,
    listMessagesReceivedBetween: () =>
      Promise.resolve({ messages: [], truncated: false }),
    searchMessages: () => Promise.resolve({ messages: [], queriesRun: 0 }),
    validateEvidence: () => Promise.resolve([]),
  };
  const connections = {
    forReconciliation: vi.fn(() => ({
      connection: {
        createdAt: "2026-07-01T00:00:00.000Z",
        folderPath: "Inbox\\Jobs",
        id: "11111111-1111-4111-8111-111111111111",
        lastReconciledAt: null,
        mailbox: "jobs@example.com",
        name: "Work tenant",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      mail: reader,
    })),
  };
  const resolve = vi.fn(() =>
    Promise.resolve({
      candidates: Array.from({ length: 6 }, (_, index) => candidate(index)),
      tracking: {
        attempted: 1,
        resolved: 1,
        unavailable: [],
      },
    }),
  );
  const inspect = vi.fn(({ url }: { url: string }) =>
    Promise.resolve({
      applyUrl: url,
      canonicalUrl: url,
      closingDate: "2026-08-31",
      description: "x".repeat(4_500),
      employer: "Example Company",
      location: "Manchester",
      salary: "GBP 80,000 YEAR",
      status: "available" as const,
      title: "Platform Engineer",
      workArrangement: "hybrid" as const,
    }),
  );
  const match = vi.fn(() => ({
    level: null,
    matches: [],
    outcome: "none" as const,
  }));
  const service = new OutlookJobDigestProcessingService(
    connections,
    { match },
    new EmailLinkExtractionService(),
    { resolve },
    { inspect },
  );
  return {
    connections,
    findMessagesByInternetMessageId,
    getMessages,
    inspect,
    listMessagesReceivedBackward,
    match,
    resolve,
    service,
  };
}

describe("OutlookJobDigestProcessingService", () => {
  it("reads one exact digest, inspects a bounded page, and returns no body", async () => {
    const value = harness([message()]);

    const result = await value.service.process(actor, {
      connection: "jobs@example.com",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });

    expect(result).toMatchObject({
      classification: "marketing_or_digest",
      connection: {
        folderPath: "Inbox\\Jobs",
        mailbox: "jobs@example.com",
        name: "Work tenant",
      },
      digest: {
        messageId: "<digest-1@example.com>",
        receivedAt: "2026-07-30T08:00:00.000Z",
        sender: "alerts@example.com",
        subject: "Daily job alert",
      },
      outcome: "processed",
      page: {
        nextOffset: 5,
        offset: 0,
        returned: 5,
        total: 6,
      },
      tracking: { attempted: 1, resolved: 1, unavailable: [] },
      verification: {
        exactMessageMatches: 1,
        mailboxReadOnly: true,
        messageBodyReturned: false,
      },
    });
    expect(result.postings).toHaveLength(5);
    expect(result.postings[0]).toMatchObject({
      descriptionTruncated: true,
      digestFallback: {
        attempted: false,
        unavailableReason: null,
      },
      inspectionSource: "provider_page",
      inspection: {
        description: "x".repeat(4_000),
        status: "available",
      },
      match: { outcome: "none" },
    });
    expect(JSON.stringify(result)).not.toContain("Platform role");
    expect(value.findMessagesByInternetMessageId).toHaveBeenCalledWith(
      "<digest-1@example.com>",
    );
    expect(value.inspect).toHaveBeenCalledTimes(5);
    expect(value.match).toHaveBeenCalledTimes(5);
  });

  it("uses an explicitly paired digest card when a provider challenge blocks inspection", async () => {
    const value = harness([
      message({
        body: {
          content: `
            <table><tr data-job-card>
              <td>
                <a class="job-title"
                   href="https://uk.indeed.com/pagead/clk?jk=96550901704ee48a&amp;from=jobalert">
                  Senior Platform Engineer
                </a>
                <div class="company-name">Example Ltd</div>
              </td>
            </tr></table>
          `,
          contentType: "html",
        },
      }),
    ]);
    const indeedCandidate: ResolvedJobLinkCandidate = {
      externalPostingId: "96550901704ee48a",
      host: "uk.indeed.com",
      provider: "indeed",
      redirectsFollowed: 0,
      resolution: "deterministic",
      url: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
    };
    value.resolve.mockResolvedValue({
      candidates: [indeedCandidate],
      tracking: { attempted: 0, resolved: 0, unavailable: [] },
    });
    value.inspect.mockResolvedValue({
      canonicalUrl: indeedCandidate.url,
      reason: "provider_challenge",
      retryAfter: "2026-07-30T08:15:00.000Z",
      status: "unavailable",
    });

    const result = await value.service.process(actor, {
      connection: "Work tenant",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });

    expect(result.postings).toEqual([
      {
        candidate: indeedCandidate,
        descriptionTruncated: false,
        inspection: {
          applyUrl: indeedCandidate.url,
          canonicalUrl: indeedCandidate.url,
          closingDate: null,
          description: null,
          employer: "Example Ltd",
          location: null,
          salary: null,
          status: "available",
          title: "Senior Platform Engineer",
          workArrangement: null,
        },
        digestFallback: {
          attempted: true,
          unavailableReason: null,
        },
        inspectionSource: "digest_email",
        match: { level: null, matches: [], outcome: "none" },
      },
    ]);
    expect(value.match).toHaveBeenCalledWith(actor, {
      companyName: "Example Ltd",
      posting: { url: indeedCandidate.url },
      roleTitle: "Senior Platform Engineer",
    });
    expect(JSON.stringify(result)).not.toContain("data-job-card");
  });

  it("rejects incomplete or ambiguous digest-card fallback metadata", async () => {
    const value = harness([
      message({
        body: {
          content: `
            <div data-job-card>
              <a class="job-title"
                 href="https://uk.indeed.com/viewjob?jk=96550901704ee48a">
                Senior Platform Engineer
              </a>
              <div class="company-name">Example Ltd</div>
              <div class="employer">Different Ltd</div>
            </div>
          `,
          contentType: "html",
        },
      }),
    ]);
    const indeedCandidate: ResolvedJobLinkCandidate = {
      externalPostingId: "96550901704ee48a",
      host: "uk.indeed.com",
      provider: "indeed",
      redirectsFollowed: 0,
      resolution: "deterministic",
      url: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
    };
    value.resolve.mockResolvedValue({
      candidates: [indeedCandidate],
      tracking: { attempted: 0, resolved: 0, unavailable: [] },
    });
    const unavailable = {
      canonicalUrl: indeedCandidate.url,
      reason: "provider_challenge" as const,
      retryAfter: "2026-07-30T08:15:00.000Z",
      status: "unavailable" as const,
    };
    value.inspect.mockResolvedValue(unavailable);

    const result = await value.service.process(actor, {
      connection: "Work tenant",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });

    expect(result.postings[0]).toMatchObject({
      descriptionTruncated: false,
      digestFallback: {
        attempted: true,
        unavailableReason: "employer_ambiguous",
      },
      inspection: unavailable,
      inspectionSource: "provider_page",
    });
    expect(value.match).toHaveBeenCalledWith(actor, {
      posting: { url: indeedCandidate.url },
    });
  });

  it("rejects an oversized digest card instead of missing a later posting link", async () => {
    const value = harness([
      message({
        body: {
          content: `
            <div data-job-card>
              <a class="job-title"
                 href="https://uk.indeed.com/viewjob?jk=96550901704ee48a">
                Senior Platform Engineer
              </a>
              <div class="company-name">Example Ltd</div>
              ${Array.from({ length: 105 }, () => "<span>x</span>").join("")}
              <a href="https://www.linkedin.com/jobs/view/4405273020">
                Another job
              </a>
            </div>
          `,
          contentType: "html",
        },
      }),
    ]);
    const indeedCandidate: ResolvedJobLinkCandidate = {
      externalPostingId: "96550901704ee48a",
      host: "uk.indeed.com",
      provider: "indeed",
      redirectsFollowed: 0,
      resolution: "deterministic",
      url: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
    };
    value.resolve.mockResolvedValue({
      candidates: [indeedCandidate],
      tracking: { attempted: 0, resolved: 0, unavailable: [] },
    });
    value.inspect.mockResolvedValue({
      canonicalUrl: indeedCandidate.url,
      reason: "provider_challenge",
      retryAfter: "2026-07-30T08:15:00.000Z",
      status: "unavailable",
    });

    const result = await value.service.process(actor, {
      connection: "Work tenant",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });

    expect(result.postings[0]).toMatchObject({
      digestFallback: {
        attempted: true,
        unavailableReason: "card_elements_exceeded",
      },
      inspection: {
        reason: "provider_challenge",
        status: "unavailable",
      },
      inspectionSource: "provider_page",
    });
  });

  it.each([
    {
      content: `
        <div data-job-card>
          <a class="job-title"
             href="https://www.linkedin.com/jobs/view/4405273020">
            Senior Platform Engineer
          </a>
        </div>
      `,
      unavailableReason: "employer_missing",
    },
    {
      content: `
        <div data-job-card>
          <a class="job-title"
             href="https://www.linkedin.com/jobs/view/4405273020">
            Senior Platform Engineer
          </a>
          <div class="company-name">Example Ltd</div>
          <a href="https://www.linkedin.com/jobs/view/4405273021">
            Another job
          </a>
        </div>
      `,
      unavailableReason: "multiple_posting_links",
    },
  ] as const)(
    "reports $unavailableReason without returning digest content",
    async ({ content, unavailableReason }) => {
      const value = harness([
        message({ body: { content, contentType: "html" } }),
      ]);
      value.resolve.mockResolvedValue({
        candidates: [candidate(0)],
        tracking: { attempted: 0, resolved: 0, unavailable: [] },
      });
      value.inspect.mockResolvedValue({
        canonicalUrl: candidate(0).url,
        reason: "provider_challenge",
        retryAfter: "2026-07-30T08:15:00.000Z",
        status: "unavailable",
      });

      const result = await value.service.process(actor, {
        connection: "Work tenant",
        messageId: "<digest-1@example.com>",
        offset: 0,
      });

      expect(result.postings[0]).toMatchObject({
        digestFallback: { attempted: true, unavailableReason },
        inspectionSource: "provider_page",
      });
      expect(JSON.stringify(result)).not.toContain("data-job-card");
    },
  );

  it("prefers provider JSON-LD over paired digest-card metadata", async () => {
    const value = harness([
      message({
        body: {
          content: `
            <div data-job-card>
              <a class="job-title"
                 href="https://www.linkedin.com/jobs/view/4405273020">
                Email title
              </a>
              <div class="company-name">Email employer</div>
            </div>
          `,
          contentType: "html",
        },
      }),
    ]);

    const result = await value.service.process(actor, {
      connection: "Work tenant",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });

    expect(result.postings[0]).toMatchObject({
      digestFallback: {
        attempted: false,
        unavailableReason: null,
      },
      inspection: {
        employer: "Example Company",
        title: "Platform Engineer",
      },
      inspectionSource: "provider_page",
    });
  });

  it("does not use digest-card metadata for non-challenge inspection failures", async () => {
    const value = harness([
      message({
        body: {
          content: `
            <div data-job-card>
              <a class="job-title"
                 href="https://www.linkedin.com/jobs/view/4405273020">
                Email title
              </a>
              <div class="company-name">Email employer</div>
            </div>
          `,
          contentType: "html",
        },
      }),
    ]);
    value.inspect.mockResolvedValue({
      canonicalUrl: candidate(0).url,
      reason: "missing_structured_data",
      status: "unavailable",
    });

    const result = await value.service.process(actor, {
      connection: "Work tenant",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });

    expect(result.postings[0]).toMatchObject({
      digestFallback: {
        attempted: false,
        unavailableReason: null,
      },
      inspection: {
        reason: "missing_structured_data",
        status: "unavailable",
      },
      inspectionSource: "provider_page",
    });
  });

  it("pages through the remaining postings deterministically", async () => {
    const value = harness([message()]);

    const result = await value.service.process(actor, {
      connection: "Work tenant",
      messageId: "<digest-1@example.com>",
      offset: 5,
    });

    expect(result.page).toEqual({
      nextOffset: null,
      offset: 5,
      returned: 1,
      total: 6,
    });
    expect(result.postings.map(({ candidate: posting }) => posting)).toEqual([
      candidate(5),
    ]);
  });

  it("does not resolve or inspect a transactional message", async () => {
    const value = harness([
      message({
        body: {
          content:
            "Thank you for applying for Platform Engineer at Example Company.",
          contentType: "text",
        },
        headers: [],
        subject: "Application received",
      }),
    ]);

    const result = await value.service.process(actor, {
      connection: "Work tenant",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });

    expect(result).toMatchObject({
      classification: "application_acknowledgement",
      outcome: "not_digest",
      postings: [],
    });
    expect(value.resolve).not.toHaveBeenCalled();
    expect(value.inspect).not.toHaveBeenCalled();
  });

  it.each([
    { expectedMatches: 0, messages: [], outcome: "not_found" as const },
    {
      expectedMatches: 2,
      messages: [message(), message({ id: "graph-message-2" })],
      outcome: "ambiguous" as const,
    },
  ])(
    "returns $outcome when the exact Message-ID resolves $expectedMatches times",
    async ({ expectedMatches, messages, outcome }) => {
      const value = harness(messages);

      const result = await value.service.process(actor, {
        connection: "Work tenant",
        messageId: "<digest-1@example.com>",
        offset: 0,
      });

      expect(result).toMatchObject({
        classification: null,
        digest: null,
        outcome,
        postings: [],
        verification: { exactMessageMatches: expectedMatches },
      });
      expect(value.resolve).not.toHaveBeenCalled();
    },
  );

  it("searches a fixed window backward and returns classifications without bodies", async () => {
    const digest = message();
    const acknowledgement = message({
      body: {
        content:
          "Thank you for applying for Platform Engineer at Example Company.",
        contentType: "text",
      },
      headers: [],
      id: "graph-message-2",
      internetMessageId: "<application-1@example.com>",
      receivedAt: "2026-07-29T08:00:00.000Z",
      subject: "Application received",
    });
    const value = harness([digest, acknowledgement]);

    const result = await value.service.search(actor, {
      after: "2026-07-23T00:00:00.000Z",
      before: "2026-07-30T09:00:00.000Z",
      connection: "jobs@example.com",
      limit: 20,
      offset: 0,
    });

    expect(result).toMatchObject({
      connection: {
        lastReconciledAt: null,
        mailbox: "jobs@example.com",
      },
      messages: [
        {
          classification: "marketing_or_digest",
          messageId: "<digest-1@example.com>",
        },
        {
          classification: "application_acknowledgement",
          messageId: "<application-1@example.com>",
        },
      ],
      page: {
        detailsRead: 2,
        limit: 20,
        limitReached: false,
        nextOffset: null,
        offset: 0,
        scanned: 2,
      },
      unavailable: [],
      verification: {
        applicationStateChanged: false,
        cursorChanged: false,
        mailboxReadOnly: true,
        messageBodyReturned: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("Platform role");
    expect(value.listMessagesReceivedBackward).toHaveBeenCalledWith({
      after: "2026-07-23T00:00:00.000Z",
      before: "2026-07-30T09:00:00.000Z",
      limit: 20,
      offset: 0,
    });
    expect(value.getMessages).toHaveBeenCalledWith([
      "graph-message-1",
      "graph-message-2",
    ]);
    expect(value.resolve).not.toHaveBeenCalled();
    expect(value.inspect).not.toHaveBeenCalled();
    expect(value.match).not.toHaveBeenCalled();
  });

  it("reports backward-search pagination and messages unavailable after listing", async () => {
    const value = harness([message()]);
    value.listMessagesReceivedBackward.mockResolvedValue({
      messages: [summary(message())],
      truncated: true,
    });
    value.getMessages.mockResolvedValue([]);

    const result = await value.service.search(actor, {
      after: "2026-07-23T00:00:00.000Z",
      before: "2026-07-30T09:00:00.000Z",
      connection: "Work tenant",
      limit: 1,
      offset: 4,
    });

    expect(result.messages).toEqual([]);
    expect(result.page).toEqual({
      detailsRead: 0,
      limit: 1,
      limitReached: false,
      nextOffset: 5,
      offset: 4,
      scanned: 1,
    });
    expect(result.unavailable).toEqual([
      {
        messageId: "<digest-1@example.com>",
        reason: "detail_unavailable",
        receivedAt: "2026-07-30T08:00:00.000Z",
        subject: "Daily job alert",
      },
    ]);
  });

  it("stops instead of returning an offset beyond the 500-message ceiling", async () => {
    const value = harness([message()]);
    value.listMessagesReceivedBackward.mockResolvedValue({
      messages: [summary(message())],
      truncated: true,
    });

    const result = await value.service.search(actor, {
      after: "2026-07-23T00:00:00.000Z",
      before: "2026-07-30T09:00:00.000Z",
      connection: "Work tenant",
      limit: 1,
      offset: 499,
    });

    expect(result.page).toMatchObject({
      limitReached: true,
      nextOffset: null,
      offset: 499,
      scanned: 1,
    });
  });
});
