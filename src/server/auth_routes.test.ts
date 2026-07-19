import { parseCookie } from "cookie";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthService,
  LoginAttemptRateLimitError,
  LoginVerificationCapacityError,
} from "../application/auth.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { createApp } from "./app.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function createAuthApp() {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });
  const passwordHash = await hasher.hash("correct horse battery staple");
  const dummyPasswordHash = await hasher.hash("not a real account password");
  new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-01-01T00:00:00.000Z",
    displayName: "Alex Example",
    passwordHash,
    username: "alex",
    workspaceName: "Applications",
  });
  let now = new Date("2026-01-01T00:00:00.000Z");
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
    () => now,
  );
  const app = createApp({
    authCookie: { maxAgeSeconds: 86_400, secure: false },
    authService,
  });

  return {
    app,
    database,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}

function sessionCookie(response: request.Response): string {
  const header: unknown = response.headers["set-cookie"];
  if (typeof header === "string") return header;
  if (Array.isArray(header) && typeof header[0] === "string") return header[0];
  throw new Error("Expected a session cookie");
}

describe("authentication routes", () => {
  it("returns a retryable limit response when password verification is full", async () => {
    const authService = {
      getSession: vi.fn(() => undefined),
      login: vi.fn(() => Promise.reject(new LoginVerificationCapacityError())),
      logout: vi.fn(),
    } as unknown as AuthService;
    const app = createApp({
      authCookie: { maxAgeSeconds: 86_400, secure: false },
      authService,
    });

    const response = await request(app).post("/api/auth/login").send({
      password: "schema-valid password",
      username: "alex",
    });

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.body).toEqual({
      error: { code: "login_capacity_reached" },
    });
  });

  it("returns the login attempt window when the actor is rate limited", async () => {
    const login = vi.fn(() =>
      Promise.reject(new LoginAttemptRateLimitError(37)),
    );
    const authService = {
      getSession: vi.fn(() => undefined),
      login,
      logout: vi.fn(),
    } as unknown as AuthService;
    const app = createApp({
      authCookie: { maxAgeSeconds: 86_400, secure: false },
      authService,
    });

    const response = await request(app).post("/api/auth/login").send({
      password: "schema-valid password",
      username: "alex",
    });

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("37");
    expect(response.body).toEqual({
      error: { code: "login_rate_limited" },
    });
    expect(login).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
      expect.any(String),
    );
  });

  it("returns one generic error for unknown users and wrong passwords", async () => {
    const { app } = await createAuthApp();

    for (const input of [
      { password: "incorrect password", username: "alex" },
      { password: "incorrect password", username: "missing" },
    ]) {
      const response = await request(app).post("/api/auth/login").send(input);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: "invalid_credentials" },
      });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("sets an opaque cookie and returns the authenticated session", async () => {
    const { app, database } = await createAuthApp();
    const login = await request(app).post("/api/auth/login").send({
      password: "correct horse battery staple",
      username: "alex",
    });

    expect(login.status).toBe(200);
    expect(login.body).toEqual({
      authenticated: true,
      user: {
        displayName: "Alex Example",
        role: "admin",
        username: "alex",
      },
      workspace: { name: "Applications" },
    });
    expect(login.body).not.toHaveProperty("token");

    const cookie = sessionCookie(login);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    const rawToken = parseCookie(cookie).application_tracker_session;
    expect(rawToken).toBeTruthy();
    expect(
      database.prepare("SELECT token_hash FROM sessions").pluck().get(),
    ).not.toBe(rawToken);

    const current = await request(app)
      .get("/api/auth/session")
      .set("Cookie", cookie);
    expect(current.status).toBe(200);
    expect(current.body).toEqual(login.body);
    expect(current.headers["cache-control"]).toBe("no-store");
  });

  it("expires idle sessions and revokes them on logout", async () => {
    const { app, setNow } = await createAuthApp();
    const login = await request(app).post("/api/auth/login").send({
      password: "correct horse battery staple",
      username: "alex",
    });
    const cookie = sessionCookie(login);

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(logout.status).toBe(204);
    expect(sessionCookie(logout)).toContain("Max-Age=0");
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", cookie)
      .expect(200, { authenticated: false });

    const secondLogin = await request(app).post("/api/auth/login").send({
      password: "correct horse battery staple",
      username: "alex",
    });
    const secondCookie = sessionCookie(secondLogin);
    setNow("2026-01-01T00:31:00.000Z");
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", secondCookie)
      .expect(200, { authenticated: false });
  });
});
