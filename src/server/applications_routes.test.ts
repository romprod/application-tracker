import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { ApplicationLedgerService } from "../application/applications.js";
import { AuthService } from "../application/auth.js";
import { JobEmailReconciliationService } from "../application/job_email_reconciliation.js";
import { UserAdministrationService } from "../application/users.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteJobEmailReconciliationRepository } from "../infrastructure/database/job_email_reconciliation_repository.js";
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
  const jobEmailRepository = new SqliteJobEmailReconciliationRepository(
    database,
  );
  const jobEmailReconciliationService = new JobEmailReconciliationService(
    jobEmailRepository,
    applicationsService,
    (operation) => database.transaction(operation).immediate(),
    () => new Date("2026-07-18T12:16:00.000Z"),
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
    jobEmailReconciliationService,
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
    jobEmailRepository,
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
    await request(app)
      .get("/api/applications/123e4567-e89b-12d3-a456-426614174000/evidence")
      .expect(401, { error: { code: "authentication_required" } });
    await sameOrigin(
      request(app).post(
        "/api/applications/123e4567-e89b-12d3-a456-426614174000/evidence",
      ),
    )
      .send({
        email: {
          messageId: "<unauthenticated@example.com>",
          receivedAt: "2026-07-18T11:45:00.000Z",
        },
        evidenceType: "other",
      })
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
      .post("/api/applications/123e4567-e89b-12d3-a456-426614174000/evidence")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .send({
        email: {
          messageId: "<csrf@example.com>",
          receivedAt: "2026-07-18T11:45:00.000Z",
        },
        evidenceType: "other",
      })
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

  it("returns linked email and canonical job-posting evidence", async () => {
    const { app, jobEmailRepository, references, setup } =
      await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(applicationInput(references))
      .expect(201);
    const applicationId = createdApplication(created).id;
    if (typeof applicationId !== "string") {
      throw new Error("Expected an application ID");
    }
    jobEmailRepository.linkEmailEvidence({
      applicationId,
      evidenceType: "application_confirmation",
      messageId: "<application@example.com>",
      occurredAt: "2026-07-18T12:16:00.000Z",
      receivedAt: "2026-07-18T11:45:00.000Z",
      webUrl: "https://outlook.office.com/mail/inbox/id/example",
      workspaceId: setup.workspace.id,
    });
    jobEmailRepository.linkJobPosting({
      applicationId,
      canonicalUrl: "https://www.indeed.com/viewjob?jk=example",
      externalPostingId: "example",
      occurredAt: "2026-07-18T12:16:00.000Z",
      provider: "indeed",
      workspaceId: setup.workspace.id,
    });

    const response = await request(app)
      .get(`/api/applications/${applicationId}/evidence`)
      .set("Cookie", cookie)
      .expect(200);
    expect(responseBody(response)).toMatchObject({
      emailEvidence: [
        {
          applicationId,
          evidenceType: "application_confirmation",
          messageId: "<application@example.com>",
          receivedAt: "2026-07-18T11:45:00.000Z",
          webUrl: "https://outlook.office.com/mail/inbox/id/example",
        },
      ],
      jobPostings: [
        {
          applicationId,
          canonicalUrl: "https://www.indeed.com/viewjob?jk=example",
          externalPostingId: "example",
          provider: "indeed",
        },
      ],
    });
  });

  it("idempotently links typed email evidence to an existing application", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(applicationInput(references))
      .expect(201);
    const application = createdApplication(created);
    const applicationId = application.id;
    if (typeof applicationId !== "string") {
      throw new Error("Expected an application ID");
    }
    const input = {
      email: {
        messageId: "<http-link@example.com>",
        receivedAt: "2026-07-18T11:45:00.000Z",
        webUrl: "https://outlook.office.com/mail/inbox/id/http-link",
      },
      evidenceType: "application_confirmation",
    };

    const first = await sameOrigin(
      request(app).post(`/api/applications/${applicationId}/evidence`),
    )
      .set("Cookie", cookie)
      .send(input)
      .expect(201);
    expect(responseBody(first)).toMatchObject({
      action: "linked",
      application,
      emailEvidence: [
        {
          applicationId,
          evidenceType: "application_confirmation",
          messageId: input.email.messageId,
          receivedAt: input.email.receivedAt,
          webUrl: input.email.webUrl,
        },
      ],
      emailEvidenceLinked: true,
      postingLinked: false,
    });

    await sameOrigin(
      request(app).post(`/api/applications/${applicationId}/evidence`),
    )
      .set("Cookie", cookie)
      .send(input)
      .expect(200)
      .expect((response) => {
        expect(responseBody(response)).toMatchObject({
          emailEvidenceLinked: false,
        });
      });

    await sameOrigin(
      request(app).post(`/api/applications/${applicationId}/evidence`),
    )
      .set("Cookie", cookie)
      .send({ ...input, evidenceType: "rejection" })
      .expect(409, { error: { code: "job_email_conflict" } });

    await sameOrigin(
      request(app).post(`/api/applications/${applicationId}/evidence`),
    )
      .set("Cookie", cookie)
      .send({ ...input, evidenceType: "unsupported" })
      .expect(400, { error: { code: "validation_error" } });

    await sameOrigin(request(app).delete(`/api/applications/${applicationId}`))
      .set("Cookie", cookie)
      .expect(204);
    await sameOrigin(
      request(app).post(`/api/applications/${applicationId}/evidence`),
    )
      .set("Cookie", cookie)
      .send({
        ...input,
        email: { ...input.email, messageId: "<deleted@example.com>" },
      })
      .expect(404, { error: { code: "application_not_found" } });
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
    await sameOrigin(
      request(app).post(`/api/applications/${String(source.id)}/evidence`),
    )
      .set("Cookie", cookie)
      .send({
        email: {
          messageId: "<merged-source@example.com>",
          receivedAt: "2026-07-18T11:45:00.000Z",
        },
        evidenceType: "other",
      })
      .expect(404, { error: { code: "application_not_found" } });
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

  it("returns one bounded attention queue with combined HTTP filters", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send({
        companyName: "Attention Example",
        nextAction: "Follow up",
        nextActionDue: "2026-07-17",
        roleTitle: "Platform Engineer",
        statusId: references.applied,
      })
      .expect(201);
    const application = createdApplication(created);
    const secondCreated = await sameOrigin(
      request(app).post("/api/applications"),
    )
      .set("Cookie", cookie)
      .send({
        companyName: "Attention Second",
        nextAction: "Call recruiter",
        nextActionDue: "2026-07-16",
        roleTitle: "Platform Engineer",
        statusId: references.applied,
      })
      .expect(201);
    const secondApplication = createdApplication(secondCreated);
    if (
      typeof application.id !== "string" ||
      typeof secondApplication.id !== "string"
    ) {
      throw new Error("Expected application IDs");
    }

    const response = await request(app)
      .get("/api/applications/attention")
      .query({
        fieldStates: "missing",
        lifecycle: "active",
        limit: "1",
        missingFields: ["salary", "location"],
        nextAction: "overdue",
        query: "platform attention",
      })
      .set("Cookie", cookie)
      .expect(200);
    const body = responseBody(response);
    const attentionItems = objectArrayProperty(body, "applications");
    expect(attentionItems).toHaveLength(1);
    const attentionItem = attentionItems[0];
    if (!attentionItem) throw new Error("Expected one attention item");
    const returnedApplication = objectProperty(attentionItem, "application");
    if (typeof returnedApplication.id !== "string") {
      throw new Error("Expected an attention application ID");
    }
    expect([application.id, secondApplication.id]).toContain(
      returnedApplication.id,
    );
    expect(objectArrayProperty(attentionItem, "reasons")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "next_action_overdue" }),
        expect.objectContaining({ code: "salary_missing", state: "missing" }),
        expect.objectContaining({ code: "location_missing", state: "missing" }),
      ]),
    );
    expect(objectProperty(body, "summary")).toMatchObject({
      queuedApplications: 2,
      totalApplications: 2,
    });
    expect(body).toMatchObject({ nextOffset: 1, returned: 1, total: 2 });
    await request(app)
      .get("/api/applications/attention")
      .query({ limit: "101" })
      .set("Cookie", cookie)
      .expect(400, { error: { code: "validation_error" } });
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

  it("edits an application and returns its immutable activity timeline", async () => {
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
      limit: 25,
      nextOffset: null,
      offset: 0,
      returned: 2,
      total: 2,
    });
    expect(JSON.stringify(history.body)).not.toMatch(
      /actorUserId|workspaceId|password|token/i,
    );

    const activity = await sameOrigin(
      request(app).post(`/api/applications/${applicationId}/events`),
    )
      .set("Cookie", cookie)
      .send({
        idempotencyKey: "manual:recruiter-screen:1",
        occurredAt: "2026-07-18T12:10:00.000Z",
        summary: "Completed the recruiter screen",
        type: "recruiter_screen",
      })
      .expect(201);
    expect(activity.body).toMatchObject({
      event: {
        actorDisplayName: "Alex Example",
        summary: "Completed the recruiter screen",
        type: "recruiter_screen",
      },
    });
    const activityRetry = await sameOrigin(
      request(app).post(`/api/applications/${applicationId}/events`),
    )
      .set("Cookie", cookie)
      .send({
        idempotencyKey: "manual:recruiter-screen:1",
        occurredAt: "2026-07-18T12:10:00.000Z",
        summary: "Completed the recruiter screen",
        type: "recruiter_screen",
      })
      .expect(201);
    expect(activityRetry.body).toEqual(activity.body);
    const activityEvent = responseObject(activity, "event");
    const activityEventId = activityEvent["id"];
    if (typeof activityEventId !== "string") {
      throw new Error("Expected an activity event ID");
    }
    const firstPage = await request(app)
      .get(`/api/applications/${applicationId}/events?limit=2&offset=0`)
      .set("Cookie", cookie)
      .expect(200);
    expect(firstPage.body).toMatchObject({
      limit: 2,
      nextOffset: 2,
      offset: 0,
      returned: 2,
      total: 3,
    });
    const secondPage = await request(app)
      .get(`/api/applications/${applicationId}/events?limit=2&offset=2`)
      .set("Cookie", cookie)
      .expect(200);
    expect(secondPage.body).toMatchObject({
      events: [expect.objectContaining({ id: activityEventId })],
      nextOffset: null,
      offset: 2,
      returned: 1,
      total: 3,
    });
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
    await request(app)
      .get(`/api/applications/${missingId}/evidence`)
      .set("Cookie", cookie)
      .expect(404, { error: { code: "application_not_found" } });
    await sameOrigin(
      request(app).post(`/api/applications/${missingId}/evidence`),
    )
      .set("Cookie", cookie)
      .send({
        email: {
          messageId: "<missing@example.com>",
          receivedAt: "2026-07-18T11:45:00.000Z",
        },
        evidenceType: "other",
      })
      .expect(404, { error: { code: "application_not_found" } });
    await request(app)
      .get("/api/applications/not-a-uuid/evidence")
      .set("Cookie", cookie)
      .expect(400, { error: { code: "validation_error" } });
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

  it("records, lists, and verifies field provenance without changing the application scalar", async () => {
    const { app, references } = await createApplicationsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const created = await sameOrigin(request(app).post("/api/applications"))
      .set("Cookie", cookie)
      .send(applicationInput(references))
      .expect(201);
    const application = createdApplication(created);
    if (typeof application.id !== "string") {
      throw new Error("Expected an application ID");
    }
    const recorded = await sameOrigin(
      request(app).post(`/api/applications/${application.id}/provenance`),
    )
      .set("Cookie", cookie)
      .send({
        confidence: 0.9,
        field: "salary",
        fieldState: "disclosed",
        idempotencyKey: "http-salary-1",
        observedAt: "2026-07-18T11:30:00.000Z",
        source: { type: "imported" },
        value: "£75,000",
      })
      .expect(201);
    const provenance = responseObject(recorded, "provenance");
    expect(provenance).toMatchObject({
      applicationId: application.id,
      field: "salary",
      relationship: "selected",
      verifiedAt: null,
    });
    if (typeof provenance.id !== "string") {
      throw new Error("Expected a provenance ID");
    }

    const listed = await request(app)
      .get(`/api/applications/${application.id}/provenance`)
      .set("Cookie", cookie)
      .expect(200);
    expect(objectArrayProperty(responseBody(listed), "assessments")).toEqual([
      expect.objectContaining({
        conflicting: 0,
        field: "salary",
        stale: 0,
      }),
    ]);
    const verified = await sameOrigin(
      request(app).post(
        `/api/applications/${application.id}/provenance/${provenance.id}/verify`,
      ),
    )
      .set("Cookie", cookie)
      .expect(200);
    expect(responseObject(verified, "provenance")).toMatchObject({
      verifiedByDisplayName: "Alex Example",
    });
    const applications = await request(app)
      .get("/api/applications")
      .set("Cookie", cookie)
      .expect(200);
    expect(
      objectArrayProperty(responseBody(applications), "applications")[0]
        ?.salary,
    ).toBe(application.salary);
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
