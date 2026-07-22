import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import { applicationMcpToolNames } from "../src/application/mcp";
import {
  docxFixture,
  emlFixture,
  msgFixture,
  pdfFixture,
} from "./document_preview_fixtures";
import { e2eAdministrator, e2eMcp, e2eSetupToken } from "./fixtures";

let oauthCallbackServer: Server | undefined;

test.beforeAll(async () => {
  const callback = new URL(e2eMcp.redirectUri);
  oauthCallbackServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>OAuth callback captured</title>");
  });
  await new Promise<void>((resolve, reject) => {
    oauthCallbackServer?.once("error", reject);
    oauthCallbackServer?.listen(
      Number(callback.port),
      callback.hostname,
      () => {
        oauthCallbackServer?.off("error", reject);
        resolve();
      },
    );
  });
});

test.afterAll(async () => {
  if (!oauthCallbackServer) return;
  await new Promise<void>((resolve, reject) => {
    oauthCallbackServer?.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

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

function browserAuditTime(value: string): string {
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

async function uploadDocument(
  page: Page,
  file: { buffer: Buffer; mimeType: string; name: string },
): Promise<void> {
  await page.getByRole("button", { name: "Upload document" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a document" });
  await dialog.getByLabel("Choose file").setInputFiles(file);
  await dialog.getByRole("button", { name: "Store document" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText(
    `${file.name} was stored.`,
  );
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

function oauthAuthorizationUrl(
  authorizationEndpoint: string,
  baseURL: string,
  clientId: string,
  state: string,
): URL {
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
  authorizationUrl.searchParams.set("state", state);
  return authorizationUrl;
}

async function exchangeAuthorizationCode(
  request: APIRequestContext,
  tokenEndpoint: string,
  baseURL: string,
  clientId: string,
  authorizationCode: string,
): Promise<Record<string, unknown>> {
  return responseObject(
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
}

async function initializeMcp(
  request: APIRequestContext,
  accessToken: string,
  requestId: number,
): Promise<string> {
  const response = await request.post("/mcp", {
    data: {
      id: requestId,
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
  expect(
    await responseObject(response, 200, "MCP initialization"),
  ).toMatchObject({
    id: requestId,
    jsonrpc: "2.0",
    result: { protocolVersion: "2025-11-25" },
  });
  const sessionId = response.headers()["mcp-session-id"];
  expect(sessionId).toBeTruthy();
  if (!sessionId) throw new Error("MCP initialization omitted its session ID");
  return sessionId;
}

test("completes setup and the OAuth-to-MCP connection lifecycle", async ({
  baseURL,
  page,
  request,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");
  test.setTimeout(60_000);

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
  await expect(page.getByText("Installation", { exact: true })).toHaveCount(0);
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  await expect(
    page.getByRole("link", { name: "Application Tracker home" }),
  ).toHaveAttribute("href", "/");
  await expect(page.getByLabel("Username")).toHaveAttribute("name", "username");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "name",
    "password",
  );
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("form", { name: "Local account" })).toBeVisible();
  expect(
    await page.evaluate<number>("document.documentElement.scrollWidth"),
  ).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByLabel("Username").fill(e2eAdministrator.username);
  await page
    .getByLabel("Password", { exact: true })
    .fill(e2eAdministrator.password);
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

  await page.getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

  await uploadDocument(page, {
    buffer: Buffer.from('{"applications":[]}'),
    mimeType: "application/json",
    name: "browser-preview.json",
  });
  const jsonRow = page
    .getByRole("row")
    .filter({ hasText: "browser-preview.json" });
  await expect(jsonRow).toBeVisible();
  await expect(
    jsonRow.getByRole("button", { name: "Preview browser-preview.json" }),
  ).toHaveCount(0);

  await uploadDocument(page, {
    buffer: pdfFixture(),
    mimeType: "application/octet-stream",
    name: "browser-preview.pdf",
  });
  const pdfRow = page
    .getByRole("row")
    .filter({ hasText: "browser-preview.pdf" });
  const storedHeader = page.getByRole("columnheader", { name: "Stored" });
  const storedCell = pdfRow.getByRole("cell").nth(3);
  await expect(storedCell).toHaveCSS("display", "table-cell");
  const [storedHeaderBox, storedCellBox] = await Promise.all([
    storedHeader.boundingBox(),
    storedCell.boundingBox(),
  ]);
  expect(storedHeaderBox).not.toBeNull();
  expect(storedCellBox).not.toBeNull();
  expect(
    Math.abs((storedHeaderBox?.x ?? 0) - (storedCellBox?.x ?? 0)),
  ).toBeLessThan(1);
  expect(
    Math.abs((storedHeaderBox?.width ?? 0) - (storedCellBox?.width ?? 0)),
  ).toBeLessThan(1);
  const pdfView = page.waitForResponse((response) =>
    response.url().endsWith("/view"),
  );
  await page
    .getByRole("button", { name: "Preview browser-preview.pdf" })
    .click();
  const pdfDialog = page.getByRole("dialog", {
    name: "Preview browser-preview.pdf",
  });
  await expect(
    pdfDialog.getByTitle("Preview browser-preview.pdf"),
  ).toBeVisible();
  expect((await pdfView).status()).toBe(200);
  await pdfDialog.getByRole("button", { name: "Done" }).click();

  await uploadDocument(page, {
    buffer: docxFixture(),
    mimeType: "application/zip",
    name: "browser-preview.docx",
  });
  await page
    .getByRole("button", { name: "Preview browser-preview.docx" })
    .click();
  const docxDialog = page.getByRole("dialog", {
    name: "Preview browser-preview.docx",
  });
  await expect(docxDialog).toContainText("Application Tracker DOCX preview");
  await expect(docxDialog).toContainText("Second paragraph");
  await docxDialog.getByRole("button", { name: "Done" }).click();

  await uploadDocument(page, {
    buffer: emlFixture(),
    mimeType: "application/octet-stream",
    name: "browser-preview.eml",
  });
  await page
    .getByRole("button", { name: "Preview browser-preview.eml" })
    .click();
  const emlDialog = page.getByRole("dialog", {
    name: "Preview browser-preview.eml",
  });
  await expect(emlDialog).toContainText("Application Tracker EML preview");
  await expect(emlDialog).toContainText("Hiring Manager <hiring@example.test>");
  await expect(emlDialog).toContainText(
    "Your interview is scheduled for Tuesday.",
  );
  await emlDialog.getByRole("button", { name: "Done" }).click();

  await uploadDocument(page, {
    buffer: msgFixture(
      Array.from(
        { length: 32 },
        (_, index) => `Preview paragraph ${String(index + 1)}.`,
      ).join("\r\n\r\n\u00a0\r\n\r\n"),
    ),
    mimeType: "application/octet-stream",
    name: "browser-preview.msg",
  });
  await page
    .getByRole("button", { name: "Preview browser-preview.msg" })
    .click();
  const msgDialog = page.getByRole("dialog", {
    name: "Preview browser-preview.msg",
  });
  await expect(msgDialog).toContainText("Application Tracker MSG preview");
  await expect(msgDialog).toContainText("Preview paragraph 32.");
  const msgBody = msgDialog.locator("pre");
  expect(await msgBody.textContent()).not.toContain("\u00a0");
  expect(
    await msgDialog.evaluate(
      (dialog) => dialog.scrollHeight - dialog.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
  await expect(
    msgDialog.getByRole("button", { name: "Done" }),
  ).toBeInViewport();
  await msgDialog.getByRole("button", { name: "Done" }).click();

  await page.context().clearCookies();

  const authorizationEndpoint = requiredString(
    authorizationMetadata,
    "authorization_endpoint",
    "authorization server metadata",
  );
  const deniedAuthorizationUrl = oauthAuthorizationUrl(
    authorizationEndpoint,
    baseURL,
    clientId,
    e2eMcp.state,
  );

  await page.goto(deniedAuthorizationUrl.href);
  await expect(
    page.getByRole("heading", { name: "Sign in to Application Tracker" }),
  ).toBeVisible();
  const rejectedPassword = "e2e-rejected-password-value";
  await page.getByLabel("Username").fill(e2eAdministrator.username);
  await page.getByLabel("Password").fill(rejectedPassword);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("The username or password was not accepted.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(rejectedPassword);

  await page.getByLabel("Username").fill(e2eAdministrator.username);
  await page.getByLabel("Password").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: `Authorize ${e2eMcp.clientName}` }),
  ).toBeVisible();
  await expect(page.getByText(e2eAdministrator.displayName)).toBeVisible();
  const deniedCallbackRequest = page.waitForRequest((candidate) =>
    candidate.url().startsWith(e2eMcp.redirectUri),
  );
  await page.getByRole("button", { name: "Deny" }).click();

  const deniedCallbackUrl = new URL((await deniedCallbackRequest).url());
  expect(deniedCallbackUrl.searchParams.get("error")).toBe("access_denied");
  expect(deniedCallbackUrl.searchParams.get("state")).toBe(e2eMcp.state);
  expect(deniedCallbackUrl.searchParams.has("code")).toBe(false);
  expect(deniedCallbackUrl.href).not.toContain(rejectedPassword);
  await expect(page).toHaveTitle("OAuth callback captured");

  const approvedState = `${e2eMcp.state}-approved`;
  const approvedAuthorizationUrl = oauthAuthorizationUrl(
    authorizationEndpoint,
    baseURL,
    clientId,
    approvedState,
  );
  await page.goto(approvedAuthorizationUrl.href);
  await expect(
    page.getByRole("heading", { name: `Authorize ${e2eMcp.clientName}` }),
  ).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await page.getByLabel("Connection permission").selectOption("read_only");
  const callbackRequest = page.waitForRequest((candidate) =>
    candidate.url().startsWith(e2eMcp.redirectUri),
  );
  await page.getByRole("button", { name: "Authorize" }).click();

  const callbackUrl = new URL((await callbackRequest).url());
  expect(callbackUrl.searchParams.get("state")).toBe(approvedState);
  await expect(page).toHaveTitle("OAuth callback captured");
  const authorizationCode = callbackUrl.searchParams.get("code");
  if (!authorizationCode) throw new Error("The callback omitted its code");

  const tokenEndpoint = requiredString(
    authorizationMetadata,
    "token_endpoint",
    "authorization server metadata",
  );
  const tokens = await exchangeAuthorizationCode(
    request,
    tokenEndpoint,
    baseURL,
    clientId,
    authorizationCode,
  );
  expect(tokens).toMatchObject({
    scope: e2eMcp.scope,
    token_type: "Bearer",
  });
  const accessToken = requiredString(tokens, "access_token", "token response");
  const refreshToken = requiredString(
    tokens,
    "refresh_token",
    "token response",
  );

  const sessionId = await initializeMcp(request, accessToken, 1);

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

  const refreshedTokens = await responseObject(
    await request.post(localTransportUrl(tokenEndpoint, baseURL), {
      form: {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        resource: e2eMcp.resourceUrl,
      },
    }),
    200,
    "refreshed token response",
  );
  const refreshedAccessToken = requiredString(
    refreshedTokens,
    "access_token",
    "refreshed token response",
  );
  const refreshedRefreshToken = requiredString(
    refreshedTokens,
    "refresh_token",
    "refreshed token response",
  );
  const continuedSession = await request.post("/mcp", {
    data: { id: 4, jsonrpc: "2.0", method: "tools/list", params: {} },
    headers: mcpHeaders(refreshedAccessToken, sessionId),
  });
  expect(continuedSession.status()).toBe(200);

  const reusedRefresh = await request.post(
    localTransportUrl(tokenEndpoint, baseURL),
    {
      form: {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        resource: e2eMcp.resourceUrl,
      },
    },
  );
  expect(reusedRefresh.status()).toBe(400);
  const reusedRefreshBody = JSON.stringify(await reusedRefresh.json());
  expect(reusedRefreshBody).toContain("invalid_grant");
  expect(reusedRefreshBody).not.toContain(refreshToken);

  const closed = await request.delete("/mcp", {
    headers: mcpHeaders(refreshedAccessToken, sessionId),
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
  const initialSettingsStatus = await responseObject(
    await page.request.get("/api/settings/mcp"),
    200,
    "initial MCP settings status",
  );
  const initialStatus = record(
    initialSettingsStatus.status,
    "initial MCP settings status.status",
  );
  const initialClients = record(
    initialStatus.clients,
    "initial MCP settings status clients",
  );
  if (!Array.isArray(initialClients.oauthClients)) {
    throw new Error("Initial MCP settings status must include OAuth clients");
  }
  const initialOAuthConnection = initialClients.oauthClients
    .map((value) => record(value, "initial OAuth connection"))
    .find((value) => value.clientId === clientId);
  if (!initialOAuthConnection) {
    throw new Error("The initial OAuth connection was not listed");
  }
  const actorUserId = requiredString(
    record(initialOAuthConnection.actor, "initial OAuth connection actor"),
    "id",
    "initial OAuth connection actor",
  );
  const createdAt = requiredString(
    initialOAuthConnection,
    "createdAt",
    "initial OAuth connection",
  );
  const lastUsedAt = requiredString(
    initialOAuthConnection,
    "lastUsedAt",
    "initial OAuth connection",
  );
  await expect(connection).toContainText(
    `OAuth · ${e2eAdministrator.displayName} · @${e2eAdministrator.username}`,
  );
  await expect(connection).toContainText("Read Only");
  await expect(connection).toContainText("Active");
  await expect(connection).toContainText("Created");
  await expect(connection).toContainText(browserAuditTime(createdAt));
  await expect(connection).toContainText("Last used");
  await expect(connection).toContainText(browserAuditTime(lastUsedAt));

  const revokedSessionId = await initializeMcp(
    request,
    refreshedAccessToken,
    10,
  );
  const revocationEndpoint = requiredString(
    authorizationMetadata,
    "revocation_endpoint",
    "authorization server metadata",
  );
  const revoked = await request.post(
    localTransportUrl(revocationEndpoint, baseURL),
    {
      form: {
        client_id: clientId,
        token: refreshedRefreshToken,
      },
    },
  );
  expect(revoked.status()).toBe(200);
  const rejectedRevokedSession = await responseObject(
    await request.post("/mcp", {
      data: { id: 11, jsonrpc: "2.0", method: "tools/list", params: {} },
      headers: mcpHeaders(refreshedAccessToken, revokedSessionId),
    }),
    401,
    "revoked MCP session response",
  );
  expect(rejectedRevokedSession).toEqual({
    error: { code: "invalid_token" },
  });
  expect(JSON.stringify(rejectedRevokedSession)).not.toContain(
    refreshedAccessToken,
  );

  const deletionState = `${e2eMcp.state}-delete`;
  await page.goto(
    oauthAuthorizationUrl(
      authorizationEndpoint,
      baseURL,
      clientId,
      deletionState,
    ).href,
  );
  await expect(
    page.getByRole("heading", { name: `Authorize ${e2eMcp.clientName}` }),
  ).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  const deletionCallbackRequest = page.waitForRequest((candidate) =>
    candidate.url().startsWith(e2eMcp.redirectUri),
  );
  await page.getByRole("button", { name: "Authorize" }).click();
  const deletionCallbackUrl = new URL((await deletionCallbackRequest).url());
  expect(deletionCallbackUrl.searchParams.get("state")).toBe(deletionState);
  await expect(page).toHaveTitle("OAuth callback captured");
  const deletionAuthorizationCode =
    deletionCallbackUrl.searchParams.get("code");
  if (!deletionAuthorizationCode) {
    throw new Error("The deletion callback omitted its code");
  }
  const deletionTokens = await exchangeAuthorizationCode(
    request,
    tokenEndpoint,
    baseURL,
    clientId,
    deletionAuthorizationCode,
  );
  const deletionAccessToken = requiredString(
    deletionTokens,
    "access_token",
    "deletion token response",
  );
  const deletionSessionId = await initializeMcp(
    request,
    deletionAccessToken,
    20,
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings navigation" })
    .getByRole("button", { name: "MCP" })
    .click();
  await expect(
    page.getByRole("heading", { name: "MCP connections." }),
  ).toBeVisible();
  const managedConnection = page.getByRole("listitem", {
    name: `${e2eMcp.clientName}, Active`,
  });
  await expect(managedConnection).toBeVisible();

  const deletionPath = `/api/settings/mcp/oauth-clients/${clientId}/users/${actorUserId}`;
  await page.route(
    (url) => url.pathname === deletionPath,
    async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "temporary_failure" } }),
        contentType: "application/json",
        status: 503,
      });
    },
    { times: 1 },
  );
  await managedConnection
    .getByRole("button", { name: `Delete ${e2eMcp.clientName}` })
    .click();
  await expect(
    managedConnection.getByRole("button", {
      name: `Confirm deletion of ${e2eMcp.clientName}`,
    }),
  ).toBeVisible();
  const failedDeletionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === deletionPath &&
      response.request().method() === "DELETE",
  );
  await managedConnection
    .getByRole("button", {
      name: `Confirm deletion of ${e2eMcp.clientName}`,
    })
    .click();
  expect((await failedDeletionResponse).status()).toBe(503);
  await expect(page.getByRole("alert")).toHaveText(
    "The MCP client change could not be saved. Existing credentials are unchanged.",
  );
  await expect(managedConnection).toBeVisible();
  expect(
    (
      await request.post("/mcp", {
        data: { id: 21, jsonrpc: "2.0", method: "tools/list", params: {} },
        headers: mcpHeaders(deletionAccessToken, deletionSessionId),
      })
    ).status(),
  ).toBe(200);

  await managedConnection
    .getByRole("button", { name: `Delete ${e2eMcp.clientName}` })
    .click();
  const deletionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === deletionPath &&
      response.request().method() === "DELETE",
  );
  await managedConnection
    .getByRole("button", {
      name: `Confirm deletion of ${e2eMcp.clientName}`,
    })
    .click();
  expect((await deletionResponse).status()).toBe(200);
  await expect(managedConnection).toHaveCount(0);
  await expect(
    page.getByText("No HTTPS connections have been authorized or created yet."),
  ).toBeVisible();

  const rejectedDeletedSession = await responseObject(
    await request.post("/mcp", {
      data: { id: 22, jsonrpc: "2.0", method: "tools/list", params: {} },
      headers: mcpHeaders(deletionAccessToken, deletionSessionId),
    }),
    401,
    "deleted MCP session response",
  );
  expect(rejectedDeletedSession).toEqual({
    error: { code: "invalid_token" },
  });
  expect(JSON.stringify(rejectedDeletedSession)).not.toContain(
    deletionAccessToken,
  );
});
