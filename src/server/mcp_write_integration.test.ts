import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { ApplicationLedgerService } from "../application/applications.js";
import {
  ApplicationMcpService,
  LocalMcpActorProvider,
} from "../application/mcp.js";
import { McpAccessService } from "../application/mcp_access.js";
import { McpAuditService } from "../application/mcp_audit.js";
import { ReferenceValuesService } from "../application/reference_values.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteMcpAccessRepository } from "../infrastructure/database/mcp_access_repository.js";
import { SqliteMcpActorRepository } from "../infrastructure/database/mcp_actor_repository.js";
import { SqliteMcpAuditRepository } from "../infrastructure/database/mcp_audit_repository.js";
import { SqliteReferenceValuesRepository } from "../infrastructure/database/reference_values_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { createLocalMcpServer } from "./mcp_server.js";

const clients: Client[] = [];
const servers: ReturnType<typeof createLocalMcpServer>[] = [];
const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  for (const database of databases.splice(0)) database.close();
});

describe("MCP write integration", () => {
  it("applies access changes to an existing session and audits writes atomically", async () => {
    const database = openApplicationDatabase(":memory:");
    databases.push(database);
    const setup = new SqliteSetupRepository(
      database,
    ).createInitialAdministrator({
      completedAt: "2026-07-19T14:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    const actorProvider = new LocalMcpActorProvider(
      new SqliteMcpActorRepository(database),
      { username: "alex", workspaceSlug: "default" },
    );
    const actor = actorProvider.getActor();
    const access = new McpAccessService(
      new SqliteMcpAccessRepository(database),
      () => new Date("2026-07-19T15:00:00.000Z"),
    );
    const tools = new ApplicationMcpService(
      actorProvider,
      new ApplicationLedgerService(
        new SqliteApplicationsRepository(database),
        () => new Date("2026-07-19T16:00:00.000Z"),
      ),
      new ReferenceValuesService(new SqliteReferenceValuesRepository(database)),
      access,
    );
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: setup.administrator.id,
        recorder: new McpAuditService(
          new SqliteMcpAuditRepository(database),
          () => new Date("2026-07-19T16:01:00.000Z"),
        ),
        runAtomically: (operation) =>
          database.transaction(operation).immediate(),
        workspaceId: setup.workspace.id,
      },
    });
    const client = new Client({ name: "write-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    clients.push(client);
    servers.push(server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const statusId = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = 'status'
         ORDER BY sort_order LIMIT 1`,
      )
      .pluck()
      .get(setup.workspace.id) as string;

    const blocked = await client.callTool({
      arguments: {
        companyName: "Blocked Company",
        roleTitle: "Engineer",
        statusId,
      },
      name: "create_application",
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toEqual([
      {
        text: '{"error":{"code":"write_access_disabled"}}',
        type: "text",
      },
    ]);

    access.setAdministratorAccessMode(actor, "read_write");

    const created = await client.callTool({
      arguments: {
        companyName: "Example Company",
        roleTitle: "Engineer",
        statusId,
      },
      name: "create_application",
    });
    expect(created.isError).not.toBe(true);
    const applicationId = String(created.structuredContent?.id);

    const updated = await client.callTool({
      arguments: {
        applicationId,
        update: { companyName: "Updated Company", notes: "Follow up" },
      },
      name: "update_application",
    });
    expect(updated.structuredContent).toMatchObject({
      companyName: "Updated Company",
      notes: "Follow up",
    });

    const deleted = await client.callTool({
      arguments: { applicationId, confirm: true },
      name: "delete_application",
    });
    expect(deleted.structuredContent).toEqual({
      applicationId,
      deleted: true,
    });
    expect(
      database
        .prepare("SELECT count(*) FROM application_deletions")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      database
        .prepare(
          `SELECT action, result, transport FROM mcp_audit_events
           ORDER BY occurred_at, rowid`,
        )
        .all(),
    ).toEqual([
      {
        action: "create_application",
        result: "denied",
        transport: "local_stdio",
      },
      {
        action: "create_application",
        result: "success",
        transport: "local_stdio",
      },
      {
        action: "update_application",
        result: "success",
        transport: "local_stdio",
      },
      {
        action: "delete_application",
        result: "success",
        transport: "local_stdio",
      },
    ]);

    database.exec(`
      CREATE TRIGGER reject_mcp_audit_smoke
      BEFORE INSERT ON mcp_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'synthetic audit failure');
      END;
    `);
    const rolledBack = await client.callTool({
      arguments: {
        companyName: "Must Roll Back",
        roleTitle: "Engineer",
        statusId,
      },
      name: "create_application",
    });
    expect(rolledBack.isError).toBe(true);
    expect(rolledBack.content).toEqual([
      { text: '{"error":{"code":"internal_error"}}', type: "text" },
    ]);
    expect(
      database
        .prepare("SELECT count(*) FROM applications WHERE deleted_at IS NULL")
        .pluck()
        .get(),
    ).toBe(0);
  });
});
