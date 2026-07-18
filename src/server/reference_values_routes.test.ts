import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AuthService } from "../application/auth.js";
import { ReferenceValuesService } from "../application/reference_values.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteReferenceValuesRepository } from "../infrastructure/database/reference_values_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { SqliteUsersRepository } from "../infrastructure/database/users_repository.js";
import { createApp } from "./app.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function createListsApp() {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });
  const adminHash = await hasher.hash("correct horse battery staple");
  const memberHash = await hasher.hash("member password phrase");
  const dummyPasswordHash = await hasher.hash("not a real account password");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-18T12:00:00.000Z",
    displayName: "Alex Example",
    passwordHash: adminHash,
    username: "alex",
    workspaceName: "Applications",
  });
  new SqliteUsersRepository(database).createLocalUser({
    createdAt: "2026-07-18T12:05:00.000Z",
    displayName: "Sam Member",
    passwordHash: memberHash,
    role: "member",
    username: "sam",
    workspaceId: setup.workspace.id,
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
    () => new Date("2026-07-18T12:10:00.000Z"),
  );
  return createApp({
    authCookie: { maxAgeSeconds: 86_400, secure: false },
    authService,
    referenceValuesService: new ReferenceValuesService(
      new SqliteReferenceValuesRepository(database),
      () => new Date("2026-07-18T12:15:00.000Z"),
    ),
  });
}

function sessionCookie(response: request.Response): string {
  const header: unknown = response.headers["set-cookie"];
  if (typeof header === "string") return header;
  if (Array.isArray(header) && typeof header[0] === "string") return header[0];
  throw new Error("Expected a session cookie");
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

function responseValue(response: request.Response): Record<string, unknown> {
  const value = responseBody(response).value;
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected a reference value");
  }
  return value as Record<string, unknown>;
}

describe("reference value routes", () => {
  it("lets authenticated members read workspace lists", async () => {
    const app = await createListsApp();
    const cookie = await login(app, "sam", "member password phrase");

    const response = await request(app)
      .get("/api/settings/lists")
      .set("Cookie", cookie)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(responseBody(response).values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "status", label: "Prospect" }),
        expect.objectContaining({
          category: "document_type",
          label: "CV",
        }),
      ]),
    );
  });

  it("requires administrators and matching origins for mutations", async () => {
    const app = await createListsApp();
    const memberCookie = await login(app, "sam", "member password phrase");
    const adminCookie = await login(
      app,
      "alex",
      "correct horse battery staple",
    );

    await sameOrigin(request(app).post("/api/settings/lists"))
      .set("Cookie", memberCookie)
      .send({ category: "source", label: "Community board" })
      .expect(403, { error: { code: "forbidden" } });
    await request(app)
      .post("/api/settings/lists")
      .set("Cookie", adminCookie)
      .set("Host", "tracker.example.test")
      .send({ category: "source", label: "Community board" })
      .expect(403, { error: { code: "csrf_rejected" } });
  });

  it("creates, updates, and removes a value", async () => {
    const app = await createListsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");

    const created = await sameOrigin(request(app).post("/api/settings/lists"))
      .set("Cookie", cookie)
      .send({ category: "source", label: "Community board" })
      .expect(201);
    expect(responseValue(created)).toMatchObject({
      category: "source",
      isActive: true,
      label: "Community board",
    });

    const id = responseValue(created).id;
    if (typeof id !== "string") throw new Error("Expected a value identifier");
    const updated = await sameOrigin(
      request(app).patch(`/api/settings/lists/${id}`),
    )
      .set("Cookie", cookie)
      .send({ isActive: false, label: "Local board" })
      .expect(200);
    expect(responseValue(updated)).toMatchObject({
      isActive: false,
      label: "Local board",
    });
    await sameOrigin(request(app).delete(`/api/settings/lists/${id}`))
      .set("Cookie", cookie)
      .expect(204);
  });

  it("returns stable validation and conflict errors", async () => {
    const app = await createListsApp();
    const cookie = await login(app, "alex", "correct horse battery staple");

    await sameOrigin(request(app).post("/api/settings/lists"))
      .set("Cookie", cookie)
      .send({ category: "source", isTerminal: true, label: "Invalid" })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/settings/lists"))
      .set("Cookie", cookie)
      .send({ category: "status", label: "PROSPECT" })
      .expect(409, { error: { code: "reference_value_conflict" } });
  });
});
