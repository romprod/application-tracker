import { expect, test } from "@playwright/test";

import { e2eAdministrator, e2eSetupToken } from "./fixtures";

test("creates the first administrator and opens the dashboard", async ({
  page,
}) => {
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
});
