import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AuthService } from "../application/auth.js";
import {
  ApplicationMcpRuntimeStatusProvider,
  McpStatusService,
} from "../application/mcp_status.js";
import { McpAuditService } from "../application/mcp_audit.js";
import { RemoteMcpSessionRegistry } from "../application/mcp_sessions.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { SqliteMcpAuditRepository } from "../infrastructure/database/mcp_audit_repository.js";
import { SqliteUsersRepository } from "../infrastructure/database/users_repository.js";
import { UserAdministrationService } from "../application/users.js";
import { createApp } from "./app.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function sessionCookie(response: request.Response): string {
  const header: unknown = response.headers["set-cookie"];
  if (typeof header === "string") return header;
  if (Array.isArray(header) && typeof header[0] === "string") return header[0];
  throw new Error("Expected a session cookie");
}

async function createStatusApp() {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });
  const passwordHash = await hasher.hash("correct horse battery staple");
  const dummyPasswordHash = await hasher.hash("not a real account password");
  const created = new SqliteSetupRepository(
    database,
  ).createInitialAdministrator({
    completedAt: "2026-01-01T00:00:00.000Z",
    displayName: "Alex Example",
    passwordHash,
    username: "alex",
    workspaceName: "Applications",
  });
  const authService = new AuthService(
    new SqliteAuthRepository(database),
    hasher,
    new CryptoSessionTokenManager(),
    {
      absoluteDurationMs: 86_400_000,
      dummyPasswordHash,
      idleDurationMs: 1_800_000,
      refreshIntervalMs: 60_000,
    },
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
  const usersService = new UserAdministrationService(
    new SqliteUsersRepository(database),
    hasher,
  );
  const auditService = new McpAuditService(
    new SqliteMcpAuditRepository(database),
    () => new Date("2026-01-01T01:00:00.000Z"),
    () => "audit-event-1",
  );
  auditService.record({
    action: "get_tracker_context",
    actorUserId: created.administrator.id,
    result: "success",
    targetType: "workspace",
    transport: "local_stdio",
    workspaceId: created.workspace.id,
  });
  const mcpPolicy = {
    absoluteDurationMs: 14_400_000,
    globalLimit: 6,
    idleDurationMs: 900_000,
    perActorLimit: 2,
  };
  let sessionSequence = 0;
  const sessionRegistry = new RemoteMcpSessionRegistry(
    mcpPolicy,
    () => new Date("2026-01-01T02:00:00.000Z"),
    () => `remote-session-${String(++sessionSequence)}`,
  );
  const activeSession = await sessionRegistry.reserve({
    actorUserId: created.administrator.id,
    workspaceId: created.workspace.id,
  });
  await sessionRegistry.activate(activeSession.id, {
    close: () => undefined,
  });
  await sessionRegistry.reserve({
    actorUserId: created.administrator.id,
    workspaceId: created.workspace.id,
  });
  const mcpStatusService = new McpStatusService(
    mcpPolicy,
    new ApplicationMcpRuntimeStatusProvider(sessionRegistry),
    auditService,
  );
  const app = createApp({
    authCookie: { maxAgeSeconds: 86_400, secure: false },
    authService,
    mcpStatusService,
    usersService,
  });
  return { app };
}

async function login(
  app: ReturnType<typeof createApp>,
  username: string,
  password: string,
) {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ password, username });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

describe("MCP status route", () => {
  it("requires an authenticated administrator", async () => {
    const { app } = await createStatusApp();
    await request(app)
      .get("/api/settings/mcp")
      .expect(401, { error: { code: "authentication_required" } });

    const adminCookie = await login(
      app,
      "alex",
      "correct horse battery staple",
    );
    await request(app)
      .post("/api/settings/users")
      .set("Cookie", adminCookie)
      .set("Host", "tracker.example.test")
      .set("Origin", "https://tracker.example.test")
      .send({
        displayName: "Sam Member",
        password: "member password phrase",
        role: "member",
        username: "sam",
      })
      .expect(201);
    const memberCookie = await login(app, "sam", "member password phrase");

    await request(app)
      .get("/api/settings/mcp")
      .set("Cookie", memberCookie)
      .expect(403, { error: { code: "forbidden" } });
  });

  it("returns only the sanitized MCP status contract", async () => {
    const { app } = await createStatusApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const response = await request(app)
      .get("/api/settings/mcp")
      .set("Cookie", cookie)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    const body: unknown = response.body;
    expect(body).toEqual({
      status: {
        availability: "available",
        capabilities: {
          auditEvents: true,
          oauthVerification: false,
          registeredTools: 5,
        },
        recentAuditEvents: [
          {
            action: "get_tracker_context",
            actor: { displayName: "Alex Example", username: "alex" },
            occurredAt: "2026-01-01T01:00:00.000Z",
            result: "success",
            targetType: "workspace",
            transport: "local_stdio",
          },
        ],
        sessions: {
          absoluteLifetimeSeconds: 14_400,
          active: 1,
          enforcement: "active",
          globalLimit: 6,
          idleTimeoutSeconds: 900,
          initializing: 1,
          perActorLimit: 2,
        },
        transports: {
          local: { state: "ready", transport: "stdio" },
          remote: { state: "disabled", transport: "streamable_http" },
        },
      },
    });
    const serialized = JSON.stringify(body).toLowerCase();
    for (const privateField of [
      "database",
      "hostname",
      "issuer",
      "password",
      "subject",
      "token",
      "url",
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });
});
