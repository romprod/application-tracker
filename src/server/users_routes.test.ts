import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AuthService } from "../application/auth.js";
import { UserAdministrationService } from "../application/users.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { SqliteUsersRepository } from "../infrastructure/database/users_repository.js";
import { createApp } from "./app.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function createUsersApp(externalIdentityIssuer?: string) {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });
  const passwordHash = await hasher.hash("correct horse battery staple");
  const dummyPasswordHash = await hasher.hash("not a real account password");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
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
    () => new Date("2026-01-01T00:10:00.000Z"),
    externalIdentityIssuer,
  );
  const app = createApp({
    authCookie: { maxAgeSeconds: 86_400, secure: false },
    authService,
    usersService,
  });
  return { app, database, setup };
}

function sessionCookie(response: request.Response): string {
  const header: unknown = response.headers["set-cookie"];
  if (typeof header === "string") return header;
  if (Array.isArray(header) && typeof header[0] === "string") return header[0];
  throw new Error("Expected a session cookie");
}

function createdUser(response: request.Response): Record<string, unknown> {
  const body: unknown = response.body;
  if (
    typeof body !== "object" ||
    body === null ||
    !("user" in body) ||
    typeof body.user !== "object" ||
    body.user === null
  ) {
    throw new Error("Expected a created user");
  }
  return body.user as Record<string, unknown>;
}

function createdUserId(response: request.Response): string {
  const user = createdUser(response);
  if (typeof user.id !== "string") {
    throw new Error("Expected a created user identifier");
  }
  return user.id;
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

describe("user administration routes", () => {
  it("rejects user mutations without a matching browser origin", async () => {
    const { app } = await createUsersApp();
    const cookie = await login(app, "alex", "correct horse battery staple");
    const input = {
      displayName: "Sam Member",
      password: "member password phrase",
      role: "member",
      username: "sam",
    };

    await request(app)
      .post("/api/settings/users")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .send(input)
      .expect(403, { error: { code: "csrf_rejected" } });
    await request(app)
      .post("/api/settings/users")
      .set("Cookie", cookie)
      .set("Host", "tracker.example.test")
      .set("Origin", "https://other.example.test")
      .send(input)
      .expect(403, { error: { code: "csrf_rejected" } });
  });

  it("requires an authenticated administrator", async () => {
    const { app } = await createUsersApp();
    await request(app)
      .get("/api/settings/users")
      .expect(401, { error: { code: "authentication_required" } });

    const adminCookie = await login(
      app,
      "alex",
      "correct horse battery staple",
    );
    const created = await sameOrigin(request(app).post("/api/settings/users"))
      .set("Cookie", adminCookie)
      .send({
        displayName: "Sam Member",
        password: "member password phrase",
        role: "member",
        username: "sam",
      })
      .expect(201);
    const memberCookie = await login(app, "sam", "member password phrase");

    await request(app)
      .get("/api/settings/users")
      .set("Cookie", memberCookie)
      .expect(403, { error: { code: "forbidden" } });
    await sameOrigin(
      request(app).post(
        `/api/settings/users/${createdUserId(created)}/external-identities`,
      ),
    )
      .set("Cookie", memberCookie)
      .send({ subject: "member-subject" })
      .expect(403, { error: { code: "forbidden" } });
    expect(createdUser(created)).toMatchObject({
      displayName: "Sam Member",
      isCurrentUser: false,
      localAccount: true,
      role: "member",
      status: "active",
      username: "sam",
    });
  });

  it("lists users without credential material and hashes new passwords", async () => {
    const { app, database } = await createUsersApp();
    const cookie = await login(app, "alex", "correct horse battery staple");

    await sameOrigin(request(app).post("/api/settings/users"))
      .set("Cookie", cookie)
      .send({
        displayName: "Sam Member",
        password: "member password phrase",
        role: "member",
        username: "sam",
      })
      .expect(201);
    const response = await request(app)
      .get("/api/settings/users")
      .set("Cookie", cookie)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      externalIdentityProviderConfigured: false,
      users: [
        expect.objectContaining({
          isCurrentUser: true,
          role: "admin",
          username: "alex",
        }),
        expect.objectContaining({
          isCurrentUser: false,
          role: "member",
          username: "sam",
        }),
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain("password");
    expect(
      database
        .prepare(
          `SELECT lc.password_hash
           FROM local_credentials lc
           JOIN users u ON u.id = lc.user_id
           WHERE u.username = ?`,
        )
        .pluck()
        .get("sam"),
    ).not.toBe("member password phrase");
  });

  it("links and unlinks the configured provider subject for a workspace user", async () => {
    const issuer = "https://identity.example/application/o/mcp/";
    const { app, database } = await createUsersApp(issuer);
    const adminCookie = await login(
      app,
      "alex",
      "correct horse battery staple",
    );
    const created = await sameOrigin(request(app).post("/api/settings/users"))
      .set("Cookie", adminCookie)
      .send({
        displayName: "Sam Member",
        password: "member password phrase",
        role: "member",
        username: "sam",
      })
      .expect(201);
    const userId = createdUserId(created);

    const linked = await sameOrigin(
      request(app).post(`/api/settings/users/${userId}/external-identities`),
    )
      .set("Cookie", adminCookie)
      .send({ subject: "oauth-subject-123" })
      .expect(201);
    const linkedUser = createdUser(linked);
    expect(linkedUser.externalIdentities).toEqual([
      expect.objectContaining({
        createdAt: "2026-01-01T00:10:00.000Z",
        subject: "oauth-subject-123",
      }),
    ]);
    expect(JSON.stringify(linked.body)).not.toContain(issuer);
    expect(
      database
        .prepare("SELECT issuer FROM external_identities WHERE user_id = ?")
        .pluck()
        .get(userId),
    ).toBe(issuer);

    const identity = linkedUser.externalIdentities;
    if (!Array.isArray(identity)) throw new Error("Expected identity links");
    const identityId = (identity[0] as { id?: unknown } | undefined)?.id;
    if (typeof identityId !== "string") {
      throw new Error("Expected an identity identifier");
    }
    const unlinked = await sameOrigin(
      request(app).delete(
        `/api/settings/users/${userId}/external-identities/${identityId}`,
      ),
    )
      .set("Cookie", adminCookie)
      .expect(200);
    expect(createdUser(unlinked).externalIdentities).toEqual([]);
  });

  it("fails closed when identity linking is unconfigured or conflicts", async () => {
    const unconfigured = await createUsersApp();
    const unconfiguredCookie = await login(
      unconfigured.app,
      "alex",
      "correct horse battery staple",
    );
    await sameOrigin(
      request(unconfigured.app).post(
        `/api/settings/users/${unconfigured.setup.administrator.id}/external-identities`,
      ),
    )
      .set("Cookie", unconfiguredCookie)
      .send({ subject: "oauth-subject-123" })
      .expect(409, {
        error: { code: "external_identity_provider_unavailable" },
      });

    const issuer = "https://identity.example/application/o/mcp/";
    const configured = await createUsersApp(issuer);
    const configuredCookie = await login(
      configured.app,
      "alex",
      "correct horse battery staple",
    );
    const first = await sameOrigin(
      request(configured.app).post(
        `/api/settings/users/${configured.setup.administrator.id}/external-identities`,
      ),
    )
      .set("Cookie", configuredCookie)
      .send({ subject: "shared-subject" })
      .expect(201);
    const secondUser = await sameOrigin(
      request(configured.app).post("/api/settings/users"),
    )
      .set("Cookie", configuredCookie)
      .send({
        displayName: "Sam Member",
        password: "member password phrase",
        role: "member",
        username: "sam",
      })
      .expect(201);
    await sameOrigin(
      request(configured.app).post(
        `/api/settings/users/${createdUserId(secondUser)}/external-identities`,
      ),
    )
      .set("Cookie", configuredCookie)
      .send({ subject: "shared-subject" })
      .expect(409, { error: { code: "external_identity_unavailable" } });

    const firstIdentity = createdUser(first).externalIdentities;
    if (!Array.isArray(firstIdentity)) throw new Error("Expected identity");
    const identityId = (firstIdentity[0] as { id?: unknown } | undefined)?.id;
    if (typeof identityId !== "string") throw new Error("Expected identity");
    await sameOrigin(
      request(configured.app).delete(
        `/api/settings/users/${createdUserId(secondUser)}/external-identities/${identityId}`,
      ),
    )
      .set("Cookie", configuredCookie)
      .expect(404, { error: { code: "external_identity_not_found" } });
  });

  it("rejects duplicate usernames and disabling the current account", async () => {
    const { app, setup } = await createUsersApp();
    const cookie = await login(app, "alex", "correct horse battery staple");

    await sameOrigin(request(app).post("/api/settings/users"))
      .set("Cookie", cookie)
      .send({
        displayName: "Short Password",
        password: "too short",
        role: "member",
        username: "short-password",
      })
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/settings/users"))
      .set("Cookie", cookie)
      .send({
        displayName: "Duplicate Alex",
        password: "another password phrase",
        role: "member",
        username: "ALEX",
      })
      .expect(409, { error: { code: "username_unavailable" } });
    await sameOrigin(
      request(app).patch(
        `/api/settings/users/${setup.administrator.id}/status`,
      ),
    )
      .set("Cookie", cookie)
      .send({ status: "disabled" })
      .expect(409, { error: { code: "cannot_disable_self" } });
  });

  it("revokes a disabled user's existing sessions", async () => {
    const { app } = await createUsersApp();
    const adminCookie = await login(
      app,
      "alex",
      "correct horse battery staple",
    );
    const created = await sameOrigin(request(app).post("/api/settings/users"))
      .set("Cookie", adminCookie)
      .send({
        displayName: "Sam Member",
        password: "member password phrase",
        role: "member",
        username: "sam",
      });
    const memberCookie = await login(app, "sam", "member password phrase");

    await sameOrigin(
      request(app).patch(
        `/api/settings/users/${createdUserId(created)}/status`,
      ),
    )
      .set("Cookie", adminCookie)
      .send({ status: "disabled" })
      .expect(200);
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", memberCookie)
      .expect(200, { authenticated: false });
  });
});
