import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import { EmailLinkExtractionService } from "./email_links.js";
import type { ResolvedJobLinkCandidate } from "./job_links.js";
import { OutlookJobDigestProcessingService } from "./outlook_job_digest.js";
import type {
  OutlookMailMessageDetail,
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

function harness(messages: OutlookMailMessageDetail[]) {
  const findMessagesByInternetMessageId = vi.fn(() =>
    Promise.resolve(messages),
  );
  const reader: OutlookMailReader = {
    findMessagesByInternetMessageId,
    getMessages: () => Promise.resolve([]),
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
    inspect,
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
});
