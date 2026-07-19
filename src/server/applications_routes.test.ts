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
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
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
      maxConcurrentVerifications: 2,
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
  function referenceId(category: string, label: string): string {
    const id = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = ? AND label = ?`,
      )
      .pluck()
      .get(setup.workspace.id, category, label);
    if (typeof id !== "string") throw new Error("Missing test reference value");
    return id;
  }
  return {
    app,
    references: {
      applied: referenceId("status", "Applied"),
      interview: referenceId("status", "Interview"),
      referral: referenceId("source", "Referral"),
      roleType: referenceId("role_type", "Full-time"),
    },
  };
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

function applicationInput(references: {
  applied: string;
  referral: string;
  roleType: string;
}) {
  return {
    appliedOn: "2026-07-18",
    companyName: "Example Studio",
    contacts: [
      {
        email: "morgan@example.com",
        name: "Morgan Recruiter",
        phone: "+44 20 7946 0958",
        role: "Recruiter",
      },
    ],
    links: [
      {
        label: "Hiring portal",
        url: "https://careers.example.com/application",
      },
    ],
    location: "Remote",
    nextAction: "Send the portfolio follow-up.",
    nextActionDue: "2026-07-21",
    notes: "Referred by a former colleague.",
    roleTypeId: references.roleType,
    roleTitle: "Product Designer",
    sourceId: references.referral,
    sourceUrl: "https://jobs.example.com/product-designer",
    statusId: references.applied,
  };
}

describe("application ledger routes", () => {
  it("requires authentication and a matching origin for mutation", async () => {
    const { app, references } = await createApplicationsApp();
    const input = applicationInput(references);

    await request(app)
      .get("/api/applications")
      .expect(401, { error: { code: "authentication_required" } });

    const cookie = await login(app, "alex", "correct horse battery staple");
    await request(app)
      .post("/api/applications")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .send(input)
      .expect(403, { error: { code: "csrf_rejected" } });
    await request(app)
      .patch("/api/applications/123e4567-e89b-12d3-a456-426614174000")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .send({ statusId: references.interview })
      .expect(403, { error: { code: "csrf_rejected" } });
    await request(app)
      .delete("/api/applications/123e4567-e89b-12d3-a456-426614174000")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .expect(403, { error: { code: "csrf_rejected" } });
    await request(app)
      .get("/api/applications/123e4567-e89b-12d3-a456-426614174000/events")
      .expect(401, { error: { code: "authentication_required" } });
    await request(app)
      .post("/api/applications")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .set("Origin", "https://other.example.test")
      .send(input)
      .expect(403, { error: { code: "csrf_rejected" } });
  });

  it("lets a member create and list sanitized workspace applications", async () => {
    const { app, references } = await createApplicationsApp();
    const input = applicationInput(references);
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
      .send(input)
      .expect(201);
    const application = createdApplication(created);
    expect(application).toMatchObject({
      companyName: "Example Studio",
      contacts: input.contacts,
      links: input.links,
      roleTitle: "Product Designer",
      nextAction: "Send the portfolio follow-up.",
      nextActionDue: "2026-07-21",
      roleType: "Full-time",
      source: "Referral",
      status: "Applied",
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
    const { app, references } = await createApplicationsApp();
    const input = applicationInput(references);
    const cookie = await login(app, "alex", "correct horse battery staple");

    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({
        ...input,
        links: [{ label: "Unsafe", url: "javascript:alert(1)" }],
      })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({
        ...input,
        contacts: [{ email: "not-an-email", name: "Morgan Recruiter" }],
      })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({
        ...input,
        sourceUrl: "javascript:alert(1)",
      })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({ ...input, workspaceId: "another-workspace" })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({ ...input, notes: "x".repeat(5001) })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({ ...input, nextActionDue: "21/07/2026" })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({ ...input, nextAction: "x".repeat(501) })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({
        ...input,
        statusId: "123e4567-e89b-12d3-a456-426614174000",
      })
      .expect(400, { error: { code: "invalid_application_reference" } });
    await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({ ...input, sourceId: references.roleType })
      .expect(400, { error: { code: "invalid_application_reference" } });
  });

  it("edits an application and returns its immutable stage history", async () => {
    const { app, references } = await createApplicationsApp();
    const input = applicationInput(references);
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(input)
      .expect(201);
    const application = createdApplication(created);
    const applicationId = application.id;
    if (typeof applicationId !== "string") {
      throw new Error("Expected an application ID");
    }

    const updated = await sameOrigin(
      request(app).patch(`/api/applications/${applicationId}`),
    )
      .set("Cookie", cookie)
      .send({
        contacts: [],
        links: [],
        location: "",
        nextAction: "Prepare interview questions.",
        nextActionDue: "2026-07-20",
        notes: "Interview arranged.",
        statusId: references.interview,
      })
      .expect(200);
    expect(createdApplication(updated)).toMatchObject({
      companyName: "Example Studio",
      contacts: [],
      links: [],
      location: null,
      nextAction: "Prepare interview questions.",
      nextActionDue: "2026-07-20",
      notes: "Interview arranged.",
      status: "Interview",
    });

    const history = await request(app)
      .get(`/api/applications/${applicationId}/events`)
      .set("Cookie", cookie)
      .expect(200);
    expect(history.headers["cache-control"]).toBe("no-store");
    expect(history.body).toEqual({
      events: [
        expect.objectContaining({
          actorDisplayName: "Alex Example",
          fromStatus: "Applied",
          toStatus: "Interview",
          type: "status_changed",
        }),
        expect.objectContaining({
          actorDisplayName: "Alex Example",
          fromStatus: null,
          toStatus: "Applied",
          type: "application_created",
        }),
      ],
    });
    expect(JSON.stringify(history.body)).not.toMatch(
      /actorUserId|workspaceId|password|token/i,
    );
  });

  it("validates update paths and hides missing applications", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const missingId = "123e4567-e89b-12d3-a456-426614174000";

    await sameOrigin(request(app).patch("/api/applications/not-a-uuid"))
      .set("Cookie", cookie)
      .send({ statusId: references.interview })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).patch(`/api/applications/${missingId}`))
      .set("Cookie", cookie)
      .send({})
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).patch(`/api/applications/${missingId}`))
      .set("Cookie", cookie)
      .send({ sourceUrl: "javascript:alert(1)" })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).patch(`/api/applications/${missingId}`))
      .set("Cookie", cookie)
      .send({ statusId: references.interview })
      .expect(404, { error: { code: "application_not_found" } });
    await request(app)
      .get(`/api/applications/${missingId}/events`)
      .set("Cookie", cookie)
      .expect(404, { error: { code: "application_not_found" } });
  });

  it("rejects a reference value from the wrong application list", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(applicationInput(references))
      .expect(201);
    const applicationId = createdApplication(created).id;
    if (typeof applicationId !== "string") {
      throw new Error("Expected an application ID");
    }

    await sameOrigin(request(app).patch(`/api/applications/${applicationId}`))
      .set("Cookie", cookie)
      .send({ statusId: references.referral })
      .expect(400, { error: { code: "invalid_application_reference" } });
  });

  it("removes an application from normal APIs while retaining its audit trail", async () => {
    const { app, references } = await createApplicationsApp();
    const input = applicationInput(references);
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(input)
      .expect(201);
    const application = createdApplication(created);
    const applicationId = application.id;
    if (typeof applicationId !== "string") {
      throw new Error("Expected an application ID");
    }

    await sameOrigin(request(app).delete(`/api/applications/${applicationId}`))
      .set("Cookie", cookie)
      .expect(204);
    await request(app)
      .get("/api/applications")
      .set("Cookie", cookie)
      .expect(200, { applications: [] });
    await request(app)
      .get(`/api/applications/${applicationId}/events`)
      .set("Cookie", cookie)
      .expect(404, { error: { code: "application_not_found" } });
    await sameOrigin(request(app).patch(`/api/applications/${applicationId}`))
      .set("Cookie", cookie)
      .send({ companyName: "Hidden update" })
      .expect(404, { error: { code: "application_not_found" } });
    await sameOrigin(request(app).delete(`/api/applications/${applicationId}`))
      .set("Cookie", cookie)
      .expect(404, { error: { code: "application_not_found" } });
  });

  it("validates deletion paths and requires authentication", async () => {
    const { app } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");

    await sameOrigin(request(app).delete("/api/applications/not-a-uuid"))
      .set("Cookie", cookie)
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(
      request(app).delete(
        "/api/applications/123e4567-e89b-12d3-a456-426614174000",
      ),
    ).expect(401, { error: { code: "authentication_required" } });
  });
});
