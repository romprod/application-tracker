import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationNotFoundError } from "../application/applications.js";
import {
  LocalMcpActorUnavailableError,
  type LocalMcpTools,
  localMcpToolNames,
} from "../application/mcp.js";
import type { McpAuditRecorder } from "../application/mcp_audit.js";
import type { ApplicationLogger } from "./logging.js";
import { createLocalMcpServer } from "./mcp_server.js";

const clients: Client[] = [];
const servers: ReturnType<typeof createLocalMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

function fakeTools(): LocalMcpTools {
  return {
    getApplication: vi.fn(() => {
      throw new ApplicationNotFoundError();
    }),
    getJobSearchSummary: vi.fn(() => ({
      asOfDate: "2026-01-01",
      byStatus: [],
      dueTodayActions: 0,
      openActions: 0,
      openApplications: 0,
      overdueActions: 0,
      terminalApplications: 0,
      totalApplications: 0,
    })),
    getReferenceData: vi.fn(() => ({ values: [] })),
    getTrackerContext: vi.fn(() => ({
      access: "read_only" as const,
      actor: {
        displayName: "Alex Example",
        role: "admin" as const,
        username: "alex",
      },
      workspace: { name: "Applications", slug: "default" },
    })),
    listApplications: vi.fn(() => ({
      applications: [],
      returned: 0,
      total: 0,
    })),
  };
}

describe("local MCP server", () => {
  it("registers bounded read-only tools without actor selection arguments", async () => {
    const tools = fakeTools();
    const listApplications = vi.spyOn(tools, "listApplications");
    const record = vi.fn();
    const recorder: McpAuditRecorder = { record };
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder,
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual(localMcpToolNames);
    for (const tool of listed.tools) {
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      });
      expect(tool.inputSchema.properties).not.toHaveProperty("actor");
      expect(tool.inputSchema.properties).not.toHaveProperty("workspace");
      expect(tool.inputSchema.properties).not.toHaveProperty("username");
    }

    const context = await client.callTool({
      arguments: {},
      name: "get_tracker_context",
    });
    expect(context.isError).not.toBe(true);
    expect(context.structuredContent).toMatchObject({ access: "read_only" });

    const summary = await client.callTool({
      arguments: {},
      name: "get_job_search_summary",
    });
    expect(summary.isError).not.toBe(true);
    expect(summary.structuredContent).toMatchObject({ totalApplications: 0 });

    const applications = await client.callTool({
      arguments: {},
      name: "list_applications",
    });
    expect(applications.isError).not.toBe(true);
    expect(listApplications).toHaveBeenCalledWith({ limit: 50 });

    const referenceData = await client.callTool({
      arguments: {},
      name: "get_reference_data",
    });
    expect(referenceData.isError).not.toBe(true);
    expect(referenceData.structuredContent).toEqual({ values: [] });

    const missing = await client.callTool({
      arguments: {
        applicationId: "11111111-1111-4111-8111-111111111111",
      },
      name: "get_application",
    });
    expect(missing.isError).toBe(true);
    expect(missing.content).toEqual([
      {
        text: '{"error":{"code":"application_not_found"}}',
        type: "text",
      },
    ]);
    expect(record).toHaveBeenCalledTimes(5);
    expect(record).toHaveBeenNthCalledWith(1, {
      action: "get_tracker_context",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "workspace",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(5, {
      action: "get_application",
      actorUserId: "actor-user-1",
      result: "not_found",
      targetType: "application",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("audits revoked access as denied", async () => {
    const tools = fakeTools();
    tools.getTrackerContext = vi.fn(() => {
      throw new LocalMcpActorUnavailableError();
    });
    const record = vi.fn();
    const recorder: McpAuditRecorder = { record };
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder,
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {},
      name: "get_tracker_context",
    });

    expect(result.isError).toBe(true);
    expect(record).toHaveBeenCalledWith({
      action: "get_tracker_context",
      actorUserId: "actor-user-1",
      result: "denied",
      targetType: "workspace",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("fails closed when a required audit event cannot be stored", async () => {
    const tools = fakeTools();
    const errorLog = vi.fn<ApplicationLogger["error"]>();
    const logger: ApplicationLogger = { error: errorLog, info: vi.fn() };
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: {
          record: () => {
            throw new Error("synthetic database failure");
          },
        },
        workspaceId: "workspace-1",
      },
      logger,
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {},
      name: "get_tracker_context",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { text: '{"error":{"code":"internal_error"}}', type: "text" },
    ]);
    expect(errorLog).toHaveBeenCalledOnce();
    const [event, context] = errorLog.mock.calls[0] ?? [];
    expect(event).toBe("mcp_audit_failed");
    expect(context?.tool).toBe("get_tracker_context");
    expect(context?.error).toBeInstanceOf(Error);
  });
});
