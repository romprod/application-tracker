import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../application/auth.js";
import {
  applicationMcpToolNames,
  type McpApplicationTools,
} from "../application/mcp.js";
import type { NewMcpAuditEvent } from "../application/mcp_audit.js";
import { RemoteMcpSessionRegistry } from "../application/mcp_sessions.js";
import { createApp } from "./app.js";
import { RemoteMcpHttpEndpoint } from "./mcp_http_endpoint.js";
import { createApplicationMcpServer } from "./mcp_server.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};

const otherActor: AuthenticatedActor = {
  ...actor,
  user: { displayName: "Taylor", role: "member", username: "taylor" },
  userId: "user-2",
};

const network = {
  allowedHosts: ["tracker.example"],
  allowedOrigins: ["https://client.example"],
  resourceUrl: "https://tracker.example/mcp",
};

const protocolHeaders = {
  Accept: "application/json, text/event-stream",
  Authorization: "Bearer signed.jwt.value",
  Host: "tracker.example",
  "MCP-Protocol-Version": "2025-11-25",
};

const registries: RemoteMcpSessionRegistry[] = [];

interface JsonRpcResponse {
  error?: { code: number; message: string };
  result?: {
    protocolVersion?: string;
    structuredContent?: unknown;
    tools?: { name: string }[];
  };
}

function responseBody(response: request.Response): JsonRpcResponse {
  return response.body as JsonRpcResponse;
}

afterEach(async () => {
  await Promise.all(
    registries.splice(0).map((registry) => registry.closeAll()),
  );
});

function initializedEndpoint(
  policy = { globalLimit: 6, perActorLimit: 2 },
  sourceRateLimit = { requests: 600, windowMs: 60_000 },
) {
  const audit = vi.fn<(event: NewMcpAuditEvent) => void>();
  let accessMode: "read_only" | "read_write" = "read_only";
  const registry = new RemoteMcpSessionRegistry({
    absoluteDurationMs: 14_400_000,
    globalLimit: policy.globalLimit,
    idleDurationMs: 900_000,
    perActorLimit: policy.perActorLimit,
  });
  registries.push(registry);
  const endpoint = new RemoteMcpHttpEndpoint({
    authorizer: {
      authorize: (token) =>
        Promise.resolve({
          accessMode,
          actor: token === "other.jwt.value" ? otherActor : actor,
          principalId:
            token === "other.jwt.value"
              ? "oauth:test:taylor"
              : token === "same-actor.other-credential"
                ? "client:other"
                : "client:primary",
          workspaceSlug: "default",
        }),
    },
    createServer: (actorProvider, authenticatedActor, accessPolicy) => {
      const tools: McpApplicationTools = {
        appendDocumentChunk: () => {
          throw new Error("not used");
        },
        beginDocumentImport: () => {
          throw new Error("not used");
        },
        bulkUpdateApplications: () => {
          throw new Error("not used");
        },
        cancelDocumentImport: () => {
          throw new Error("not used");
        },
        completeDocumentImport: () => {
          throw new Error("not used");
        },
        createApplication: () => {
          throw new Error("not used");
        },
        deleteApplication: () => {
          throw new Error("not used");
        },
        extractJobLinks: () => ({ candidates: [] }),
        exportDocumentChunk: () => {
          throw new Error("not used");
        },
        getApplication: () => {
          throw new Error("not used");
        },
        getJobSearchSummary: () => ({
          asOfDate: "2026-07-19",
          byStatus: [],
          dueTodayActions: 0,
          openActions: 0,
          openApplications: 0,
          overdueActions: 0,
          terminalApplications: 0,
          totalApplications: 0,
        }),
        getDocumentImportCapabilities: () => ({
          maxDocumentBytes: 1024 * 1024,
          maxDocumentChunkBytes: 12 * 1024,
        }),
        getReferenceData: () => ({ values: [] }),
        getTrackerContext: () => ({
          access: accessPolicy.getAccessMode(
            actorProvider.getActor().workspaceId,
          ),
          actor: actorProvider.getActor().user,
          workspace: {
            name: actorProvider.getActor().workspace.name,
            slug: actorProvider.getWorkspaceSlug(),
          },
        }),
        listApplications: () => ({
          applications: [],
          nextOffset: null,
          offset: 0,
          returned: 0,
          total: 0,
        }),
        listDocuments: () => ({
          documents: [],
          nextOffset: null,
          offset: 0,
          returned: 0,
          total: 0,
        }),
        matchJobApplicationEmail: () => ({
          level: null,
          matches: [],
          outcome: "none",
        }),
        updateApplication: () => {
          throw new Error("not used");
        },
        upsertApplicationFromEmail: () => {
          throw new Error("not used");
        },
      };
      return createApplicationMcpServer(tools, {
        audit: {
          actorUserId: authenticatedActor.userId,
          recorder: { record: audit },
          runAtomically: (operation) => operation(),
          transport: "remote_http",
          workspaceId: authenticatedActor.workspaceId,
        },
        instructions: "Read-only remote test server.",
      });
    },
    network,
    oauth: { requiredScope: "tracker:read" },
    requestPolicy: {
      maxConcurrentRequests: 8,
      maxConcurrentRequestsPerActor: 4,
      maxRequestBytes: 65_536,
      rateLimitRequests: 60,
      rateLimitWindowMs: 60_000,
    },
    sessions: registry,
    sourceRateLimit,
  });
  return {
    app: createApp({ remoteMcpRouter: endpoint.router() }),
    audit,
    registry,
    setAccessMode: (next: "read_only" | "read_write") => {
      accessMode = next;
    },
  };
}

function initialize(
  app: ReturnType<typeof createApp>,
  token = "signed.jwt.value",
) {
  return request(app)
    .post("/mcp")
    .set({ ...protocolHeaders, Authorization: `Bearer ${token}` })
    .send({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "integration-test", version: "1.0.0" },
        protocolVersion: "2025-11-25",
      },
    });
}

describe("remote MCP HTTP endpoint", () => {
  it("rate limits repeated authorization attempts from one network source", async () => {
    const { app } = initializedEndpoint(
      { globalLimit: 6, perActorLimit: 2 },
      { requests: 2, windowMs: 60_000 },
    );

    await request(app).get("/mcp").set("Host", "tracker.example").expect(401);
    await request(app).get("/mcp").set("Host", "tracker.example").expect(401);
    const limited = await request(app)
      .get("/mcp")
      .set("Host", "tracker.example")
      .expect(429);

    expect(limited.headers.ratelimit).toBeDefined();
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(responseBody(limited).error).toEqual({
      code: -32_003,
      message: "Request limit reached",
    });
  });

  it("initializes, lists and calls tools, audits, and closes a bound session", async () => {
    const { app, audit, registry, setAccessMode } = initializedEndpoint();
    const initialization = await initialize(app);

    expect(initialization.status).toBe(200);
    expect(responseBody(initialization).result?.protocolVersion).toBe(
      "2025-11-25",
    );
    const sessionId = initialization.headers["mcp-session-id"] as string;
    expect(sessionId).toBeTruthy();
    expect(registry.sessionCounts("workspace-1")).toEqual({
      active: 1,
      initializing: 0,
    });

    await request(app)
      .post("/mcp")
      .set({ ...protocolHeaders, "MCP-Session-Id": sessionId })
      .send({ jsonrpc: "2.0", method: "notifications/initialized" })
      .expect(202);

    const listed = await request(app)
      .post("/mcp")
      .set({ ...protocolHeaders, "MCP-Session-Id": sessionId })
      .send({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} })
      .expect(200);
    expect(responseBody(listed).result?.tools?.map(({ name }) => name)).toEqual(
      applicationMcpToolNames,
    );

    const called = await request(app)
      .post("/mcp")
      .set({ ...protocolHeaders, "MCP-Session-Id": sessionId })
      .send({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "get_tracker_context" },
      })
      .expect(200);
    expect(responseBody(called).result?.structuredContent).toEqual({
      access: "read_only",
      actor: actor.user,
      workspace: { name: "Applications", slug: "default" },
    });
    expect(audit).toHaveBeenCalledWith({
      action: "get_tracker_context",
      actorUserId: "user-1",
      result: "success",
      targetType: "workspace",
      transport: "remote_http",
      workspaceId: "workspace-1",
    });

    setAccessMode("read_write");
    const changed = await request(app)
      .post("/mcp")
      .set({ ...protocolHeaders, "MCP-Session-Id": sessionId })
      .send({
        id: 4,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "get_tracker_context" },
      })
      .expect(200);
    expect(responseBody(changed).result?.structuredContent).toMatchObject({
      access: "read_write",
    });

    await request(app)
      .delete("/mcp")
      .set({ ...protocolHeaders, "MCP-Session-Id": sessionId })
      .expect(200);
    expect(registry.sessionCounts("workspace-1")).toEqual({
      active: 0,
      initializing: 0,
    });
  });

  it("does not disclose a session to a different authenticated actor", async () => {
    const { app } = initializedEndpoint();
    const initialization = await initialize(app);
    const sessionId = initialization.headers["mcp-session-id"] as string;

    const response = await request(app)
      .post("/mcp")
      .set({
        ...protocolHeaders,
        Authorization: "Bearer other.jwt.value",
        "MCP-Session-Id": sessionId,
      })
      .send({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} })
      .expect(404);

    expect(response.body).toEqual({
      error: { code: -32_001, message: "Session not found" },
      id: null,
      jsonrpc: "2.0",
    });
  });

  it("does not disclose a session to another credential for the same actor", async () => {
    const { app } = initializedEndpoint();
    const initialization = await initialize(app);
    const sessionId = initialization.headers["mcp-session-id"] as string;

    const response = await request(app)
      .post("/mcp")
      .set({
        ...protocolHeaders,
        Authorization: "Bearer same-actor.other-credential",
        "MCP-Session-Id": sessionId,
      })
      .send({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} })
      .expect(404);

    expect(response.body).toEqual({
      error: { code: -32_001, message: "Session not found" },
      id: null,
      jsonrpc: "2.0",
    });
  });

  it("requires initialization and enforces actor session admission", async () => {
    const { app } = initializedEndpoint({ globalLimit: 1, perActorLimit: 1 });
    await request(app)
      .post("/mcp")
      .set(protocolHeaders)
      .send({ id: 1, jsonrpc: "2.0", method: "tools/list", params: {} })
      .expect(400);

    await initialize(app).expect(200);
    const limited = await initialize(app).expect(429);
    expect(responseBody(limited).error).toEqual({
      code: -32_002,
      message: "Session limit reached",
    });
  });

  it("rejects malformed and oversized JSON before protocol handling", async () => {
    const { app } = initializedEndpoint();
    const malformed = await request(app)
      .post("/mcp")
      .set(protocolHeaders)
      .set("Content-Type", "application/json")
      .send('{"jsonrpc":"2.0"');
    expect(malformed.status).toBe(400);
    expect(responseBody(malformed).error).toEqual({
      code: -32_700,
      message: "Parse error",
    });

    const oversized = await request(app)
      .post("/mcp")
      .set(protocolHeaders)
      .send({ value: "x".repeat(70_000) });
    expect(oversized.status).toBe(413);
    expect(responseBody(oversized).error).toEqual({
      code: -32_004,
      message: "Request payload too large",
    });
  });

  it("rejects JSON lookalike media types instead of bypassing the body limit", async () => {
    const { app } = initializedEndpoint();
    const response = await request(app)
      .post("/mcp")
      .set(protocolHeaders)
      .set("Content-Type", "application/jsonp")
      .send(
        JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "initialize",
          padding: "x".repeat(70_000),
          params: {
            capabilities: {},
            clientInfo: { name: "integration-test", version: "1.0.0" },
            protocolVersion: "2025-11-25",
          },
        }),
      );

    expect(response.status).toBe(415);
    expect(responseBody(response).error).toEqual({
      code: -32_000,
      message: "Content-Type must be application/json",
    });
  });

  it("rejects JSON-RPC batches before any tool call or audit work", async () => {
    const { app, audit } = initializedEndpoint();
    const initialization = await initialize(app).expect(200);
    const sessionId = initialization.headers["mcp-session-id"] as string;
    await request(app)
      .post("/mcp")
      .set({ ...protocolHeaders, "MCP-Session-Id": sessionId })
      .send({ jsonrpc: "2.0", method: "notifications/initialized" })
      .expect(202);

    const response = await request(app)
      .post("/mcp")
      .set({ ...protocolHeaders, "MCP-Session-Id": sessionId })
      .send([
        {
          id: 10,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: {}, name: "get_tracker_context" },
        },
        {
          id: 11,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: {}, name: "get_tracker_context" },
        },
      ]);

    expect(response.status).toBe(400);
    expect(responseBody(response).error).toEqual({
      code: -32_600,
      message: "JSON-RPC batches are not supported",
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not expose the remote endpoint unless it is installed", async () => {
    await request(createApp()).post("/mcp").expect(404);
  });

  it("does not expose another route below the configured endpoint", async () => {
    const { app } = initializedEndpoint();
    const response = await request(app)
      .get("/mcp/internal")
      .set(protocolHeaders)
      .expect(404);
    expect(responseBody(response).error).toEqual({
      code: -32_001,
      message: "Endpoint not found",
    });
  });
});
