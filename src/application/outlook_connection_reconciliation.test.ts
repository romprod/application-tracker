import { afterEach, describe, expect, it, vi } from "vitest";

import { AesGcmOutlookGraphSecretCipher } from "../infrastructure/auth/outlook_graph_secret_cipher.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteJobEmailReconciliationRepository } from "../infrastructure/database/job_email_reconciliation_repository.js";
import { SqliteOutlookGraphConnectionsRepository } from "../infrastructure/database/outlook_graph_connections_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { ApplicationLedgerService } from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import { EmailLinkExtractionService } from "./email_links.js";
import { JobEmailReconciliationService } from "./job_email_reconciliation.js";
import { OutlookConnectionReconciliationService } from "./outlook_connection_reconciliation.js";
import {
  OutlookEmailSyncService,
  type OutlookMailMessageDetail,
  type OutlookMailReader,
} from "./outlook_email_sync.js";
import {
  OutlookGraphConnectionsService,
  type OutlookGraphConnectionAdapter,
} from "./outlook_graph_connections.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function message(
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
    receivedAt: "2026-07-29T10:30:00.000Z",
    replyTo: [],
    subject: "Application received: Platform Engineer",
    webUrl: "https://outlook.office.com/mail/inbox/id/message-1",
    ...overrides,
  };
}

function harness() {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-29T09:00:00.000Z",
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
  let now = "2026-07-29T10:00:00.000Z";
  let currentMessages = [message()];
  let truncated = false;
  const listMessagesReceivedBetween = vi.fn(
    (window: { after: string; through: string }) =>
      Promise.resolve({
        messages: currentMessages.map((detail) => ({
          bodyPreview: detail.bodyPreview,
          from: detail.from,
          id: detail.id,
          internetMessageId: detail.internetMessageId,
          receivedAt: detail.receivedAt,
          searchKinds: [],
          subject: detail.subject,
          webUrl: detail.webUrl,
        })),
        truncated,
        window,
      }),
  );
  const reader: OutlookMailReader = {
    getMessages: (ids) =>
      Promise.resolve(
        currentMessages.filter((detail) => ids.includes(detail.id)),
      ),
    listMessagesReceivedBetween,
    searchMessages: () => Promise.resolve({ messages: [], queriesRun: 0 }),
    validateEvidence: () => Promise.resolve([]),
  };
  const adapter: OutlookGraphConnectionAdapter = {
    createReader: () => reader,
    verify: () => Promise.resolve(),
  };
  const connectionRepository = new SqliteOutlookGraphConnectionsRepository(
    database,
  );
  const connections = new OutlookGraphConnectionsService(
    connectionRepository,
    new AesGcmOutlookGraphSecretCipher(Buffer.alloc(32, 7)),
    adapter,
    () => new Date(now),
  );
  const applications = new ApplicationLedgerService(
    new SqliteApplicationsRepository(database),
    () => new Date("2026-07-29T10:05:00.000Z"),
  );
  const jobEmails = new JobEmailReconciliationService(
    new SqliteJobEmailReconciliationRepository(database),
    applications,
    (operation) => database.transaction(operation).immediate(),
    () => new Date(now),
  );
  const emailLinks = new EmailLinkExtractionService();
  const emailSync = new OutlookEmailSyncService(
    applications,
    jobEmails,
    emailLinks,
    connections,
  );
  const reconcile = new OutlookConnectionReconciliationService(
    applications,
    jobEmails,
    emailSync,
    connections,
    () => new Date(now),
  );
  return {
    actor,
    applications,
    connectionRepository,
    connections,
    database,
    jobEmails,
    listMessagesReceivedBetween,
    reconcile,
    setMessages: (messages: OutlookMailMessageDetail[]) => {
      currentMessages = messages;
    },
    setNow: (timestamp: string) => {
      now = timestamp;
    },
    setTruncated: (value: boolean) => {
      truncated = value;
    },
  };
}

async function createConnectionAndApplication(
  value: ReturnType<typeof harness>,
) {
  const status = await value.connections.create(value.actor, {
    clientId: "22222222-2222-4222-8222-222222222222",
    clientSecret: "private-client-secret",
    folderPath: "Inbox\\Jobs",
    mailbox: "jobs@example.com",
    name: "Work tenant",
    tenantId: "11111111-1111-4111-8111-111111111111",
  });
  const connectionId = status.connections[0]!.id;
  const statusId = value.database
    .prepare(
      `SELECT id FROM reference_values
       WHERE workspace_id = ? AND category = 'status'
       ORDER BY sort_order LIMIT 1`,
    )
    .pluck()
    .get(value.actor.workspaceId) as string;
  const application = value.applications.createApplication(value.actor, {
    appliedOn: "2026-07-28",
    companyName: "Example Company",
    contacts: [{ email: "recruiter@example.com", name: "Recruiter" }],
    outlookGraphConnectionId: connectionId,
    roleTitle: "Platform Engineer",
    statusId,
  });
  return { application, connectionId, statusId };
}

describe("OutlookConnectionReconciliationService", () => {
  it("resolves a mailbox, links unique evidence, and advances the successful cursor", async () => {
    const value = harness();
    const { application, connectionId } =
      await createConnectionAndApplication(value);
    value.setNow("2026-07-29T11:00:00.000Z");

    const prepared = await value.reconcile.prepare(
      value.actor,
      "jobs@example.com",
    );
    const result = value.reconcile.commit(value.actor, prepared);

    expect(value.listMessagesReceivedBetween).toHaveBeenCalledWith({
      after: "2026-07-29T10:00:00.000Z",
      through: "2026-07-29T11:00:00.000Z",
    });
    expect(result).toMatchObject({
      connection: {
        id: connectionId,
        mailbox: "jobs@example.com",
        name: "Work tenant",
      },
      messages: [
        {
          application: { id: application.id },
          messageId: "<message-1@example.com>",
          outcome: "linked",
          score: 115,
        },
      ],
      reconciliation: {
        assignedApplications: 1,
        detailsRead: 1,
        linked: 1,
        messagesRetrieved: 1,
      },
      verification: {
        connectionReread: true,
        cursorStored: true,
        linkedMessageIds: ["<message-1@example.com>"],
      },
      window: {
        previousReconciledAt: null,
        since: "2026-07-29T10:00:00.000Z",
        storedLastReconciledAt: "2026-07-29T11:00:00.000Z",
        through: "2026-07-29T11:00:00.000Z",
      },
    });
    expect(
      value.jobEmails.getApplicationEvidence(value.actor, application.id)
        .emailEvidence,
    ).toEqual([
      expect.objectContaining({
        evidenceType: "application_confirmation",
        messageId: "<message-1@example.com>",
      }),
    ]);
    expect(
      value.connectionRepository.find(value.actor.workspaceId, connectionId),
    ).toMatchObject({
      lastReconciledAt: "2026-07-29T11:00:00.000Z",
    });
  });

  it("does not link ambiguous evidence but still records a complete successful scan", async () => {
    const value = harness();
    const { statusId } = await createConnectionAndApplication(value);
    const connectionId = value.connections.getStatus(value.actor)
      .connections[0]!.id;
    value.applications.createApplication(value.actor, {
      companyName: "Example Company",
      outlookGraphConnectionId: connectionId,
      roleTitle: "Platform Engineer",
      statusId,
    });
    value.setNow("2026-07-29T11:00:00.000Z");

    const result = value.reconcile.commit(
      value.actor,
      await value.reconcile.prepare(value.actor, "Work tenant"),
    );

    expect(result.messages[0]).toMatchObject({
      outcome: "ambiguous",
      score: 115,
    });
    expect(result.reconciliation).toMatchObject({
      ambiguous: 1,
      linked: 0,
    });
    expect(
      value.database
        .prepare("SELECT count(*) FROM application_email_evidence")
        .pluck()
        .get(),
    ).toBe(0);
    expect(
      value.connectionRepository.find(value.actor.workspaceId, connectionId),
    ).toMatchObject({
      lastReconciledAt: "2026-07-29T11:00:00.000Z",
    });
  });

  it("commits a bounded batch and leaves a continuation signal when more than 50 messages are pending", async () => {
    const value = harness();
    const { connectionId } = await createConnectionAndApplication(value);
    value.setNow("2026-07-29T11:00:00.000Z");
    value.setMessages(
      Array.from({ length: 51 }, (_, index) =>
        message({
          body: { content: "Daily job recommendations", contentType: "text" },
          bodyPreview: "Daily job recommendations",
          from: { address: "alerts@example.com", name: "Job alerts" },
          id: `message-${index + 1}`,
          internetMessageId: `<message-${index + 1}@example.com>`,
          receivedAt: `2026-07-29T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
          subject: "Daily job alert",
        }),
      ),
    );
    value.setTruncated(true);

    const first = value.reconcile.commit(
      value.actor,
      await value.reconcile.prepare(value.actor, connectionId),
    );

    expect(first.reconciliation).toMatchObject({
      hasMore: true,
      messagesRetrieved: 50,
    });
    expect(first.window).toMatchObject({
      storedLastReconciledAt: "2026-07-29T10:50:00.000Z",
      through: "2026-07-29T10:50:00.000Z",
    });
    expect(
      value.connectionRepository.find(value.actor.workspaceId, connectionId),
    ).toMatchObject({ lastReconciledAt: "2026-07-29T10:50:00.000Z" });

    value.setTruncated(false);
    const second = value.reconcile.commit(
      value.actor,
      await value.reconcile.prepare(value.actor, connectionId),
    );

    expect(second.reconciliation).toMatchObject({
      hasMore: false,
      messagesRetrieved: 1,
    });
    expect(second.window).toMatchObject({
      previousReconciledAt: "2026-07-29T10:50:00.000Z",
      storedLastReconciledAt: "2026-07-29T11:00:00.000Z",
      through: "2026-07-29T11:00:00.000Z",
    });
  });

  it("keeps every message sharing the overflow timestamp for the next batch", async () => {
    const value = harness();
    const { connectionId } = await createConnectionAndApplication(value);
    value.setNow("2026-07-29T11:00:00.000Z");
    value.setMessages([
      ...Array.from({ length: 48 }, (_, index) =>
        message({
          id: `message-${index + 1}`,
          internetMessageId: `<message-${index + 1}@example.com>`,
          receivedAt: `2026-07-29T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        message({
          id: `boundary-message-${index + 1}`,
          internetMessageId: `<boundary-message-${index + 1}@example.com>`,
          receivedAt: "2026-07-29T10:49:00.000Z",
        }),
      ),
    ]);
    value.setTruncated(true);

    const first = value.reconcile.commit(
      value.actor,
      await value.reconcile.prepare(value.actor, connectionId),
    );

    expect(first.messages).toHaveLength(48);
    expect(first.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ receivedAt: "2026-07-29T10:49:00.000Z" }),
      ]),
    );
    expect(first.reconciliation.hasMore).toBe(true);
    expect(first.window.storedLastReconciledAt).toBe(
      "2026-07-29T10:48:00.000Z",
    );

    value.setTruncated(false);
    const second = value.reconcile.commit(
      value.actor,
      await value.reconcile.prepare(value.actor, connectionId),
    );

    expect(second.messages).toHaveLength(3);
    expect(
      second.messages.every(
        ({ receivedAt }) => receivedAt === "2026-07-29T10:49:00.000Z",
      ),
    ).toBe(true);
    expect(second.reconciliation.hasMore).toBe(false);
  });

  it("fails closed when no complete timestamp group fits in the bounded batch", async () => {
    const value = harness();
    const { connectionId } = await createConnectionAndApplication(value);
    value.setNow("2026-07-29T11:00:00.000Z");
    value.setMessages(
      Array.from({ length: 51 }, (_, index) =>
        message({
          id: `boundary-message-${index + 1}`,
          internetMessageId: `<boundary-message-${index + 1}@example.com>`,
          receivedAt: "2026-07-29T10:30:00.000Z",
        }),
      ),
    );
    value.setTruncated(true);

    await expect(
      value.reconcile.prepare(value.actor, connectionId),
    ).rejects.toMatchObject({ code: "outlook_reconcile_message_limit" });
    expect(
      value.connectionRepository.find(value.actor.workspaceId, connectionId),
    ).toMatchObject({ lastReconciledAt: null });
  });
});
