import { describe, expect, it } from "vitest";

import { openApplicationDatabase } from "./connection.js";
import { SqliteOutlookGraphConnectionsRepository } from "./outlook_graph_connections_repository.js";

function seedWorkspace(
  database: ReturnType<typeof openApplicationDatabase>,
  suffix: string,
) {
  const workspaceId = `workspace-${suffix}`;
  const userId = `user-${suffix}`;
  const now = "2026-07-28T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO workspaces (id, name, slug, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, `Workspace ${suffix}`, suffix, now);
  database
    .prepare(
      `INSERT INTO users
         (id, username, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .run(userId, `user-${suffix}`, `User ${suffix}`, now, now);
  database
    .prepare(
      `INSERT INTO workspace_memberships
         (workspace_id, user_id, role, created_at)
       VALUES (?, ?, 'admin', ?)`,
    )
    .run(workspaceId, userId, now);
  return { userId, workspaceId };
}

describe("SqliteOutlookGraphConnectionsRepository", () => {
  it("persists encrypted configuration and scopes every lifecycle operation to one workspace", () => {
    const database = openApplicationDatabase(":memory:");
    const alpha = seedWorkspace(database, "alpha");
    const beta = seedWorkspace(database, "beta");
    const repository = new SqliteOutlookGraphConnectionsRepository(database);
    const createdAt = "2026-07-28T11:00:00.000Z";
    const connectionId = "33333333-3333-4333-8333-333333333333";

    try {
      repository.save({
        clientId: "22222222-2222-4222-8222-222222222222",
        clientSecretEncrypted: "v1.encrypted-client-secret-material",
        createdAt,
        enabled: true,
        folderPath: "Inbox\\Jobs",
        id: connectionId,
        lastErrorCode: null,
        lastReconciledAt: null,
        lastTestedAt: createdAt,
        mailbox: "jobs@example.com",
        name: "Work tenant",
        tenantId: "11111111-1111-4111-8111-111111111111",
        updatedAt: createdAt,
        updatedByUserId: alpha.userId,
        verifiedAt: createdAt,
        workspaceId: alpha.workspaceId,
      });

      expect(repository.find(alpha.workspaceId, connectionId)).toEqual({
        assignedApplicationCount: 0,
        clientId: "22222222-2222-4222-8222-222222222222",
        clientSecretEncrypted: "v1.encrypted-client-secret-material",
        createdAt,
        enabled: true,
        folderPath: "Inbox\\Jobs",
        id: connectionId,
        lastErrorCode: null,
        lastReconciledAt: null,
        lastTestedAt: createdAt,
        mailbox: "jobs@example.com",
        name: "Work tenant",
        tenantId: "11111111-1111-4111-8111-111111111111",
        updatedAt: createdAt,
        verifiedAt: createdAt,
      });
      expect(repository.list(alpha.workspaceId)).toHaveLength(1);
      expect(
        repository.findByName(alpha.workspaceId, "work TENANT"),
      ).toMatchObject({ id: connectionId });
      expect(repository.find(beta.workspaceId, connectionId)).toBeUndefined();

      repository.recordVerification({
        connectionId,
        errorCode: "outlook_graph_throttled",
        testedAt: "2026-07-28T11:05:00.000Z",
        workspaceId: alpha.workspaceId,
      });
      expect(repository.find(alpha.workspaceId, connectionId)).toMatchObject({
        lastErrorCode: "outlook_graph_throttled",
        lastTestedAt: "2026-07-28T11:05:00.000Z",
        verifiedAt: createdAt,
      });
      expect(
        repository.recordReconciliation({
          connectionId,
          expectedLastReconciledAt: null,
          expectedUpdatedAt: createdAt,
          reconciledAt: "2026-07-28T11:06:00.000Z",
          workspaceId: alpha.workspaceId,
        }),
      ).toMatchObject({
        lastReconciledAt: "2026-07-28T11:06:00.000Z",
      });
      expect(
        repository.recordReconciliation({
          connectionId,
          expectedLastReconciledAt: null,
          expectedUpdatedAt: createdAt,
          reconciledAt: "2026-07-28T11:07:00.000Z",
          workspaceId: alpha.workspaceId,
        }),
      ).toBeUndefined();

      repository.setEnabled({
        connectionId,
        enabled: false,
        updatedAt: "2026-07-28T11:10:00.000Z",
        updatedByUserId: alpha.userId,
        workspaceId: alpha.workspaceId,
      });
      expect(repository.find(alpha.workspaceId, connectionId)?.enabled).toBe(
        false,
      );
      expect(repository.delete(beta.workspaceId, connectionId)).toBe(false);
      expect(repository.find(alpha.workspaceId, connectionId)).toBeDefined();
      expect(repository.delete(alpha.workspaceId, connectionId)).toBe(true);
      expect(repository.find(alpha.workspaceId, connectionId)).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
