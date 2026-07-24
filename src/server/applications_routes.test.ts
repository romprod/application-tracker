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
    database,
    references: {
      applied: referenceId("status", "Applied"),
      interview: referenceId("status", "Interview"),
      referral: referenceId("source", "Referral"),
      roleType: referenceId("role_type", "Full-time"),
    },
    setup,
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

function responseBody(response: request.Response): Record<string, unknown> {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) {
    throw new Error("Expected a response object");
  }
  return body as Record<string, unknown>;
}

function objectProperty(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an object`);
  }
  return value as Record<string, unknown>;
}

function objectArrayProperty(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
  ) {
    throw new Error(`Expected ${key} to be an object array`);
  }
  return value as Record<string, unknown>[];
}

function responseObject(
  response: request.Response,
  key: string,
): Record<string, unknown> {
  return objectProperty(responseBody(response), key);
}

function createdApplication(
  response: request.Response,
): Record<string, unknown> {
  return responseObject(response, "application");
}

function applicationInput(references: {
  applied: string;
  referral: string;
  roleType: string;
}) {
  return {
    agency: "Example Recruitment",
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
    rating: 4,
    roleTypeId: references.roleType,
    roleTitle: "Product Designer",
    salary: "£70,000–£80,000",
    sourceId: references.referral,
    sourceUrl: "https://jobs.example.com/product-designer",
    statusId: references.applied,
    workArrangement: "hybrid",
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
      .post("/api/applications/merge")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .send({
        mode: "preview",
        sourceApplicationId: "123e4567-e89b-12d3-a456-426614174000",
        targetApplicationId: "223e4567-e89b-42d3-a456-426614174000",
      })
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

  it("audits, previews, and applies an explicit application merge", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const input = applicationInput(references);
    const sourceResponse = await sameOrigin(
      request(app).post("/api/applications"),
    )
      .set("Cookie", cookie)
      .send({
        ...input,
        contacts: [
          {
            email: "source@example.com",
            name: "Source Contact",
            role: "Recruiter",
          },
        ],
      })
      .expect(201);
    const targetResponse = await sameOrigin(
      request(app).post("/api/applications"),
    )
      .set("Cookie", cookie)
      .send({
        ...input,
        contacts: [
          {
            email: "target@example.com",
            name: "Target Contact",
            role: "Hiring manager",
          },
        ],
      })
      .expect(201);
    const source = createdApplication(sourceResponse);
    const target = createdApplication(targetResponse);

    const audit = await request(app)
      .get("/api/applications/duplicates?limit=1&offset=0")
      .set("Cookie", cookie)
      .expect(200);
    const auditResult = responseObject(audit, "audit");
    expect(auditResult).toMatchObject({ returned: 1, total: 1 });
    const [auditCandidate] = objectArrayProperty(auditResult, "candidates");
    expect(auditCandidate).toMatchObject({ confidence: "definite" });
    expect(
      objectArrayProperty(auditCandidate ?? {}, "reasons").some(
        ({ kind }) => kind === "canonical_url",
      ),
    ).toBe(true);

    const preview = await sameOrigin(
      request(app).post("/api/applications/merge"),
    )
      .set("Cookie", cookie)
      .send({
        mode: "preview",
        sourceApplicationId: source.id,
        targetApplicationId: target.id,
      })
      .expect(200);
    const previewResult = responseObject(preview, "merge");
    expect(previewResult).toMatchObject({ applied: false });
    const previewDetails = objectProperty(previewResult, "preview");
    expect(previewDetails).toMatchObject({ safeToApply: true });
    const previewContacts = objectProperty(previewDetails, "contacts");
    expect(objectArrayProperty(previewContacts, "additions")[0]).toMatchObject({
      name: "Source Contact",
    });
    const beforeMerge = await request(app)
      .get("/api/applications")
      .set("Cookie", cookie)
      .expect(200);
    expect(
      objectArrayProperty(responseBody(beforeMerge), "applications"),
    ).toHaveLength(2);

    const applied = await sameOrigin(
      request(app).post("/api/applications/merge"),
    )
      .set("Cookie", cookie)
      .send({
        confirm: true,
        expectedSourceUpdatedAt: source.updatedAt,
        expectedTargetUpdatedAt: target.updatedAt,
        mode: "apply",
        resolutions: { fields: {} },
        sourceApplicationId: source.id,
        targetApplicationId: target.id,
      })
      .expect(200);
    const appliedResult = responseObject(applied, "merge");
    expect(appliedResult).toMatchObject({
      alreadyApplied: false,
      applied: true,
    });
    expect(objectProperty(appliedResult, "lineage")).toMatchObject({
      sourceApplicationId: source.id,
      targetApplicationId: target.id,
    });
    const appliedPreview = objectProperty(appliedResult, "preview");
    const survivor = objectProperty(appliedPreview, "survivor");
    expect(
      objectArrayProperty(survivor, "contacts")
        .map(({ name }) => name)
        .sort(),
    ).toEqual(["Source Contact", "Target Contact"]);
    const afterMerge = await request(app)
      .get("/api/applications")
      .set("Cookie", cookie)
      .expect(200);
    const remainingApplications = objectArrayProperty(
      responseBody(afterMerge),
      "applications",
    );
    expect(remainingApplications).toHaveLength(1);
    expect(remainingApplications[0]?.id).toBe(target.id);
    await request(app)
      .get(`/api/applications/${String(source.id)}/events`)
      .set("Cookie", cookie)
      .expect(200);
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
      agency: "Example Recruitment",
      companyName: "Example Studio",
      contacts: input.contacts,
      links: input.links,
      roleTitle: "Product Designer",
      nextAction: "Send the portfolio follow-up.",
      nextActionDue: "2026-07-21",
      rating: 4,
      roleType: "Full-time",
      salary: "£70,000–£80,000",
      source: "Referral",
      status: "Applied",
      workArrangement: "hybrid",
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
    const expectedUpdatedAt = application.updatedAt;
    if (
      typeof applicationId !== "string" ||
      typeof expectedUpdatedAt !== "string"
    ) {
      throw new Error("Expected an application ID and concurrency value");
    }

    const updated = await sameOrigin(
      request(app).patch(`/api/applications/${applicationId}`),
    )
      .set("Cookie", cookie)
      .send({
        agency: "Direct",
        contacts: [],
        expectedUpdatedAt,
        links: [],
        location: "",
        nextAction: "Prepare interview questions.",
        nextActionDue: "2026-07-20",
        notes: "Interview arranged.",
        rating: 5,
        salary: "£82,000",
        statusId: references.interview,
        workArrangement: "remote",
      })
      .expect(200);
    expect(createdApplication(updated)).toMatchObject({
      agency: "Direct",
      companyName: "Example Studio",
      contacts: [],
      rating: 5,
      salary: "£82,000",
      links: [],
      location: null,
      nextAction: "Prepare interview questions.",
      nextActionDue: "2026-07-20",
      notes: "Interview arranged.",
      status: "Interview",
      workArrangement: "remote",
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
      .send({
        expectedUpdatedAt: "2026-07-18T12:00:00.000Z",
        statusId: references.interview,
      })
      .expect(404, { error: { code: "application_not_found" } });
    await request(app)
      .get(`/api/applications/${missingId}/events`)
      .set("Cookie", cookie)
      .expect(404, { error: { code: "application_not_found" } });
  });

  it("returns the latest application when an update is stale", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(applicationInput(references))
      .expect(201);
    const application = createdApplication(created);
    const applicationId = application.id;
    const expectedUpdatedAt = application.updatedAt;
    if (
      typeof applicationId !== "string" ||
      typeof expectedUpdatedAt !== "string"
    ) {
      throw new Error("Expected an application ID and concurrency value");
    }

    const first = await sameOrigin(
      request(app).patch(`/api/applications/${applicationId}`),
    )
      .set("Cookie", cookie)
      .send({ companyName: "First editor wins", expectedUpdatedAt })
      .expect(200);
    const latest = createdApplication(first);
    expect(latest.updatedAt).not.toBe(expectedUpdatedAt);

    const stale = await sameOrigin(
      request(app).patch(`/api/applications/${applicationId}`),
    )
      .set("Cookie", cookie)
      .send({ companyName: "Stale overwrite", expectedUpdatedAt })
      .expect(409);
    expect(stale.body).toEqual({
      application: latest,
      error: { code: "application_conflict" },
    });

    await request(app)
      .get("/api/applications")
      .set("Cookie", cookie)
      .expect(200, { applications: [latest] });
  });

  it("rejects a reference value from the wrong application list", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(applicationInput(references))
      .expect(201);
    const applicationId = createdApplication(created).id;
    const expectedUpdatedAt = createdApplication(created).updatedAt;
    if (
      typeof applicationId !== "string" ||
      typeof expectedUpdatedAt !== "string"
    ) {
      throw new Error("Expected an application ID and concurrency value");
    }

    await sameOrigin(request(app).patch(`/api/applications/${applicationId}`))
      .set("Cookie", cookie)
      .send({ expectedUpdatedAt, statusId: references.referral })
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
    const expectedUpdatedAt = application.updatedAt;
    if (
      typeof applicationId !== "string" ||
      typeof expectedUpdatedAt !== "string"
    ) {
      throw new Error("Expected an application ID and concurrency value");
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
      .send({ companyName: "Hidden update", expectedUpdatedAt })
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
