import { describe, expect, it } from "vitest";

import { EmailLinkExtractionService } from "./email_links.js";

describe("EmailLinkExtractionService", () => {
  const service = new EmailLinkExtractionService();

  it("extracts and deduplicates likely job links from text and HTML", () => {
    const content = `
      Apply at https://boards.greenhouse.io/example/jobs/123?source=email.
      <a href="https://boards.greenhouse.io/example/jobs/123?source=email">Role</a>
      Company role: https://careers.example.com/jobs/product-designer
      Preferences: https://careers.example.com/preferences/unsubscribe
    `;

    expect(service.extract({ content })).toEqual([
      {
        host: "boards.greenhouse.io",
        url: "https://boards.greenhouse.io/example/jobs/123?source=email",
      },
      {
        host: "careers.example.com",
        url: "https://careers.example.com/jobs/product-designer",
      },
    ]);
  });

  it("unwraps Outlook Safe Links and Google redirect links", () => {
    const safeTarget = "https://jobs.lever.co/example/role-id";
    const googleTarget = "https://example.org/careers/platform-engineer";
    const content = [
      `https://example.safelinks.protection.outlook.com/?url=${encodeURIComponent(safeTarget)}&data=opaque`,
      `https://www.google.com/url?q=${encodeURIComponent(googleTarget)}&source=gmail`,
    ].join("\n");

    expect(service.extract({ content })).toEqual([
      { host: "jobs.lever.co", url: safeTarget },
      { host: "example.org", url: googleTarget },
    ]);
  });

  it("handles quoted-printable email text without decoding attachments", () => {
    expect(
      service.extract({
        content:
          "Content-Transfer-Encoding: quoted-printable\r\n\r\nApply: https://jobs.example.com/openings/123?source=3Demail=26campaign=3Dweekly",
      }),
    ).toEqual([
      {
        host: "jobs.example.com",
        url: "https://jobs.example.com/openings/123?source=email&campaign=weekly",
      },
    ]);
  });

  it("rejects noise, credential-bearing URLs, and non-web schemes", () => {
    expect(
      service.extract({
        content: [
          "https://example.com/privacy",
          "https://example.com/help",
          "https://user:secret@example.com/jobs/123",
          "javascript:alert(1)",
          "https://example.com/news",
          "https://www.linkedin.com/in/example-person",
        ].join(" "),
      }),
    ).toEqual([]);
  });

  it("caps the result count and treats SQL control text as content", () => {
    const content = Array.from(
      { length: 30 },
      (_, index) =>
        `https://careers.example.com/jobs/${String(index)}?q=');DROP TABLE applications;--`,
    ).join("\n");

    expect(service.extract({ content })).toHaveLength(20);
  });
});
