import { describe, expect, it } from "vitest";

import {
  canonicalOutlookFolderPath,
  createOutlookGraphConnectionSchema,
  deleteOutlookGraphConnectionSchema,
  parseOutlookFolderPath,
  updateOutlookGraphConnectionSchema,
} from "./outlook_graph_connections.js";

const validInput = {
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "private-client-secret",
  folderPath: "inbox/jobs",
  mailbox: "jobs@example.com",
  name: "Work tenant",
  tenantId: "11111111-1111-4111-8111-111111111111",
};

describe("Outlook Graph connection input", () => {
  it("canonicalizes a bounded Inbox child-folder path", () => {
    expect(parseOutlookFolderPath(" inbox / Recruiting \\\\ Jobs ")).toEqual([
      "Inbox",
      "Recruiting",
      "Jobs",
    ]);
    expect(canonicalOutlookFolderPath("inbox/jobs")).toBe("Inbox\\jobs");
    expect(createOutlookGraphConnectionSchema.parse(validInput)).toMatchObject({
      folderPath: "Inbox\\jobs",
    });
  });

  it.each([
    "Inbox",
    "Archive\\Jobs",
    "Inbox\\..",
    "Inbox\\.",
    "Inbox\\Jobs\\A\\B\\C\\D",
    `Inbox\\${"x".repeat(129)}`,
    "Inbox\\Jobs\u0000",
  ])("rejects unsafe folder path %j", (folderPath) => {
    expect(() => parseOutlookFolderPath(folderPath)).toThrow(
      "Invalid Outlook folder path",
    );
  });

  it("allows secret reuse while rejecting unknown fields and weak deletion confirmation", () => {
    const withoutSecret = {
      clientId: validInput.clientId,
      folderPath: validInput.folderPath,
      mailbox: validInput.mailbox,
      name: validInput.name,
      tenantId: validInput.tenantId,
    };
    expect(
      updateOutlookGraphConnectionSchema.parse(withoutSecret),
    ).not.toHaveProperty("clientSecret");
    expect(
      createOutlookGraphConnectionSchema.safeParse({
        ...validInput,
        secretEcho: "not allowed",
      }).success,
    ).toBe(false);
    expect(
      deleteOutlookGraphConnectionSchema.safeParse({
        confirm: false,
        expectedAssignedApplicationCount: 0,
      }),
    ).toMatchObject({ success: false });
    expect(
      deleteOutlookGraphConnectionSchema.parse({
        confirm: true,
        expectedAssignedApplicationCount: 2,
      }),
    ).toEqual({ confirm: true, expectedAssignedApplicationCount: 2 });
  });
});
