export const e2eSetupToken = `e2e-only-${"a".repeat(55)}`;

export const e2eAdministrator = {
  displayName: "Browser Administrator",
  password: "e2e-only-password-123",
  username: "browser-admin",
  workspaceName: "Browser Test Applications",
} as const;
