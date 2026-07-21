import { createHash } from "node:crypto";

import { expect, test, type APIResponse } from "@playwright/test";

import { applicationMcpToolNames } from "../src/application/mcp";
import { e2eAdministrator, e2eMcp, e2eSetupToken } from "./fixtures";

function record(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  description: string,
): string {
  const member = value[key];
  if (typeof member !== "string" || member.length === 0) {
    throw new Error(`${description}.${key} must be a non-empty string`);
  }
  return member;
}

function requiredStringArray(value: unknown, description: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((member: unknown) => typeof member === "string")
  ) {
    throw new Error(`${description} must be an array of strings`);
  }
  return value;
}

async function responseObject(
  response: APIResponse,
  expectedStatus: number,
  description: string,
): Promise<Record<string, unknown>> {
  expect(response.status(), await response.text()).toBe(expectedStatus);
  const body: unknown = await response.json();
  return record(body, description);
}

function localTransportUrl(logicalUrl: string, baseURL: string): string {
  const logical = new URL(logicalUrl);
  return new URL(`${logical.pathname}${logical.search}`, baseURL).href;
}

function mcpHeaders(
  accessToken: string,
  sessionId?: string,
): Record<string, string> {
  return {
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Host: new URL(e2eMcp.resourceUrl).host,
    "MCP-Protocol-Version": "2025-11-25",
    Origin: e2eMcp.allowedOrigin,
    ...(sessionId ? { "MCP-Session-Id": sessionId } : {}),
  };
}

test("completes setup and the OAuth-to-MCP connection lifecycle", async ({
  baseURL,
  page,
  request,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");

  const challengeResponse = await request.get("/mcp", {
    headers: { Host: new URL(e2eMcp.resourceUrl).host },
  });
  expect(challengeResponse.status()).toBe(401);
  const challenge = challengeResponse.headers()["www-authenticate"];
  expect(challenge).toContain(`scope="${e2eMcp.scope}"`);
  const metadataMatch = /resource_metadata="([^"]+)"/.exec(challenge ?? "");
  expect(metadataMatch).not.toBeNull();
  const metadataUrl = metadataMatch?.[1];
  if (!metadataUrl) throw new Error("The MCP challenge omitted metadata");
  expect(metadataUrl).toBe(
    "https://tracker.example/.well-known/oauth-protected-resource/mcp",
  );

  const protectedResource = await responseObject(
    await request.get(localTransportUrl(metadataUrl, baseURL), {
      headers: { Accept: "application/json" },
    }),
    200,
    "protected resource metadata",
  );
  expect(protectedResource).toMatchObject({
    authorization_servers: ["https://tracker.example/"],
    resource: e2eMcp.resourceUrl,
    scopes_supported: [e2eMcp.scope],
  });
  const authorizationServers = requiredStringArray(
    protectedResource.authorization_servers,
    "authorization_servers",
  );
  const authorizationServer = authorizationServers[0];
  if (typeof authorizationServer !== "string") {
    throw new Error("authorization_servers must include an issuer");
  }

  const authorizationMetadata = await responseObject(
    await request.get(
      localTransportUrl(
        new URL("/.well-known/oauth-authorization-server", authorizationServer)
          .href,
        baseURL,
      ),
      { headers: { Accept: "application/json" } },
    ),
    200,
    "authorization server metadata",
  );
  expect(authorizationMetadata).toMatchObject({
    authorization_endpoint: "https://tracker.example/authorize",
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer: authorizationServer,
    registration_endpoint: "https://tracker.example/register",
    token_endpoint: "https://tracker.example/token",
    token_endpoint_auth_methods_supported: ["none"],
  });

  const registrationEndpoint = requiredString(
    authorizationMetadata,
    "registration_endpoint",
    "authorization server metadata",
  );
  const registration = await responseObject(
    await request.post(localTransportUrl(registrationEndpoint, baseURL), {
      data: {
        client_name: e2eMcp.clientName,
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [e2eMcp.redirectUri],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    }),
    201,
    "client registration",
  );
  const clientId = requiredString(
    registration,
    "client_id",
    "client registration",
  );
  expect(registration).toMatchObject({
    client_name: e2eMcp.clientName,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [e2eMcp.redirectUri],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Create the first administrator." }),
  ).toBeVisible();

  await page.getByLabel("Workspace name").fill(e2eAdministrator.workspaceName);
  await page.getByLabel("Display name").fill(e2eAdministrator.displayName);
  await page.getByLabel("Username").fill(e2eAdministrator.username);
  await page.getByLabel("Password").fill(e2eAdministrator.password);
  await page.getByLabel("One-time setup token").fill(e2eSetupToken);
  await page.getByRole("button", { name: "Create administrator" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Administrator created. Sign in with your new account.",
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace." }),
  ).toBeVisible();

  await page.getByLabel("Username").fill(e2eAdministrator.username);
  await page.getByLabel("Password").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("status")).toHaveText(
    `Welcome, ${e2eAdministrator.displayName}.`,
  );
  await expect(
    page.getByRole("heading", { name: "Your search, at a glance." }),
  ).toBeVisible();
  const dashboardHero = page.getByRole("region", {
    name: "Your search, at a glance.",
  });
  await expect(
    dashboardHero.getByRole("button", { name: "Log application" }),
  ).toBeVisible();

  await page.context().clearCookies();
  const callbackRequest = page.waitForRequest((candidate) =>
    candidate.url().startsWith(e2eMcp.redirectUri),
  );
  await page.route(`${e2eMcp.redirectUri}**`, async (route) => {
    await route.fulfill({
      body: "<!doctype html><title>OAuth callback captured</title>",
      contentType: "text/html",
      status: 200,
    });
  });

  const authorizationEndpoint = requiredString(
    authorizationMetadata,
    "authorization_endpoint",
    "authorization server metadata",
  );
  const authorizationUrl = new URL(
    localTransportUrl(authorizationEndpoint, baseURL),
  );
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set(
    "code_challenge",
    createHash("sha256").update(e2eMcp.verifier).digest("base64url"),
  );
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("redirect_uri", e2eMcp.redirectUri);
  authorizationUrl.searchParams.set("resource", e2eMcp.resourceUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", e2eMcp.scope);
  authorizationUrl.searchParams.set("state", e2eMcp.state);

  await page.goto(authorizationUrl.href);
  await expect(
    page.getByRole("heading", { name: "Sign in to Application Tracker" }),
  ).toBeVisible();
  await page.getByLabel("Username").fill(e2eAdministrator.username);
  await page.getByLabel("Password").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: `Authorize ${e2eMcp.clientName}` }),
  ).toBeVisible();
  await expect(page.getByText(e2eAdministrator.displayName)).toBeVisible();
  await page.getByLabel("Connection permission").selectOption("read_only");
  await page.getByRole("button", { name: "Authorize" }).click();

  const callbackUrl = new URL((await callbackRequest).url());
  expect(callbackUrl.searchParams.get("state")).toBe(e2eMcp.state);
  const authorizationCode = callbackUrl.searchParams.get("code");
  if (!authorizationCode) throw new Error("The callback omitted its code");

  const tokenEndpoint = requiredString(
    authorizationMetadata,
    "token_endpoint",
    "authorization server metadata",
  );
  const tokens = await responseObject(
    await request.post(localTransportUrl(tokenEndpoint, baseURL), {
      form: {
        client_id: clientId,
        code: authorizationCode,
        code_verifier: e2eMcp.verifier,
        grant_type: "authorization_code",
        redirect_uri: e2eMcp.redirectUri,
        resource: e2eMcp.resourceUrl,
      },
    }),
    200,
    "token response",
  );
  expect(tokens).toMatchObject({
    scope: e2eMcp.scope,
    token_type: "Bearer",
  });
  const accessToken = requiredString(tokens, "access_token", "token response");
  requiredString(tokens, "refresh_token", "token response");

  const initializationResponse = await request.post("/mcp", {
    data: {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "playwright-e2e", version: "1.0.0" },
        protocolVersion: "2025-11-25",
      },
    },
    headers: mcpHeaders(accessToken),
  });
  const initialization = await responseObject(
    initializationResponse,
    200,
    "MCP initialization",
  );
  expect(initialization).toMatchObject({
    id: 1,
    jsonrpc: "2.0",
    result: { protocolVersion: "2025-11-25" },
  });
  const sessionId = initializationResponse.headers()["mcp-session-id"];
  expect(sessionId).toBeTruthy();
  if (!sessionId) {
    throw new Error("MCP initialization omitted its session ID");
  }

  const notification = await request.post("/mcp", {
    data: { jsonrpc: "2.0", method: "notifications/initialized" },
    headers: mcpHeaders(accessToken, sessionId),
  });
  expect(notification.status()).toBe(202);

  const toolsResponse = await responseObject(
    await request.post("/mcp", {
      data: { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
      headers: mcpHeaders(accessToken, sessionId),
    }),
    200,
    "MCP tools response",
  );
  const toolsResult = record(toolsResponse.result, "MCP tools result");
  if (!Array.isArray(toolsResult.tools)) {
    throw new Error("MCP tools result must include tools");
  }
  const toolNames = toolsResult.tools.map((tool) =>
    requiredString(record(tool, "MCP tool"), "name", "MCP tool"),
  );
  expect(toolNames).toEqual(applicationMcpToolNames);

  const contextResponse = await responseObject(
    await request.post("/mcp", {
      data: {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "get_tracker_context" },
      },
      headers: mcpHeaders(accessToken, sessionId),
    }),
    200,
    "MCP tool response",
  );
  const contextResult = record(contextResponse.result, "MCP tool result");
  expect(contextResult.structuredContent).toEqual({
    access: "read_only",
    actor: {
      displayName: e2eAdministrator.displayName,
      role: "admin",
      username: e2eAdministrator.username,
    },
    workspace: { name: e2eAdministrator.workspaceName, slug: "default" },
  });

  const closed = await request.delete("/mcp", {
    headers: mcpHeaders(accessToken, sessionId),
  });
  expect(closed.status()).toBe(200);

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings navigation" })
    .getByRole("button", { name: "MCP" })
    .click();
  await expect(
    page.getByRole("heading", { name: "MCP connections." }),
  ).toBeVisible();
  const connection = page.getByRole("listitem", {
    name: `${e2eMcp.clientName}, Active`,
  });
  await expect(connection).toContainText(
    `OAuth · ${e2eAdministrator.displayName} · @${e2eAdministrator.username}`,
  );
  await expect(connection).toContainText("Read Only");
});
