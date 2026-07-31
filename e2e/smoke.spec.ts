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

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole("form", { name: "Local account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeInViewport();
  expect(
    await page.evaluate<number>("document.documentElement.scrollWidth"),
  ).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("/documents");
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documents" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/documents$/);
  await page.goto("/");

  await page.getByLabel("Username").fill(e2eAdministrator.username);
  await page
    .getByLabel("Password", { exact: true })
    .fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("status")).toHaveText(
    `Welcome, ${e2eAdministrator.displayName}.`,
  );
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  const dashboardHero = page.getByRole("region", {
    name: "Today",
  });
  await expect(
    dashboardHero.getByRole("button", { name: "Log application" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Opportunities" }).click();
  await expect(
    page.getByRole("heading", { name: "Opportunities", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/opportunities$/);

  await page
    .getByRole("button")
    .filter({ hasText: /^Log application$/ })
    .click();
  const applicationDialog = page.getByRole("dialog", {
    name: "Log an application",
  });
  await applicationDialog.getByLabel("End company").fill("Example Studio");
  await applicationDialog.getByLabel("Agency").fill("Example Recruitment");
  await applicationDialog.getByLabel("Role title").fill("Product Designer");
  await applicationDialog.getByLabel("Applied date").fill("2026-07-24");
  await applicationDialog
    .getByLabel("Salary", { exact: true })
    .fill("£70,000–£80,000");
  await applicationDialog.getByLabel("Salary currency").fill("GBP");
  await applicationDialog.getByLabel("Salary period").selectOption("annual");
  await applicationDialog.getByLabel("Minimum salary").fill("70000");
  await applicationDialog.getByLabel("Maximum salary").fill("80000");
  await applicationDialog.getByLabel("Rating").selectOption("4");
  await applicationDialog.getByLabel("Location").fill("London");
  await applicationDialog.getByLabel("Work arrangement").selectOption("hybrid");
  await applicationDialog
    .getByLabel("Original arrangement wording")
    .fill("Two days in the London office");
  await applicationDialog.getByLabel("Office days per week").fill("2");
  await applicationDialog.getByLabel("Remote days per week").fill("3");
  await applicationDialog
    .getByRole("button", { name: "Save application" })
    .click();

  const opportunitiesTable = page.getByRole("table", {
    name: "Opportunities",
  });
  await expect(
    opportunitiesTable.getByRole("columnheader", {
      name: /End company \/ role/,
    }),
  ).toBeVisible();
  await expect(
    opportunitiesTable.getByRole("columnheader", { name: /Agency/ }),
  ).toBeVisible();
  await expect(
    opportunitiesTable.getByRole("columnheader", {
      name: /Work arrangement/,
    }),
  ).toBeVisible();
  const appliedOpportunity = opportunitiesTable
    .getByRole("row")
    .filter({ hasText: "Example Studio" });
  await expect(appliedOpportunity).toContainText("Example Recruitment");
  await expect(appliedOpportunity).toContainText("£70,000–£80,000");
  await expect(appliedOpportunity).toContainText("Hybrid");
  await expect(appliedOpportunity).toContainText("In pipeline");

  await appliedOpportunity
    .getByRole("button", { name: "Open Example Studio" })
    .click();
  const applicationDrawer = page.getByRole("dialog", {
    name: "Product Designer",
  });
  await expect(
    applicationDrawer.getByRole("heading", { name: "Activity" }),
  ).toBeVisible();
  await expect(
    applicationDrawer.getByText("Application created"),
  ).toBeVisible();
  await expect(
    applicationDrawer.getByText(/GBP 70000–80000 annual/),
  ).toBeVisible();
  await expect(
    applicationDrawer.getByText(/Two days in the London office/),
  ).toBeVisible();
  await applicationDrawer
    .getByRole("button", { name: "Record activity" })
    .click();
  await applicationDrawer
    .getByLabel("Activity type")
    .selectOption("recruiter_contact");
  await applicationDrawer
    .getByLabel("Concise summary")
    .fill("Recruiter called to discuss the position");
  await applicationDrawer
    .getByRole("button", { name: "Record activity" })
    .click();
  await expect(
    applicationDrawer.getByText("Recruiter called to discuss the position"),
  ).toBeVisible();
  await expect(applicationDrawer.getByText("Activity recorded.")).toBeVisible();
  await applicationDrawer
    .getByRole("button", { name: "Close application details" })
    .click();
  await expect(applicationDrawer).toBeHidden();
  await expect(appliedOpportunity).toContainText("In pipeline");

  // Android Chrome leaves a 320 × 458 CSS-pixel content viewport on a
  // 320 × 568 device while its browser chrome is visible.
  await page.setViewportSize({ width: 320, height: 458 });
  expect(
    await page.evaluate<number>("document.documentElement.scrollWidth"),
  ).toBeLessThanOrEqual(320);
  const mobileNavigation = page.locator(".workspace-tab-button");
  await expect(mobileNavigation).toHaveCount(5);
  const mobileNavigationRows = await mobileNavigation.evaluateAll((buttons) =>
    buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
  );
  expect(new Set(mobileNavigationRows).size).toBe(1);
  for (const navigationButton of await mobileNavigation.all()) {
    await expect(navigationButton).toBeInViewport();
  }
  await expect(
    page.getByRole("list", { name: "Opportunities mobile records" }),
  ).toBeVisible();
  await expect(opportunitiesTable).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Sort Opportunities" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search opportunities…")).toBeVisible();
  const mobileOpportunity = page.getByRole("button", {
    name: "Open Example Studio · Product Designer",
  });
  await expect(mobileOpportunity).toBeInViewport();
  const mobileNavigationBox = await page
    .locator(".workspace-sidebar nav")
    .boundingBox();
  const mobileOpportunityBox = await mobileOpportunity.boundingBox();
  expect(mobileNavigationBox).not.toBeNull();
  expect(mobileOpportunityBox).not.toBeNull();
  expect(mobileOpportunityBox!.y).toBeLessThanOrEqual(
    mobileNavigationBox!.y - 44,
  );
  const mobileTouchTargetHeights = await page
    .locator(
      ".tracker-page-actions button, .tracker-mobile-register-tools select, .tracker-mobile-filter-row button",
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(Math.min(...mobileTouchTargetHeights)).toBeGreaterThanOrEqual(44);
  await page
    .locator(".tracker-mobile-filter-row")
    .getByRole("button", { name: "Stage" })
    .click();
  const mobileStageFilter = page.getByRole("dialog", {
    name: "Filter Stage",
  });
  await expect(mobileStageFilter).toBeInViewport();
  const mobileStageFilterBox = await mobileStageFilter.boundingBox();
  expect(mobileStageFilterBox).not.toBeNull();
  const mobileFilterNavigationGap =
    mobileNavigationBox!.y -
    (mobileStageFilterBox!.y + mobileStageFilterBox!.height);
  expect(mobileFilterNavigationGap).toBeGreaterThanOrEqual(0);
  expect(mobileFilterNavigationGap).toBeLessThanOrEqual(16);
  await expect(
    mobileStageFilter.getByRole("button", { name: "Done" }),
  ).toBeInViewport();
  await mobileStageFilter.getByRole("button", { name: "Done" }).click();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(
    page.getByRole("list", { name: "Opportunities mobile records" }),
  ).toBeVisible();
  await expect(opportunitiesTable).toBeHidden();
  const landscapeNavigationColumns = await mobileNavigation.evaluateAll(
    (buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().left)),
  );
  const landscapeNavigationRows = await mobileNavigation.evaluateAll(
    (buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
  );
  expect(new Set(landscapeNavigationColumns).size).toBe(1);
  expect(new Set(landscapeNavigationRows).size).toBe(5);
  for (const navigationButton of await mobileNavigation.all()) {
    await expect(navigationButton).toBeInViewport();
  }

  // A 568 × 320 Android screen can expose a content viewport as short as
  // 216 CSS pixels. Keep every destination reachable in that state.
  await page.setViewportSize({ width: 568, height: 216 });
  const shortLandscapeNavigationColumns = await mobileNavigation.evaluateAll(
    (buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().left)),
  );
  const shortLandscapeNavigationRows = await mobileNavigation.evaluateAll(
    (buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
  );
  expect(new Set(shortLandscapeNavigationColumns).size).toBe(5);
  expect(new Set(shortLandscapeNavigationRows).size).toBe(1);
  for (const navigationButton of await mobileNavigation.all()) {
    await expect(navigationButton).toBeInViewport();
  }
  await expect(
    page.getByRole("list", { name: "Opportunities mobile records" }),
  ).toBeVisible();
  await expect(opportunitiesTable).toBeHidden();

  await page.setViewportSize({ width: 320, height: 458 });
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Applications mobile records" }),
  ).toBeVisible();
  const deferredDashboardCard = page
    .getByRole("list", { name: "Applications mobile records" })
    .getByRole("button", {
      name: "Open Example Studio · Product Designer",
    });
  await deferredDashboardCard.scrollIntoViewIfNeeded();
  const deferredDashboardCardBox = await deferredDashboardCard.boundingBox();
  expect(deferredDashboardCardBox).not.toBeNull();
  expect(deferredDashboardCardBox!.x).toBeGreaterThanOrEqual(0);
  expect(
    deferredDashboardCardBox!.x + deferredDashboardCardBox!.width,
  ).toBeLessThanOrEqual(320);
  expect(await page.evaluate<number>("window.scrollY")).toBe(0);
  expect(
    await page.evaluate<number>("document.documentElement.scrollWidth"),
  ).toBeLessThanOrEqual(320);

  await page.getByRole("button", { name: "Applications", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Applications mobile records" }),
  ).toBeVisible();
  expect(await page.evaluate<number>("window.scrollY")).toBe(0);
  expect(
    await page.evaluate<number>("document.documentElement.scrollWidth"),
  ).toBeLessThanOrEqual(320);
  await page
    .getByRole("button", { name: "Opportunities", exact: true })
    .click();

  // A 2048px-wide browser at 140% zoom has an effective viewport of 1463px.
  // Keep the full register, including its final columns, within that width.
  await page.setViewportSize({ width: 1463, height: 731 });
  const opportunitiesTableShell = opportunitiesTable.locator("..");
  const tableWidths = await opportunitiesTableShell.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(tableWidths.scrollWidth).toBeLessThanOrEqual(tableWidths.clientWidth);
  await expect(
    opportunitiesTable.getByRole("columnheader", { name: /Updated/ }),
  ).toBeInViewport();
  await expect(
    appliedOpportunity.getByRole("button", { name: "Open Example Studio" }),
  ).toBeInViewport();
  const companyFontSize = await appliedOpportunity
    .getByText("Example Studio")
    .evaluate((element) =>
      Number.parseFloat(
        element.ownerDocument.defaultView?.getComputedStyle(element).fontSize ??
          "0",
      ),
    );
  expect(companyFontSize).toBeGreaterThanOrEqual(14);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page
    .getByRole("button", { name: "Log application", exact: true })
    .click();
  await applicationDialog.getByLabel("End company").fill("Prospect Company");
  await applicationDialog.getByLabel("Role title").fill("Software Engineer");
  await applicationDialog
    .getByRole("button", { name: "Save application" })
    .click();
  await expect(opportunitiesTable).toContainText("Prospect Company");
  await opportunitiesTable
    .getByRole("button", { name: "Filter Location" })
    .click();
  const locationFilter = page.getByRole("dialog", {
    name: "Filter Location",
  });
  await locationFilter.getByRole("checkbox", { name: /^London/ }).check();
  await expect(opportunitiesTable).toContainText("Example Studio");
  await expect(opportunitiesTable).not.toContainText("Prospect Company");
  await locationFilter.getByRole("button", { name: "Clear" }).click();
  await locationFilter.getByRole("button", { name: "Done" }).click();
  await expect(opportunitiesTable).toContainText("Prospect Company");

  await page.getByRole("button", { name: "Applications", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Applications", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/applications$/);
  const applicationsTable = page.getByRole("table", { name: "Applications" });
  await expect(applicationsTable).toContainText("Example Studio");
  await expect(applicationsTable).not.toContainText("Prospect Company");
  await expect(
    applicationsTable.getByRole("button", { name: "Filter Stage" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Log application", exact: true })
    .click();
  await applicationDialog.getByLabel("End company").fill("Example Studio");
  await applicationDialog.getByLabel("Agency").fill("Example Recruitment");
  await applicationDialog.getByLabel("Role title").fill("Product Designer");
  await applicationDialog.getByLabel("Applied date").fill("2026-07-24");
  await applicationDialog
    .getByLabel("Salary", { exact: true })
    .fill("£70,000–£80,000");
  await applicationDialog.getByLabel("Rating").selectOption("4");
  await applicationDialog.getByLabel("Location").fill("London");
  await applicationDialog.getByLabel("Work arrangement").selectOption("hybrid");
  await applicationDialog
    .getByRole("button", { name: "Save application" })
    .click();
  await expect(
    applicationsTable.getByRole("row").filter({ hasText: "Example Studio" }),
  ).toHaveCount(2);

  await page.getByRole("button", { name: "Review duplicates" }).click();
  const duplicateDialog = page.getByRole("dialog", {
    name: "Review duplicate applications",
  });
  await expect(duplicateDialog).toHaveAttribute("aria-modal", "true");
  await expect(
    duplicateDialog.getByRole("button", {
      name: "Close duplicate application review",
    }),
  ).toBeFocused();
  await expect(duplicateDialog.getByText("probable match")).toBeVisible();
  await duplicateDialog
    .getByRole("button", { name: "Keep this record" })
    .nth(1)
    .click();
  await expect(
    duplicateDialog.getByRole("heading", {
      name: "Keep Example Studio · Product Designer",
    }),
  ).toBeVisible();
  await expect(
    duplicateDialog.getByText("Source events retained"),
  ).toBeVisible();
  await duplicateDialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Example Studio duplicates were merged safely.",
    }),
  ).toBeVisible();
  await expect(duplicateDialog).toHaveCount(0);
  await expect(
    applicationsTable.getByRole("row").filter({ hasText: "Example Studio" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Applications", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/applications$/);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page).toHaveURL(/\/documents$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page).toHaveURL(/\/documents$/);

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

  await page.setViewportSize({ width: 320, height: 458 });
  await expect(
    page.locator(".documents-page .tracker-page-header p"),
  ).toBeHidden();
  const documentMetrics = page.locator(".document-metrics article");
  const documentMetricRows = await documentMetrics.evaluateAll((metrics) =>
    metrics.map((metric) => Math.round(metric.getBoundingClientRect().top)),
  );
  expect(new Set(documentMetricRows).size).toBe(1);
  const documentMetricsBox = await page
    .locator(".document-metrics")
    .boundingBox();
  expect(documentMetricsBox).not.toBeNull();
  expect(documentMetricsBox!.height).toBeLessThanOrEqual(100);
  await expect(page.locator(".document-table-scroll")).toBeHidden();
  await expect(page.locator(".document-table-scroll")).toHaveCount(0);
  const mobileDocuments = page.getByRole("list", {
    name: "Documents mobile records",
  });
  await expect(mobileDocuments).toBeVisible();
  await expect(
    mobileDocuments.getByText("browser-preview.pdf", { exact: true }),
  ).toBeVisible();
  const mobileDocumentActionHeights = await mobileDocuments
    .locator("button, a")
    .evaluateAll((actions) =>
      actions.map((action) => action.getBoundingClientRect().height),
    );
  expect(Math.min(...mobileDocumentActionHeights)).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate<number>("document.documentElement.scrollWidth"),
  ).toBeLessThanOrEqual(320);

  await page.setViewportSize({ width: 758, height: 256 });
  const shortLandscapeMetrics = page.locator(".document-metrics");
  const shortLandscapeNavigation = page.locator(".workspace-sidebar nav");
  const shortLandscapeMetricsBox = await shortLandscapeMetrics.boundingBox();
  const shortLandscapeNavigationBox =
    await shortLandscapeNavigation.boundingBox();
  expect(shortLandscapeMetricsBox).not.toBeNull();
  expect(shortLandscapeNavigationBox).not.toBeNull();
  expect(
    shortLandscapeMetricsBox!.y + shortLandscapeMetricsBox!.height,
  ).toBeLessThanOrEqual(shortLandscapeNavigationBox!.y);
  await expect(
    page.getByRole("list", { name: "Documents mobile records" }),
  ).toBeVisible();
  expect(
    await page.evaluate<number>("document.documentElement.scrollWidth"),
  ).toBeLessThanOrEqual(758);
  await page.setViewportSize({ width: 1280, height: 720 });

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
    .getByRole("button", { name: "Connections" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connections.", exact: true }),
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
    .getByRole("button", { name: "Connections" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connections.", exact: true }),
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
  await expect(
    page.getByText(
      "The MCP client change could not be saved. Existing credentials are unchanged.",
      { exact: true },
    ),
  ).toBeVisible();
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

type MobileAuditRoute = {
  heading: string;
  path: string;
  ready: string;
  slug: string;
};

type MobileViewportProfile = {
  chrome: "collapsed" | "expanded";
  height: number;
  orientation: "landscape" | "portrait";
  screen: "compact" | "tall";
  slug: string;
  width: number;
};

const mobileAuditRoutes: ReadonlyArray<MobileAuditRoute> = [
  {
    heading: "Today",
    path: "/dashboard",
    ready: ".today-layout",
    slug: "dashboard",
  },
  {
    heading: "Applications",
    path: "/applications",
    ready: ".applications-page",
    slug: "applications",
  },
  {
    heading: "Opportunities",
    path: "/opportunities",
    ready: ".applications-page",
    slug: "opportunities",
  },
  {
    heading: "Documents",
    path: "/documents",
    ready: ".documents-page",
    slug: "documents",
  },
  {
    heading: "Workspace vocabulary.",
    path: "/settings/lists",
    ready: ".lists-workspace",
    slug: "settings-lists",
  },
  {
    heading: "Connections.",
    path: "/settings/mcp",
    ready: ".mcp-workspace",
    slug: "settings-mcp",
  },
  {
    heading: "People and access.",
    path: "/settings/users",
    ready: ".users-workspace",
    slug: "settings-users",
  },
];

const auditedMobileWidths = [320, 360, 390, 412, 430] as const;

function mobileViewportProfiles(): MobileViewportProfile[] {
  return auditedMobileWidths.flatMap((width) => [
    {
      chrome: "expanded",
      height: 458,
      orientation: "portrait",
      screen: "compact",
      slug: `${String(width)}-portrait-compact-toolbar-expanded`,
      width,
    },
    {
      chrome: "collapsed",
      height: 568,
      orientation: "portrait",
      screen: "compact",
      slug: `${String(width)}-portrait-compact-toolbar-collapsed`,
      width,
    },
    {
      chrome: "expanded",
      height: 822,
      orientation: "portrait",
      screen: "tall",
      slug: `${String(width)}-portrait-tall-toolbar-expanded`,
      width,
    },
    {
      chrome: "collapsed",
      height: 932,
      orientation: "portrait",
      screen: "tall",
      slug: `${String(width)}-portrait-tall-toolbar-collapsed`,
      width,
    },
    {
      chrome: "expanded",
      height: Math.max(216, width - 104),
      orientation: "landscape",
      screen: "compact",
      slug: `${String(width)}-landscape-compact-toolbar-expanded`,
      width: 568,
    },
    {
      chrome: "collapsed",
      height: width,
      orientation: "landscape",
      screen: "compact",
      slug: `${String(width)}-landscape-compact-toolbar-collapsed`,
      width: 568,
    },
    {
      chrome: "expanded",
      height: Math.max(216, width - 104),
      orientation: "landscape",
      screen: "tall",
      slug: `${String(width)}-landscape-tall-toolbar-expanded`,
      width: 932,
    },
    {
      chrome: "collapsed",
      height: width,
      orientation: "landscape",
      screen: "tall",
      slug: `${String(width)}-landscape-tall-toolbar-collapsed`,
      width: 932,
    },
  ]);
}

async function authenticateMobileAudit(page: Page): Promise<void> {
  const setupStatus = await page.request.get("/api/setup/status");
  expect(setupStatus.status()).toBe(200);
  const setup = (await setupStatus.json()) as { required?: boolean };
  if (setup.required) {
    const setupResponse = await page.request.post("/api/setup", {
      data: {
        displayName: e2eAdministrator.displayName,
        password: e2eAdministrator.password,
        setupToken: e2eSetupToken,
        username: e2eAdministrator.username,
        workspaceName: e2eAdministrator.workspaceName,
      },
    });
    expect(setupResponse.status()).toBe(201);
  }
  const login = await page.request.post("/api/auth/login", {
    data: {
      password: e2eAdministrator.password,
      username: e2eAdministrator.username,
    },
  });
  expect(login.status()).toBe(200);
}

async function ensureMobileAuditData(page: Page): Promise<void> {
  const applicationsResponse = await page.request.get("/api/applications");
  expect(applicationsResponse.status()).toBe(200);
  const applicationsBody = record(
    await applicationsResponse.json(),
    "mobile audit applications",
  );
  if (!Array.isArray(applicationsBody.applications)) {
    throw new Error("mobile audit applications must contain an array");
  }
  const applications: unknown[] = applicationsBody.applications;
  const companyNames = new Set(
    applications.map((application) =>
      requiredString(
        record(application, "mobile audit application"),
        "companyName",
        "mobile audit application",
      ),
    ),
  );

  if (
    !companyNames.has("Example Studio") ||
    !companyNames.has("Prospect Company")
  ) {
    await page.goto("/opportunities");
    await expect(
      page.getByRole("heading", { name: "Opportunities", exact: true }),
    ).toBeVisible();
    const applicationDialog = page.getByRole("dialog", {
      name: "Log an application",
    });

    if (!companyNames.has("Prospect Company")) {
      await page
        .getByRole("button", { name: "Log application" })
        .first()
        .click();
      await applicationDialog
        .getByLabel("End company")
        .fill("Prospect Company");
      await applicationDialog
        .getByLabel("Role title")
        .fill("Software Engineer");
      await applicationDialog
        .getByRole("button", { name: "Save application" })
        .click();
      await expect(applicationDialog).toBeHidden();
    }

    if (!companyNames.has("Example Studio")) {
      await page
        .getByRole("button", { name: "Log application", exact: true })
        .click();
      await applicationDialog.getByLabel("End company").fill("Example Studio");
      await applicationDialog.getByLabel("Agency").fill("Example Recruitment");
      await applicationDialog.getByLabel("Role title").fill("Product Designer");
      await applicationDialog.getByLabel("Applied date").fill("2026-07-24");
      await applicationDialog
        .getByLabel("Salary", { exact: true })
        .fill("£70,000–£80,000");
      await applicationDialog.getByLabel("Rating").selectOption("4");
      await applicationDialog.getByLabel("Location").fill("London");
      await applicationDialog
        .getByLabel("Work arrangement")
        .selectOption("hybrid");
      await applicationDialog
        .getByRole("button", { name: "Save application" })
        .click();
      await expect(applicationDialog).toBeHidden();
    }
  }

  const refreshedApplicationsResponse =
    await page.request.get("/api/applications");
  expect(refreshedApplicationsResponse.status()).toBe(200);
  const refreshedApplicationsBody = record(
    await refreshedApplicationsResponse.json(),
    "refreshed mobile audit applications",
  );
  if (!Array.isArray(refreshedApplicationsBody.applications)) {
    throw new Error(
      "refreshed mobile audit applications must contain an array",
    );
  }
  const exampleStudio = refreshedApplicationsBody.applications
    .map((application) =>
      record(application, "refreshed mobile audit application"),
    )
    .find((application) => application.companyName === "Example Studio");
  if (!exampleStudio) {
    throw new Error("Example Studio is missing from the mobile audit fixture");
  }
  const exampleStudioId = requiredString(
    exampleStudio,
    "id",
    "refreshed mobile audit application",
  );
  const exampleStudioUpdatedAt = requiredString(
    exampleStudio,
    "updatedAt",
    "refreshed mobile audit application",
  );
  const refreshExampleStudio = await page.request.patch(
    `/api/applications/${encodeURIComponent(exampleStudioId)}`,
    {
      data: {
        companyName: "Example Studio",
        expectedUpdatedAt: exampleStudioUpdatedAt,
      },
      headers: {
        Origin: new URL(refreshedApplicationsResponse.url()).origin,
      },
    },
  );
  expect(refreshExampleStudio.status()).toBe(200);

  const documentsResponse = await page.request.get("/api/documents");
  expect(documentsResponse.status()).toBe(200);
  const documentsBody = record(
    await documentsResponse.json(),
    "mobile audit documents",
  );
  if (!Array.isArray(documentsBody.documents)) {
    throw new Error("mobile audit documents must contain an array");
  }
  const documents: unknown[] = documentsBody.documents;
  const documentNames = new Set(
    documents.map((document) =>
      requiredString(
        record(document, "mobile audit document"),
        "originalFilename",
        "mobile audit document",
      ),
    ),
  );
  const mobileAuditDocuments = [
    {
      buffer: Buffer.from('{"applications":[]}'),
      mimeType: "application/json",
      name: "browser-preview.json",
    },
    {
      buffer: pdfFixture(),
      mimeType: "application/octet-stream",
      name: "browser-preview.pdf",
    },
    {
      buffer: docxFixture(),
      mimeType: "application/zip",
      name: "browser-preview.docx",
    },
    {
      buffer: emlFixture(),
      mimeType: "application/octet-stream",
      name: "browser-preview.eml",
    },
    {
      buffer: msgFixture(
        Array.from(
          { length: 32 },
          (_, index) => `Preview paragraph ${String(index + 1)}.`,
        ).join("\r\n\r\n\u00a0\r\n\r\n"),
      ),
      mimeType: "application/octet-stream",
      name: "browser-preview.msg",
    },
  ];
  if (mobileAuditDocuments.some(({ name }) => !documentNames.has(name))) {
    await page.goto("/documents");
    await expect(
      page.getByRole("heading", { name: "Documents" }),
    ).toBeVisible();
    for (const document of mobileAuditDocuments) {
      if (!documentNames.has(document.name)) {
        await uploadDocument(page, document);
      }
    }
  }
}

async function openMobileAuditRoute(
  page: Page,
  route: MobileAuditRoute,
): Promise<void> {
  await page.goto(route.path);
  await expect(
    page.getByRole("heading", { name: route.heading, exact: true }),
  ).toBeVisible();
  await expect(page.locator(route.ready)).toBeVisible();
  await page.evaluate("document.fonts.ready");
}

type MobileGeometryAudit = {
  clipped: string[];
  rootOverflow: number;
  touchTargets: string[];
};

type MobileNavigationMetric = {
  ariaLabel: string;
  button: {
    height: number;
    width: number;
  };
  labelOffset: number;
  mobileLabel: string | null;
  numberOffset: number;
  sourceFontSize: string;
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    letterSpacing: string;
    lineHeight: string;
  };
};

const mobileGeometryAuditScript = String.raw`
  (() => {
    const root = document.documentElement;
    const viewportWidth = window.innerWidth;
    const interactiveSelector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "summary",
      "textarea",
      "[role='button']",
    ].join(",");
    const clippingSelector = [
      "button",
      "h1",
      "input",
      "select",
      "textarea",
      "[role='dialog']",
      ".document-mobile-list",
      ".settings-navigation",
      ".tracker-mobile-register",
    ].join(",");

    function visible(element) {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        box.width > 0 &&
        box.height > 0 &&
        box.bottom >= -1 &&
        box.top <= window.innerHeight + 1
      );
    }

    function labelFor(element) {
      return (
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        (element.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60) ||
        element.tagName.toLocaleLowerCase()
      );
    }

    function horizontallyScrollableAncestor(element) {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          ancestor.scrollWidth > ancestor.clientWidth
        ) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    }

    const clipped = [...document.querySelectorAll(clippingSelector)]
      .filter(visible)
      .filter((element) => !horizontallyScrollableAncestor(element))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > viewportWidth + 1;
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        return (
          element.tagName.toLocaleLowerCase() +
          ' "' +
          labelFor(element) +
          '" (' +
          box.left.toFixed(1) +
          ".." +
          box.right.toFixed(1) +
          ")"
        );
      });

    const touchTargets = [...document.querySelectorAll(interactiveSelector)]
      .filter(visible)
      .filter((element) => !element.closest(".sr-only"))
      .flatMap((element) => {
        const input =
          element instanceof HTMLInputElement ? element : undefined;
        const target =
          input &&
          (input.type === "checkbox" || input.type === "radio") &&
          input.closest("label")
            ? input.closest("label")
            : element;
        if (!(target instanceof HTMLElement) || !visible(target)) return [];
        const box = target.getBoundingClientRect();
        if (box.width >= 43.5 && box.height >= 43.5) return [];
        return [
          element.tagName.toLocaleLowerCase() +
            ' "' +
            labelFor(element) +
            '" (' +
            box.width.toFixed(1) +
            "x" +
            box.height.toFixed(1) +
            ")",
        ];
      });

    return {
      clipped: [...new Set(clipped)],
      rootOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      touchTargets: [...new Set(touchTargets)],
    };
  })()
`;

async function auditMobileGeometry(page: Page): Promise<MobileGeometryAudit> {
  return page.evaluate<MobileGeometryAudit>(mobileGeometryAuditScript);
}

async function auditMobileNavigation(
  page: Page,
): Promise<MobileNavigationMetric[]> {
  return page.evaluate<MobileNavigationMetric[]>(String.raw`
    (() =>
      [...document.querySelectorAll(".workspace-tab-button")].map((button) => {
        const number = button.querySelector(".workspace-nav-number");
        const label = button.querySelector(".workspace-nav-label");
        if (!number || !label) {
          throw new Error("Primary navigation tab is missing its number or label");
        }

        const buttonBox = button.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        const numberBox = number.getBoundingClientRect();
        const sourceStyle = getComputedStyle(label);
        const labelStyle = getComputedStyle(label, "::after");

        return {
          ariaLabel: button.getAttribute("aria-label") || "",
          button: {
            height: buttonBox.height,
            width: buttonBox.width,
          },
          labelOffset: labelBox.top - buttonBox.top,
          mobileLabel: label.getAttribute("data-mobile-label"),
          numberOffset: numberBox.top - buttonBox.top,
          sourceFontSize: sourceStyle.fontSize,
          typography: {
            fontFamily: labelStyle.fontFamily,
            fontSize: labelStyle.fontSize,
            fontWeight: labelStyle.fontWeight,
            letterSpacing: labelStyle.letterSpacing,
            lineHeight: labelStyle.lineHeight,
          },
        };
      }))()
  `);
}

function navigationMetricFailures(
  route: MobileAuditRoute,
  profile: MobileViewportProfile,
  metrics: MobileNavigationMetric[],
): string[] {
  const context = `${route.slug}/${profile.slug}`;
  if (metrics.length !== 5) {
    return [
      `${context}: expected five navigation items, received ${String(metrics.length)}`,
    ];
  }

  const failures: string[] = [];
  const first = metrics[0];
  if (!first) return [`${context}: navigation metrics are empty`];
  const firstTypography = JSON.stringify(first.typography);

  for (const metric of metrics) {
    if (!metric.mobileLabel) {
      failures.push(
        `${context}: ${metric.ariaLabel} does not use the shared mobile label`,
      );
    }
    if (metric.sourceFontSize !== "0px") {
      failures.push(
        `${context}: ${metric.ariaLabel} exposes its desktop label at ${metric.sourceFontSize}`,
      );
    }
    if (Math.abs(metric.button.width - first.button.width) > 0.51) {
      failures.push(
        `${context}: ${metric.ariaLabel} width ${metric.button.width.toFixed(2)}px does not match ${first.button.width.toFixed(2)}px`,
      );
    }
    if (Math.abs(metric.button.height - first.button.height) > 0.51) {
      failures.push(
        `${context}: ${metric.ariaLabel} height ${metric.button.height.toFixed(2)}px does not match ${first.button.height.toFixed(2)}px`,
      );
    }
    if (Math.abs(metric.numberOffset - first.numberOffset) > 0.51) {
      failures.push(
        `${context}: ${metric.ariaLabel} number offset ${metric.numberOffset.toFixed(2)}px does not match ${first.numberOffset.toFixed(2)}px`,
      );
    }
    if (Math.abs(metric.labelOffset - first.labelOffset) > 0.51) {
      failures.push(
        `${context}: ${metric.ariaLabel} label offset ${metric.labelOffset.toFixed(2)}px does not match ${first.labelOffset.toFixed(2)}px`,
      );
    }
    if (JSON.stringify(metric.typography) !== firstTypography) {
      failures.push(
        `${context}: ${metric.ariaLabel} typography ${JSON.stringify(metric.typography)} does not match ${firstTypography}`,
      );
    }
  }

  return failures;
}

test("audits every authenticated page across the mobile browser matrix", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  await authenticateMobileAudit(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const failures: string[] = [];
  const profiles = mobileViewportProfiles();
  for (const route of mobileAuditRoutes) {
    const initialProfile = profiles[0];
    if (!initialProfile) throw new Error("The mobile audit matrix is empty");
    await page.setViewportSize({
      height: initialProfile.height,
      width: initialProfile.width,
    });
    await openMobileAuditRoute(page, route);

    for (const profile of profiles) {
      await page.setViewportSize({
        height: profile.height,
        width: profile.width,
      });
      await page.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const navigation = page.locator(".workspace-sidebar nav");
      await expect(navigation).toBeInViewport();
      await expect(navigation.getByRole("button")).toHaveCount(5);
      const navigationBox = await navigation.boundingBox();
      if (
        !navigationBox ||
        navigationBox.x < -1 ||
        navigationBox.y < -1 ||
        navigationBox.x + navigationBox.width > profile.width + 1 ||
        navigationBox.y + navigationBox.height > profile.height + 1
      ) {
        failures.push(
          `${route.slug}/${profile.slug}: bottom navigation clipped`,
        );
      }

      const geometry = await auditMobileGeometry(page);
      if (geometry.rootOverflow > 0) {
        failures.push(
          `${route.slug}/${profile.slug}: root overflow ${String(geometry.rootOverflow)}px`,
        );
      }
      for (const clipped of geometry.clipped) {
        failures.push(`${route.slug}/${profile.slug}: clipped ${clipped}`);
      }
      for (const target of geometry.touchTargets) {
        failures.push(
          `${route.slug}/${profile.slug}: touch target below 44px ${target}`,
        );
      }
      failures.push(
        ...navigationMetricFailures(
          route,
          profile,
          await auditMobileNavigation(page),
        ),
      );
    }
  }

  expect(failures, failures.slice(0, 200).join("\n")).toEqual([]);
});

test("keeps mobile navigation anchored and resets route scroll", async ({
  page,
}) => {
  await authenticateMobileAudit(page);
  await page.setViewportSize({ height: 458, width: 430 });
  await openMobileAuditRoute(page, mobileAuditRoutes[0]!);

  const navigation = page.locator(".workspace-sidebar nav");
  const tabBar = navigation.locator(".workspace-tab-bar");
  const contentScroller = page.locator(".workspace-main").first();
  await expect(tabBar).toBeVisible();
  await expect(navigation.getByRole("button")).toHaveCount(5);

  await page.evaluate(
    "Object.assign(window, { __mobileNavigationSentinel: 'preserved' })",
  );
  await contentScroller.evaluate((element) => {
    element.scrollTop = 360;
  });
  expect(await contentScroller.evaluate((element) => element.scrollTop)).toBe(
    360,
  );
  await navigation
    .getByRole("button", { name: "Applications", exact: true })
    .click();
  await expect(page).toHaveURL(/\/applications$/);
  expect(await contentScroller.evaluate((element) => element.scrollTop)).toBe(
    0,
  );
  expect(
    await page.evaluate<string | undefined>(
      "window.__mobileNavigationSentinel",
    ),
  ).toBe("preserved");

  const viewportDrivenBottomRules = await page.evaluate<string[]>(String.raw`
    (() => {
      const matches = [];
      const visit = (rules) => {
        for (const rule of rules) {
          if (
            rule.style &&
            rule.selectorText &&
            rule.selectorText.includes(".workspace-sidebar nav")
          ) {
            const bottom = rule.style.getPropertyValue("bottom");
            if (/v(?:h|w|b|i|min|max)/i.test(bottom)) {
              matches.push(rule.selectorText + " { bottom: " + bottom + " }");
            }
          }
          if (rule.cssRules) visit(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        visit(sheet.cssRules);
      }
      return matches;
    })()
  `);
  expect(
    viewportDrivenBottomRules,
    viewportDrivenBottomRules.join("\n"),
  ).toEqual([]);

  await expect(contentScroller).toBeVisible();

  for (const height of [458, 568, 932, 458]) {
    await page.setViewportSize({ height, width: 430 });

    const shell = await page.evaluate<{
      bodyOverflow: string;
      contentOverflow: string;
      contentPosition: string;
      rootOverflow: string;
      shellPosition: string;
    }>(String.raw`
      (() => {
        const content = document.querySelector(".workspace-main");
        const shell = document.querySelector(".workspace-app-shell");
        if (!content || !shell) {
          throw new Error("Authenticated app shell is missing");
        }
        return {
          bodyOverflow: getComputedStyle(document.body).overflow,
          contentOverflow: getComputedStyle(content).overflowY,
          contentPosition: getComputedStyle(content).position,
          rootOverflow: getComputedStyle(document.documentElement).overflow,
          shellPosition: getComputedStyle(shell).position,
        };
      })()
    `);
    expect(shell).toEqual({
      bodyOverflow: "hidden",
      contentOverflow: "auto",
      contentPosition: "absolute",
      rootOverflow: "hidden",
      shellPosition: "fixed",
    });

    for (const scrollTarget of [0, 360, 10_000]) {
      await contentScroller.evaluate(
        (element, top) => element.scrollTo({ behavior: "instant", top }),
        scrollTarget,
      );
      await page.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      expect(await page.evaluate("window.scrollY")).toBe(0);
      const position = await page.evaluate<{
        backfaceVisibility: string;
        bottom: string;
        bottomGap: number;
        position: string;
        transform: string;
        willChange: string;
      }>(String.raw`
        (() => {
          const navigation = document.querySelector(".workspace-sidebar nav");
          if (!navigation) throw new Error("Primary navigation is missing");
          const box = navigation.getBoundingClientRect();
          const style = getComputedStyle(navigation);
          const viewportBottom =
            (window.visualViewport?.offsetTop || 0) +
            (window.visualViewport?.height || window.innerHeight);
          return {
            backfaceVisibility: style.backfaceVisibility,
            bottom: style.bottom,
            bottomGap: viewportBottom - box.bottom,
            position: style.position,
            transform: style.transform,
            willChange: style.willChange,
          };
        })()
      `);
      expect(position.position).toBe("fixed");
      expect(position.bottom).toBe("0px");
      expect(Math.abs(position.bottomGap)).toBeLessThanOrEqual(1);
      expect(position.backfaceVisibility).toBe("hidden");
      expect(position.transform).not.toBe("none");
      expect(position.willChange).toContain("transform");
    }
  }
});

const mobileBaselineProfiles: ReadonlyArray<MobileViewportProfile> = [
  {
    chrome: "expanded",
    height: 458,
    orientation: "portrait",
    screen: "compact",
    slug: "320-portrait-compact-toolbar-expanded",
    width: 320,
  },
  {
    chrome: "collapsed",
    height: 932,
    orientation: "portrait",
    screen: "tall",
    slug: "430-portrait-tall-toolbar-collapsed",
    width: 430,
  },
  {
    chrome: "expanded",
    height: 216,
    orientation: "landscape",
    screen: "compact",
    slug: "320-landscape-compact-toolbar-expanded",
    width: 568,
  },
  {
    chrome: "collapsed",
    height: 430,
    orientation: "landscape",
    screen: "tall",
    slug: "430-landscape-tall-toolbar-collapsed",
    width: 932,
  },
];

test("keeps authenticated mobile screenshot baselines", async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await authenticateMobileAudit(page);
  await ensureMobileAuditData(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const route of mobileAuditRoutes) {
    const initialProfile = mobileBaselineProfiles[0];
    if (!initialProfile) throw new Error("The mobile baseline matrix is empty");
    await page.setViewportSize({
      height: initialProfile.height,
      width: initialProfile.width,
    });
    await openMobileAuditRoute(page, route);

    for (const profile of mobileBaselineProfiles) {
      await page.setViewportSize({
        height: profile.height,
        width: profile.width,
      });
      await page.evaluate("window.scrollTo(0, 0)");
      await expect(page).toHaveScreenshot(`${route.slug}-${profile.slug}.png`, {
        animations: "disabled",
        caret: "hide",
        mask: [
          page.locator(
            [
              "time",
              ".tracker-reference",
              ".tracker-mobile-card-facts > span:nth-child(4)",
              ".document-stored-cell",
              ".document-mobile-facts > div:first-child dd",
            ].join(","),
          ),
        ],
        maxDiffPixels: 320,
      });
    }
  }
});

test("keeps mobile overlays, filters, keyboard, and menus usable", async ({
  page,
}) => {
  test.setTimeout(2 * 60_000);
  await authenticateMobileAudit(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const width of auditedMobileWidths) {
    await page.setViewportSize({ height: 458, width });
    await page.goto("/applications");
    await expect(
      page.getByRole("heading", { name: "Applications", exact: true }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Log application", exact: true })
      .click();
    const applicationDialog = page.getByRole("dialog", {
      name: "Log an application",
    });
    await expect(applicationDialog).toBeInViewport();
    const modalGeometry = await auditMobileGeometry(page);
    expect(
      modalGeometry.touchTargets,
      modalGeometry.touchTargets.join("\n"),
    ).toEqual([]);
    const company = applicationDialog.getByLabel("End company");
    await company.focus();
    await page.setViewportSize({ height: 320, width });
    await expect(company).toBeFocused();
    await expect(company).toBeInViewport();
    expect((await auditMobileGeometry(page)).rootOverflow).toBe(0);
    await page.keyboard.press("Escape");
    await expect(applicationDialog).toBeHidden();

    await page.setViewportSize({ height: 458, width });
    await page
      .locator(".tracker-mobile-filter-row")
      .getByRole("button", { name: "Stage" })
      .click();
    const stageFilter = page.getByRole("dialog", { name: "Filter Stage" });
    await expect(stageFilter).toBeInViewport();
    await expect(
      stageFilter.getByRole("button", { name: "Done" }),
    ).toBeInViewport();
    const filterGeometry = await auditMobileGeometry(page);
    expect(
      filterGeometry.touchTargets,
      filterGeometry.touchTargets.join("\n"),
    ).toEqual([]);
    await stageFilter.getByRole("button", { name: "Done" }).click();

    const sort = page.getByRole("combobox", { name: "Sort Applications" });
    await sort.selectOption("company-ascending");
    await expect(sort).toHaveValue("company-ascending");

    const bottomNavigation = page.locator(".workspace-sidebar nav");
    for (const navigationButton of await bottomNavigation
      .getByRole("button")
      .all()) {
      await expect(navigationButton).toBeInViewport();
      const box = await navigationButton.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }

  for (const landscapeWidth of [568, 932]) {
    for (const deviceWidth of auditedMobileWidths) {
      await page.setViewportSize({
        height: Math.max(216, deviceWidth - 104),
        width: landscapeWidth,
      });
      await page.goto("/applications");
      await expect(
        page.getByRole("heading", { name: "Applications", exact: true }),
      ).toBeVisible();

      await page
        .getByRole("button", { name: "Log application", exact: true })
        .click();
      const applicationDialog = page.getByRole("dialog", {
        name: "Log an application",
      });
      await expect(applicationDialog).toBeInViewport();
      const modalGeometry = await auditMobileGeometry(page);
      expect(modalGeometry.rootOverflow).toBe(0);
      expect(
        modalGeometry.touchTargets,
        modalGeometry.touchTargets.join("\n"),
      ).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(applicationDialog).toBeHidden();

      await page
        .locator(".tracker-mobile-filter-row")
        .getByRole("button", { name: "Stage" })
        .click();
      const stageFilter = page.getByRole("dialog", { name: "Filter Stage" });
      await expect(stageFilter).toBeInViewport();
      await expect(
        stageFilter.getByRole("button", { name: "Done" }),
      ).toBeInViewport();
      const filterGeometry = await auditMobileGeometry(page);
      expect(
        filterGeometry.touchTargets,
        filterGeometry.touchTargets.join("\n"),
      ).toEqual([]);
      await stageFilter.getByRole("button", { name: "Done" }).click();

      const navigation = page.locator(".workspace-sidebar nav");
      for (const navigationButton of await navigation
        .getByRole("button")
        .all()) {
        const box = await navigationButton.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    }
  }
});

test("extends mobile navigation through the Android browser chin", async ({
  page,
}) => {
  await authenticateMobileAudit(page);
  await page.setViewportSize({ height: 932, width: 430 });
  await openMobileAuditRoute(page, mobileAuditRoutes[0]!);
  await page.evaluate(
    "document.documentElement.style.setProperty('--workspace-safe-area-bottom', '24px')",
  );

  const readNavigationMetrics = () =>
    page.evaluate<{
      body: string;
      bottomGap: number;
      document: string;
      height: number;
      navigation: string;
      paddingBottom: string;
      tabBarHeight: number;
      width: number;
    }>(String.raw`
      (() => {
        const navigation = document.querySelector(".workspace-sidebar nav");
        const tabBar = navigation?.querySelector(".workspace-tab-bar");
        if (!navigation || !tabBar) {
          throw new Error("Mobile navigation is missing");
        }

        const navigationBox = navigation.getBoundingClientRect();
        const tabBarBox = tabBar.getBoundingClientRect();
        const viewportBottom =
          (window.visualViewport?.offsetTop || 0) +
          (window.visualViewport?.height || window.innerHeight);

        return {
          body: getComputedStyle(document.body).backgroundColor,
          bottomGap: viewportBottom - navigationBox.bottom,
          document: getComputedStyle(document.documentElement).backgroundColor,
          height: navigationBox.height,
          navigation: getComputedStyle(navigation).backgroundColor,
          paddingBottom: getComputedStyle(navigation).paddingBottom,
          tabBarHeight: tabBarBox.height,
          width: navigationBox.width,
        };
      })()
    `);

  const portrait = await readNavigationMetrics();
  expect(portrait.document).not.toBe("rgba(0, 0, 0, 0)");
  expect(portrait.body).toBe(portrait.navigation);
  expect(portrait.document).toBe(portrait.navigation);
  expect(portrait.navigation).toBe("rgb(24, 60, 55)");
  expect(portrait.paddingBottom).toBe("24px");
  expect(portrait.tabBarHeight).toBe(56);
  expect(portrait.height - portrait.tabBarHeight).toBeGreaterThanOrEqual(24);
  expect(Math.abs(portrait.bottomGap)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ height: 320, width: 568 });
  const sideNavigation = await readNavigationMetrics();
  expect(sideNavigation.paddingBottom).toBe("0px");
  expect(sideNavigation.width).toBe(72);

  await page.setViewportSize({ height: 216, width: 568 });
  const shortLandscape = await readNavigationMetrics();
  expect(shortLandscape.paddingBottom).toBe("24px");
  expect(
    shortLandscape.height - shortLandscape.tabBarHeight,
  ).toBeGreaterThanOrEqual(24);
  expect(shortLandscape.navigation).toBe("rgb(24, 60, 55)");
  expect(shortLandscape.tabBarHeight).toBe(44);
  expect(shortLandscape.width).toBe(568);
  expect(Math.abs(shortLandscape.bottomGap)).toBeLessThanOrEqual(1);
});

test("keeps the compact dashboard table contained on desktop", async ({
  page,
}) => {
  await authenticateMobileAudit(page);
  await ensureMobileAuditData(page);
  await page.setViewportSize({ height: 1096, width: 2484 });
  await openMobileAuditRoute(page, mobileAuditRoutes[0]!);

  const geometry = await page.evaluate<{
    clientWidth: number;
    headerCount: number;
    lastHeaderRight: number;
    referenceWhiteSpace: string;
    shellRight: number;
    scrollWidth: number;
    statusWhiteSpace: string;
    tableRight: number;
  }>(String.raw`
    (() => {
      const shell = document.querySelector(
        ".tracker-recent .tracker-table-shell.compact",
      );
      const table = shell?.querySelector(".tracker-applications-table");
      const headers = [...(table?.querySelectorAll("thead th") ?? [])];
      if (!shell || !table || headers.length === 0) {
        throw new Error("Compact dashboard table is missing");
      }

      const shellBox = shell.getBoundingClientRect();
      const tableBox = table.getBoundingClientRect();
      const lastHeaderBox = headers.at(-1).getBoundingClientRect();
      const reference = table.querySelector("tbody .tracker-reference");
      const status = table.querySelector("tbody .tracker-status-chip");
      if (!reference || !status) {
        throw new Error("Compact dashboard table tokens are missing");
      }

      return {
        clientWidth: shell.clientWidth,
        headerCount: headers.length,
        lastHeaderRight: lastHeaderBox.right,
        referenceWhiteSpace: getComputedStyle(reference).whiteSpace,
        shellRight: shellBox.right,
        scrollWidth: shell.scrollWidth,
        statusWhiteSpace: getComputedStyle(status).whiteSpace,
        tableRight: tableBox.right,
      };
    })()
  `);

  expect(geometry.headerCount).toBe(6);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.tableRight).toBeLessThanOrEqual(geometry.shellRight + 1);
  expect(geometry.lastHeaderRight).toBeLessThanOrEqual(geometry.shellRight + 1);
  expect(geometry.referenceWhiteSpace).toBe("nowrap");
  expect(geometry.statusWhiteSpace).toBe("nowrap");
});

test("keeps the full desktop register contained with long record values", async ({
  page,
}) => {
  await authenticateMobileAudit(page);
  await page.setViewportSize({ height: 1271, width: 2262 });
  await page.goto("/opportunities");
  await expect(
    page.getByRole("heading", { name: "Opportunities", exact: true }),
  ).toBeVisible();

  const companyName = "Northern Manufacturing Group";
  const applicationsResponse = await page.request.get("/api/applications");
  expect(applicationsResponse.status()).toBe(200);
  const applicationsBody = record(
    await applicationsResponse.json(),
    "desktop register applications",
  );
  if (!Array.isArray(applicationsBody.applications)) {
    throw new Error("desktop register applications must contain an array");
  }
  const hasStressRecord = applicationsBody.applications.some(
    (application) =>
      record(application, "desktop register application").companyName ===
      companyName,
  );

  if (!hasStressRecord) {
    await page
      .getByRole("button", { name: "Log application", exact: true })
      .click();
    const applicationDialog = page.getByRole("dialog", {
      name: "Log an application",
    });
    await applicationDialog.getByLabel("End company").fill(companyName);
    await applicationDialog
      .getByLabel("Role title")
      .fill("Principal Infrastructure and Automation Lead");
    await applicationDialog
      .getByLabel("Next action")
      .fill(
        "Await the first-stage decision by the end of the week, then confirm the exact interview date, attendees, preparation brief, travel arrangements, and requested portfolio material.",
      );
    await applicationDialog
      .getByRole("button", { name: "Save application" })
      .click();
    await expect(applicationDialog).toBeHidden();
  }

  const table = page.getByRole("table", { name: "Opportunities" });
  const stressRow = table.getByRole("row").filter({ hasText: companyName });
  await expect(stressRow).toBeVisible();
  const geometry = await stressRow.evaluate((row) => {
    const table = row.closest("table");
    const shell = table?.parentElement;
    const companyCell = row.querySelector("td:nth-child(2)");
    const nextActionCell = row.querySelector(".tracker-next-action-cell");
    const nextAction = nextActionCell?.querySelector("strong");
    if (!shell || !table || !companyCell || !nextActionCell || !nextAction) {
      throw new Error("desktop register geometry targets are missing");
    }

    const shellBox = shell.getBoundingClientRect();
    const tableBox = table.getBoundingClientRect();
    const companyCellBox = companyCell.getBoundingClientRect();
    const nextActionBox = nextAction.getBoundingClientRect();
    const nextActionCellBox = nextActionCell.getBoundingClientRect();
    return {
      clientWidth: shell.clientWidth,
      companyCellWidth: companyCellBox.width,
      nextActionCellWidth: nextActionCellBox.width,
      nextActionWidth: nextActionBox.width,
      scrollWidth: shell.scrollWidth,
      shellRight: shellBox.right,
      tableRight: tableBox.right,
    };
  });

  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.tableRight).toBeLessThanOrEqual(geometry.shellRight + 1);
  expect(geometry.companyCellWidth).toBeGreaterThanOrEqual(150);
  expect(geometry.nextActionWidth).toBeLessThanOrEqual(
    geometry.nextActionCellWidth + 1,
  );
});
