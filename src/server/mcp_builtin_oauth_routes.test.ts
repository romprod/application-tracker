import { createHash } from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AuthService } from "../application/auth.js";
import { McpBuiltInOAuthService } from "../application/mcp_builtin_oauth.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoMcpOAuthTokenManager } from "../infrastructure/auth/mcp_oauth_token_manager.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteMcpBuiltInOAuthRepository } from "../infrastructure/database/mcp_builtin_oauth_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { createApp } from "./app.js";
import { createMcpBuiltInOAuthRouter } from "./mcp_builtin_oauth_routes.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];
const endpoint = "https://tracker.example/mcp";
const scope = "application-tracker:tools";
const callback = "https://claude.ai/api/mcp/auth_callback";

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function oauthApp() {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });
  const passwordHash = await hasher.hash("correct horse battery staple");
  const dummyPasswordHash = await hasher.hash("dummy password value");
  new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-01-01T00:00:00.000Z",
    displayName: "Alex Example",
    passwordHash,
    username: "alex",
    workspaceName: "Applications",
  });
  const clock = () => new Date("2026-01-01T01:00:00.000Z");
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
    clock,
  );
  const oauth = new McpBuiltInOAuthService(
    new SqliteMcpBuiltInOAuthRepository(database),
    new CryptoMcpOAuthTokenManager(),
    { requiredScope: scope, resourceUrl: endpoint },
    clock,
  );
  return {
    app: createApp({
      mcpOAuthRouter: createMcpBuiltInOAuthRouter({
        authService,
        cookieOptions: { maxAgeSeconds: 86_400, secure: false },
        oauth,
        requiredScope: scope,
        resourceUrl: endpoint,
      }),
    }),
    oauth,
  };
}

function oauthParams(clientId: string, challenge: string) {
  return {
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: callback,
    resource: endpoint,
    response_type: "code",
    scope,
    state: "claude-state",
  };
}

function firstCookie(response: request.Response): string {
  const value: unknown = response.headers["set-cookie"];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  throw new Error("Expected OAuth login cookie");
}

function responseObject(response: request.Response): Record<string, unknown> {
  const value = response.body as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an OAuth JSON object");
  }
  return value as Record<string, unknown>;
}

function requiredString(
  value: Record<string, unknown>,
  property: string,
): string {
  const result = value[property];
  if (typeof result !== "string" || result.length === 0) {
    throw new Error(`Expected OAuth ${property}`);
  }
  return result;
}

describe("built-in MCP OAuth routes", () => {
  it("discovers, registers, authorizes with a local login, refreshes, and revokes", async () => {
    const { app, oauth } = await oauthApp();
    const metadata = await request(app)
      .get("/.well-known/oauth-authorization-server")
      .expect(200);
    expect(responseObject(metadata)).toMatchObject({
      authorization_endpoint: "https://tracker.example/authorize",
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      issuer: "https://tracker.example/",
      registration_endpoint: "https://tracker.example/register",
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [scope],
      token_endpoint: "https://tracker.example/token",
      token_endpoint_auth_methods_supported: ["none"],
    });

    const registered = await request(app)
      .post("/register")
      .send({
        client_name: "Claude",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [callback],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      })
      .expect(201);
    const registeredBody = responseObject(registered);
    expect(registeredBody).toMatchObject({
      client_name: "Claude",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
    });
    expect(registeredBody).not.toHaveProperty("client_secret");
    const clientId = requiredString(registeredBody, "client_id");

    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = oauthParams(clientId, challenge);
    const loginPage = await request(app).get("/authorize").query(params);
    expect(loginPage.status).toBe(200);
    expect(String(loginPage.headers["content-security-policy"])).toContain(
      "form-action 'self' https://claude.ai",
    );
    expect(loginPage.text).toContain("Sign in to Application Tracker");
    expect(loginPage.text).toContain("Claude");

    const loggedIn = await request(app)
      .post("/authorize")
      .type("form")
      .send({
        ...params,
        oauth_action: "login",
        password: "correct horse battery staple",
        username: "alex",
      })
      .expect(200);
    expect(loggedIn.text).toContain("Authorize Claude");
    expect(loggedIn.text).toContain("Alex Example");
    expect(loggedIn.text).toContain("Connection permission");
    const cookie = firstCookie(loggedIn);

    const approved = await request(app)
      .post("/authorize")
      .set("Cookie", cookie)
      .type("form")
      .send({
        ...params,
        access_mode: "read_write",
        oauth_action: "approve",
      })
      .expect(302);
    const redirect = new URL(String(approved.headers.location));
    expect(`${redirect.origin}${redirect.pathname}`).toBe(callback);
    expect(redirect.searchParams.get("state")).toBe("claude-state");
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await request(app)
      .post("/token")
      .type("form")
      .send({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: callback,
        resource: endpoint,
      })
      .expect(200);
    const tokenBody = responseObject(token);
    expect(tokenBody).toMatchObject({
      expires_in: 900,
      scope,
      token_type: "Bearer",
    });
    expect(
      oauth.authorize(requiredString(tokenBody, "access_token")),
    ).toMatchObject({
      accessMode: "read_write",
      actor: { user: { username: "alex" } },
      workspaceSlug: "default",
    });

    const refreshed = await request(app)
      .post("/token")
      .type("form")
      .send({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: requiredString(tokenBody, "refresh_token"),
        resource: endpoint,
      })
      .expect(200);
    const refreshedBody = responseObject(refreshed);
    await request(app)
      .post("/revoke")
      .type("form")
      .send({
        client_id: clientId,
        token: requiredString(refreshedBody, "refresh_token"),
      })
      .expect(200);
    expect(() =>
      oauth.authorize(requiredString(refreshedBody, "access_token")),
    ).toThrow("invalid");
  });
});
