import { describe, expect, it, vi } from "vitest";

import { AesGcmOutlookGraphSecretCipher } from "../infrastructure/auth/outlook_graph_secret_cipher.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { SqliteOutlookGraphConnectionsRepository } from "../infrastructure/database/outlook_graph_connections_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { ApplicationLedgerService } from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import {
  OutlookGraphClientSecretRequiredError,
  OutlookGraphConnectionForbiddenError,
  OutlookGraphConnectionImpactChangedError,
  OutlookGraphConnectionNameConflictError,
  OutlookGraphConnectionNotFoundError,
  OutlookGraphConnectionsService,
  type OutlookGraphConnectionAdapter,
} from "./outlook_graph_connections.js";
import {
  OutlookEmailSyncOperationalError,
  type OutlookMailReader,
} from "./outlook_email_sync.js";

const input = {
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "private-client-secret",
  folderPath: "Inbox\\Jobs",
  mailbox: "jobs@example.com",
  name: "Work tenant",
  tenantId: "11111111-1111-4111-8111-111111111111",
};

function harness() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-28T09:00:00.000Z",
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
  const reader: OutlookMailReader = {
    getMessages: () => Promise.resolve([]),
    searchMessages: () => Promise.resolve({ messages: [], queriesRun: 0 }),
    validateEvidence: () => Promise.resolve([]),
  };
  const createReader = vi.fn(() => reader);
  const verifyConnection = vi.fn(() => Promise.resolve());
  const adapter: OutlookGraphConnectionAdapter = {
    createReader,
    verify: verifyConnection,
  };
  const repository = new SqliteOutlookGraphConnectionsRepository(database);
  const service = new OutlookGraphConnectionsService(
    repository,
    new AesGcmOutlookGraphSecretCipher(Buffer.alloc(32, 9)),
    adapter,
    () => new Date("2026-07-28T10:00:00.000Z"),
  );
  const applications = new ApplicationLedgerService(
    new SqliteApplicationsRepository(database),
    () => new Date("2026-07-28T10:01:00.000Z"),
  );
  return {
    actor,
    applications,
    createReader,
    database,
    reader,
    repository,
    service,
    verifyConnection,
  };
}

function statusId(
  database: ReturnType<typeof openApplicationDatabase>,
  workspaceId: string,
): string {
  return database
    .prepare(
      `SELECT id FROM reference_values
       WHERE workspace_id = ? AND category = 'status' AND is_active = 1
       ORDER BY sort_order LIMIT 1`,
    )
    .pluck()
    .get(workspaceId) as string;
}

describe("OutlookGraphConnectionsService", () => {
  it("creates multiple named connections, encrypts secrets, and never returns them", async () => {
    const { actor, database, repository, service, verifyConnection } =
      harness();
    try {
      let status = await service.create(actor, input);
      status = await service.create(actor, {
        ...input,
        clientId: "44444444-4444-4444-8444-444444444444",
        mailbox: "consulting@example.com",
        name: "Consulting tenant",
      });

      expect(verifyConnection).toHaveBeenCalledWith({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        folderPath: ["Inbox", "Jobs"],
        mailbox: input.mailbox,
        tenantId: input.tenantId,
      });
      expect(status.connections).toHaveLength(2);
      expect(status.connections.map(({ name }) => name)).toEqual([
        "Consulting tenant",
        "Work tenant",
      ]);
      expect(JSON.stringify(status)).not.toContain(input.clientSecret);
      const stored = repository.list(actor.workspaceId);
      expect(stored[0]?.clientSecretEncrypted).not.toContain(
        input.clientSecret,
      );
      expect(stored[0]?.clientSecretEncrypted).toMatch(/^v2\./);
      await expect(
        service.create(actor, { ...input, mailbox: "other@example.com" }),
      ).rejects.toBeInstanceOf(OutlookGraphConnectionNameConflictError);
    } finally {
      database.close();
    }
  });

  it("reuses a saved secret only for the same tenant and application", async () => {
    const { actor, database, service, verifyConnection } = harness();
    try {
      const created = await service.create(actor, input);
      const connectionId = created.connections[0]?.id;
      expect(connectionId).toBeDefined();
      await service.update(actor, connectionId!, {
        ...input,
        clientSecret: undefined,
        folderPath: "Inbox\\Recruiting",
      });
      expect(verifyConnection).toHaveBeenLastCalledWith(
        expect.objectContaining({
          clientSecret: input.clientSecret,
          folderPath: ["Inbox", "Recruiting"],
        }),
      );
      await expect(
        service.update(actor, connectionId!, {
          ...input,
          clientId: "33333333-3333-4333-8333-333333333333",
          clientSecret: undefined,
        }),
      ).rejects.toBeInstanceOf(OutlookGraphClientSecretRequiredError);
    } finally {
      database.close();
    }
  });

  it("preserves a working configuration when replacement verification fails", async () => {
    const { actor, database, repository, service, verifyConnection } =
      harness();
    try {
      const created = await service.create(actor, input);
      const connectionId = created.connections[0]!.id;
      verifyConnection.mockRejectedValueOnce(
        new OutlookEmailSyncOperationalError(
          "outlook_graph_authentication_failed",
        ),
      );

      await expect(
        service.update(actor, connectionId, {
          ...input,
          clientSecret: "invalid-replacement-secret",
          mailbox: "replacement@example.com",
        }),
      ).rejects.toMatchObject({
        code: "outlook_graph_authentication_failed",
      });
      expect(repository.find(actor.workspaceId, connectionId)).toMatchObject({
        mailbox: input.mailbox,
      });
    } finally {
      database.close();
    }
  });

  it("selects only the assigned connection, pauses it, and preserves applications on hard delete", async () => {
    const {
      actor,
      applications,
      database,
      reader,
      repository,
      service,
      verifyConnection,
    } = harness();
    try {
      const created = await service.create(actor, input);
      const connectionId = created.connections[0]!.id;
      const application = applications.createApplication(actor, {
        companyName: "Example Studio",
        outlookGraphConnectionId: connectionId,
        roleTitle: "Product Designer",
        statusId: statusId(database, actor.workspaceId),
      });
      expect(service.forApplication(actor.workspaceId, application.id)).toBe(
        reader,
      );
      expect(service.getStatus(actor).connections[0]).toMatchObject({
        assignedApplicationCount: 1,
      });

      verifyConnection.mockClear();
      await service.setEnabled(actor, connectionId, false);
      expect(verifyConnection).not.toHaveBeenCalled();
      expect(() =>
        service.forApplication(actor.workspaceId, application.id),
      ).toThrow(
        expect.objectContaining({ code: "outlook_email_sync_unavailable" }),
      );

      await expect(
        service.setEnabled(actor, connectionId, true),
      ).resolves.toBeDefined();
      expect(() => service.delete(actor, connectionId, 0)).toThrow(
        OutlookGraphConnectionImpactChangedError,
      );
      expect(service.delete(actor, connectionId, 1).connections).toEqual([]);
      expect(repository.find(actor.workspaceId, connectionId)).toBeUndefined();
      expect(
        applications
          .listApplications(actor)
          .find(({ id }) => id === application.id),
      ).toMatchObject({
        outlookGraphConnectionId: null,
        outlookGraphConnectionName: null,
      });
      expect(() =>
        service.forApplication(actor.workspaceId, application.id),
      ).toThrow(
        expect.objectContaining({
          code: "outlook_graph_connection_unassigned",
        }),
      );
      expect(() => service.delete(actor, connectionId, 0)).toThrow(
        OutlookGraphConnectionNotFoundError,
      );
    } finally {
      database.close();
    }
  });

  it("records stable Graph failures and exposes only safe options to members", async () => {
    const { actor, database, repository, service, verifyConnection } =
      harness();
    try {
      const created = await service.create(actor, input);
      const connectionId = created.connections[0]!.id;
      verifyConnection.mockRejectedValueOnce(
        new OutlookEmailSyncOperationalError("outlook_graph_throttled"),
      );
      await expect(service.verify(actor, connectionId)).rejects.toMatchObject({
        code: "outlook_graph_throttled",
      });
      expect(repository.find(actor.workspaceId, connectionId)).toMatchObject({
        lastErrorCode: "outlook_graph_throttled",
      });

      const member = {
        ...actor,
        user: { ...actor.user, role: "member" as const },
      };
      expect(service.listOptions(member)).toEqual([
        {
          enabled: true,
          id: connectionId,
          mailbox: input.mailbox,
          name: input.name,
        },
      ]);
      expect(() => service.getStatus(member)).toThrow(
        OutlookGraphConnectionForbiddenError,
      );
      await expect(
        service.setEnabled(member, connectionId, false),
      ).rejects.toBeInstanceOf(OutlookGraphConnectionForbiddenError);
    } finally {
      database.close();
    }
  });
});
