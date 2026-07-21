export const e2eSetupToken = `e2e-only-${"a".repeat(55)}`;

export const e2eAdministrator = {
  displayName: "Browser Administrator",
  password: "e2e-only-password-123",
  username: "browser-admin",
  workspaceName: "Browser Test Applications",
} as const;

export const e2eMcp = {
  allowedOrigin: "https://client.example",
  clientName: "Playwright OAuth client",
  redirectUri: "http://127.0.0.1:43191/oauth/callback",
  resourceUrl: "https://tracker.example/mcp",
  scope: "application-tracker:tools",
  state: "playwright-oauth-state",
  verifier: `playwright-${"v".repeat(55)}`,
} as const;
