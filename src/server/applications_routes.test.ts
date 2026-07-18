import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { ApplicationLedgerService } from "../application/applications.js";
import { AuthService } from "../application/auth.js";
import { UserAdministrationService } from "../application/users.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { SqliteUsersRepository } from "../infrastructure/database/users_repository.js";
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

async function createApplicationsApp() {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });
  const passwordHash = await hasher.hash("correct horse battery staple");
  const dummyPasswordHash = await hasher.hash("not a real account password");
  new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-18T11:00:00.000Z",
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
    () => new Date("2026-07-18T12:00:00.000Z"),
  );
  const applicationsService = new ApplicationLedgerService(
    new SqliteApplicationsRepository(database),
    () => new Date("2026-07-18T12:15:00.000Z"),
  );
  const usersService = new UserAdministrationService(
    new SqliteUsersRepository(database),
    hasher,
    () => new Date("2026-07-18T12:05:00.000Z"),
  );
  const app = createApp({
    applicationsService,
    authCookie: { maxAgeSeconds: 86_400, secure: false },
    authService,
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

function sameOrigin(test: request.Test): request.Test {
  return test
    .set("Host", "tracker.example.test")
    .set("Origin", "https://tracker.example.test");
}

function createdApplication(
  response: request.Response,
): Record<string, unknown> {
  const body: unknown = response.body;
  if (
    typeof body !== "object" ||
    body === null ||
    !("application" in body) ||
    typeof body.application !== "object" ||
    body.application === null
  ) {
    throw new Error("Expected an application response");
  }
  return body.application as Record<string, unknown>;
}

const applicationInput = {
  appliedOn: "2026-07-18",
  companyName: "Example Studio",
  location: "Remote",
  notes: "Referred by a former colleague.",
  roleTitle: "Product Designer",
  sourceUrl: "https://jobs.example.com/product-designer",
  status: "applied",
};

describe("application ledger routes", () => {
  it("requires authentication and a matching origin for mutation", async () => {
    const { app } = await createApplicationsApp();

    await request(app)
      .get("/api/applications")
      .expect(401, { error: { code: "authentication_required" } });

    const cookie = await login(app, "alex", "correct horse battery staple");
    await request(app)
      .post("/api/applications")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .send(applicationInput)
      .expect(403, { error: { code: "csrf_rejected" } });
    await request(app)
      .post("/api/applications")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .set("Origin", "https://other.example.test")
      .send(applicationInput)
      .expect(403, { error: { code: "csrf_rejected" } });
  });

  it("lets a member create and list sanitized workspace applications", async () => {
    const { app } = await createApplicationsApp();
    const adminCookie = await login(
      app,
      "alex",
      "correct horse battery staple",
    );
    await sameOrigin(request(app).post("/api/settings/users"))
      .set("Cookie", adminCookie)
      .send({
        displayName: "Sam Member",
        password: "member password phrase",
        role: "member",
        username: "sam",
      })
      .expect(201);
    const memberCookie = await login(app, "sam", "member password phrase");

    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", memberCookie)
      .send(applicationInput)
      .expect(201);
    const application = createdApplication(created);
    expect(application).toMatchObject({
      companyName: "Example Studio",
      roleTitle: "Product Designer",
      status: "applied",
    });
    expect(JSON.stringify(application)).not.toMatch(
      /createdBy|workspaceId|password|token/i,
    );

    const listed = await request(app)
      .get("/api/applications")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    const listedBody: unknown = listed.body;
    expect(listedBody).toEqual({ applications: [application] });
  });

  it("rejects unsafe links, unknown fields, and oversized bodies", async () => {
    const { app } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");

    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({
        ...applicationInput,
        sourceUrl: "javascript:alert(1)",
      })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({ ...applicationInput, workspaceId: "another-workspace" })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({ ...applicationInput, notes: "x".repeat(5001) })
      .expect(400, { error: { code: "validation_error" } });
  });
});
