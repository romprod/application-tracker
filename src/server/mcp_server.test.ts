import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationNotFoundError } from "../application/applications.js";
import {
  applicationMcpPublishedSchema,
  applicationMcpSchemaManifest,
  applicationMcpToolNames,
  LocalMcpActorUnavailableError,
  type McpApplicationTools,
} from "../application/mcp.js";
import { McpWriteAccessDisabledError } from "../application/mcp_access.js";
import type { McpAuditRecorder } from "../application/mcp_audit.js";
import type { ApplicationLogger } from "./logging.js";
import { createLocalMcpServer } from "./mcp_server.js";

const clients: Client[] = [];
const servers: ReturnType<typeof createLocalMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

function fakeTools(): McpApplicationTools {
  return {
    appendDocumentChunk: vi.fn(),
    beginDocumentImport: vi.fn(),
    bulkUpdateApplications: vi.fn(),
    cancelDocumentImport: vi.fn(),
    completeDocumentImport: vi.fn(),
    createApplication: vi.fn(),
    deleteApplication: vi.fn(),
    extractJobLinks: vi.fn(() => ({
      candidates: [
        {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin" as const,
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      ],
    })),
    exportDocumentChunk: vi.fn(),
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
    getDocumentImportCapabilities: vi.fn(() => ({
      maxDocumentBytes: 1024 * 1024,
      maxDocumentChunkBytes: 12 * 1024,
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
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    listDocuments: vi.fn(() => ({
      documents: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    matchJobApplicationEmail: vi.fn(() => ({
      level: null,
      matches: [],
      outcome: "none" as const,
    })),
    updateApplication: vi.fn(),
    upsertApplicationFromEmail: vi.fn(),
  };
}

describe("local MCP server", () => {
  it("registers bounded read and write tools without actor selection arguments", async () => {
    const tools = fakeTools();
    const bulkUpdateApplications = vi.fn();
    tools.bulkUpdateApplications = bulkUpdateApplications;
    const listApplications = vi.spyOn(tools, "listApplications");
    const record = vi.fn();
    const recorder: McpAuditRecorder = { record };
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder,
        runAtomically: (operation) => operation(),
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
    expect(listed.tools.map(({ name }) => name)).toEqual(
      applicationMcpToolNames,
    );
    for (const tool of listed.tools.slice(0, 11)) {
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      });
    }
    for (const tool of listed.tools.slice(11, 15)) {
      expect(tool.annotations).toMatchObject({
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      });
    }
    for (const tool of listed.tools.slice(15)) {
      expect(tool.annotations).toMatchObject({
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      });
    }
    expect(
      listed.tools.find(({ name }) => name === "delete_application")
        ?.annotations,
    ).toMatchObject({ destructiveHint: true });
    for (const tool of listed.tools) {
      expect(tool.inputSchema.properties).not.toHaveProperty("actor");
      expect(tool.inputSchema.properties).not.toHaveProperty("workspace");
      expect(tool.inputSchema.properties).not.toHaveProperty("username");
    }
    const duplicateApplicationId = "11111111-1111-4111-8111-111111111111";
    const duplicateBulkUpdate = await client.callTool({
      arguments: {
        updates: [
          {
            applicationId: duplicateApplicationId,
            update: {
              expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
              notes: "First update",
            },
          },
          {
            applicationId: duplicateApplicationId,
            update: {
              expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
              notes: "Duplicate update",
            },
          },
        ],
      },
      name: "bulk_update_applications",
    });
    expect(duplicateBulkUpdate.isError).toBe(true);
    expect(bulkUpdateApplications).not.toHaveBeenCalled();

    const context = await client.callTool({
      arguments: {},
      name: "get_tracker_context",
    });
    expect(context.isError).not.toBe(true);
    expect(context.structuredContent).toMatchObject({ access: "read_only" });

    const schemaStatus = await client.callTool({
      arguments: {},
      name: "get_connector_schema_status",
    });
    expect(schemaStatus.isError).not.toBe(true);
    expect(schemaStatus.structuredContent).toEqual({
      documentationUrl:
        "https://developers.openai.com/apps-sdk/deploy/submission#how-published-app-metadata-versions-work",
      live: applicationMcpSchemaManifest,
      publication: {
        ...applicationMcpPublishedSchema,
        status: "refresh_required",
      },
      refreshMethod: "scan_submit_publish",
      selfRefreshSupported: false,
    });

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
    expect(listApplications).toHaveBeenCalledWith({ limit: 50, offset: 0 });

    const referenceData = await client.callTool({
      arguments: {},
      name: "get_reference_data",
    });
    expect(referenceData.isError).not.toBe(true);
    expect(referenceData.structuredContent).toEqual({ values: [] });

    const extracted = await client.callTool({
      arguments: {
        content:
          "Apply at https://www.linkedin.com/jobs/view/4405273020?trackingId=email",
      },
      name: "extract_job_links",
    });
    expect(extracted.isError).not.toBe(true);
    expect(extracted.structuredContent).toEqual({
      candidates: [
        {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin",
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      ],
    });

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
    expect(record).toHaveBeenCalledTimes(7);
    expect(record).toHaveBeenNthCalledWith(1, {
      action: "get_tracker_context",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "workspace",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(2, {
      action: "get_connector_schema_status",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "workspace",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(6, {
      action: "extract_job_links",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(7, {
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
        runAtomically: (operation) => operation(),
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
        runAtomically: (operation) => operation(),
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

  it("blocks writes while read-only and audits the denied attempt", async () => {
    const tools = fakeTools();
    tools.createApplication = vi.fn(() => {
      throw new McpWriteAccessDisabledError();
    });
    const record = vi.fn();
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically: (operation) => operation(),
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
      arguments: {
        companyName: "Example Company",
        roleTitle: "Engineer",
        statusId: "11111111-1111-4111-8111-111111111111",
      },
      name: "create_application",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        text: '{"error":{"code":"write_access_disabled"}}',
        type: "text",
      },
    ]);
    expect(record).toHaveBeenCalledWith({
      action: "create_application",
      actorUserId: "actor-user-1",
      result: "denied",
      targetType: "application",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });
});
