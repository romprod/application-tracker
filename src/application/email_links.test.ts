import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailLinkExtractionService } from "./email_links.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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
        externalPostingId: null,
        host: "boards.greenhouse.io",
        provider: "generic",
        url: "https://boards.greenhouse.io/example/jobs/123?source=email",
      },
      {
        externalPostingId: null,
        host: "careers.example.com",
        provider: "generic",
        url: "https://careers.example.com/jobs/product-designer",
      },
    ]);
  });

  it("unwraps Outlook Safe Links and Google redirect links", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const safeTarget = "https://jobs.lever.co/example/role-id";
    const googleTarget = "https://example.org/careers/platform-engineer";
    const content = [
      `https://example.safelinks.protection.outlook.com/?url=${encodeURIComponent(safeTarget)}&data=opaque`,
      `https://www.google.com/url?q=${encodeURIComponent(googleTarget)}&source=gmail`,
    ].join("\n");

    expect(service.extract({ content })).toEqual([
      {
        externalPostingId: null,
        host: "jobs.lever.co",
        provider: "generic",
        url: safeTarget,
      },
      {
        externalPostingId: null,
        host: "example.org",
        provider: "generic",
        url: googleTarget,
      },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles quoted-printable email text without decoding attachments", () => {
    expect(
      service.extract({
        content:
          "Content-Transfer-Encoding: quoted-printable\r\n\r\nApply: https://jobs.example.com/openings/123?source=3Demail=26campaign=3Dweekly",
      }),
    ).toEqual([
      {
        externalPostingId: null,
        host: "jobs.example.com",
        provider: "generic",
        url: "https://jobs.example.com/openings/123?source=email&campaign=weekly",
      },
    ]);
  });

  it("repairs connector-wrapped Markdown and HTML URL destinations", () => {
    expect(
      service.extract({
        content: [
          "[LinkedIn role](https://www.linkedin.com/jobs/view/4405\n273020?trackingId=email)",
          '<a href="https://www.cv-library.co.uk/job/2253\n88377?utm_source=email">CV-Library role</a>',
        ].join("\n"),
      }),
    ).toEqual([
      {
        externalPostingId: "4405273020",
        host: "www.linkedin.com",
        provider: "linkedin",
        url: "https://www.linkedin.com/jobs/view/4405273020",
      },
      {
        externalPostingId: "225388377",
        host: "www.cv-library.co.uk",
        provider: "cv_library",
        url: "https://www.cv-library.co.uk/job/225388377",
      },
    ]);
  });

  it("joins punctuation-marked bare URL wraps without joining prose", () => {
    expect(
      service.extract({
        content: [
          "https://careers.example.com/jobs/platform-\nengineer?source=email",
          "https://careers.example.com/jobs/security-lead\nApply before Friday",
        ].join("\n"),
      }),
    ).toEqual([
      {
        externalPostingId: null,
        host: "careers.example.com",
        provider: "generic",
        url: "https://careers.example.com/jobs/platform-engineer?source=email",
      },
      {
        externalPostingId: null,
        host: "careers.example.com",
        provider: "generic",
        url: "https://careers.example.com/jobs/security-lead",
      },
    ]);
  });

  it("decodes one HTML entity layer without promoting nested query separators", () => {
    const extracted = service.extract({
      content: [
        "https://careers.example.com/jobs/123?source=email&amp;campaign=weekly",
        "https://careers.example.com/jobs/456?source=email&amp;#38;admin=true",
        "https://careers.example.com/jobs/789?source=email&amp;#x26;admin=true",
      ].join("\n"),
    });

    expect(extracted[0]).toEqual({
      externalPostingId: null,
      host: "careers.example.com",
      provider: "generic",
      url: "https://careers.example.com/jobs/123?source=email&campaign=weekly",
    });
    for (const candidate of extracted.slice(1)) {
      const parsed = new URL(candidate.url);
      expect(parsed.searchParams.get("source")).toBe("email");
      expect(parsed.searchParams.has("admin")).toBe(false);
    }
  });

  it("rejects opaque, non-posting, credential-bearing, and non-web links", () => {
    expect(
      service.extract({
        content: [
          "https://example.com/privacy",
          "https://example.com/help",
          "https://careers.example.com/account/jobs/123",
          "https://careers.example.com/campaign/jobs/123",
          "https://careers.example.com/recruiter/jobs/123",
          "https://user:secret@example.com/jobs/123",
          "javascript:alert(1)",
          "https://example.com/news",
          "https://www.linkedin.com/in/example-person",
          "https://www.linkedin.com/jobs/search/?keywords=platform",
          "https://clicks.cv-library.co.uk/f/a/opaque-campaign-id",
        ].join(" "),
      }),
    ).toEqual([]);
  });

  it.each([
    {
      expected: {
        externalPostingId: "4405273020",
        host: "www.linkedin.com",
        provider: "linkedin",
        url: "https://www.linkedin.com/jobs/view/4405273020",
      },
      url: "https://www.linkedin.com/comm/jobs/view/4405273020/?trackingId=opaque&refId=mail",
    },
    {
      expected: {
        externalPostingId: "225131968",
        host: "www.cv-library.co.uk",
        provider: "cv_library",
        url: "https://www.cv-library.co.uk/job/225131968",
      },
      url: "https://www.cv-library.co.uk/job/225131968/ServiceNow-Product-Manager?utm_source=email",
    },
    {
      expected: {
        externalPostingId: "96550901704ee48a",
        host: "uk.indeed.com",
        provider: "indeed",
        url: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
      },
      url: "https://uk.indeed.com/rc/clk?jk=96550901704ee48a&from=jobalert&tk=opaque",
    },
    {
      expected: {
        externalPostingId: "107699680",
        host: "www.totaljobs.com",
        provider: "totaljobs",
        url: "https://www.totaljobs.com/job/107699680",
      },
      url: `https://www.totaljobs.com/v2/magiclink/exchange?magicLink=opaque&returnUrl=${encodeURIComponent("/job/107699680/application/redirection?JobId=107699680")}`,
    },
    {
      expected: {
        externalPostingId: "jn-052026-7020246",
        host: "www.michaelpage.co.uk",
        provider: "michael_page",
        url: "https://www.michaelpage.co.uk/job-detail/global-project-manager/ref/jn-052026-7020246",
      },
      url: "https://www.michaelpage.co.uk/job-detail/global-project-manager/ref/JN-052026-7020246?utm_source=email",
    },
    {
      expected: {
        externalPostingId: "98a97190-8201-11f1-a7b8-0a05e249917d",
        host: "user.hackajob.com",
        provider: "hackajob",
        url: "https://user.hackajob.com/apply/98a97190-8201-11f1-a7b8-0a05e249917d",
      },
      url: "https://user.hackajob.com/apply/98a97190-8201-11f1-a7b8-0a05e249917d?utm_source=email",
    },
    {
      expected: {
        externalPostingId: "4018138",
        host: "cord.com",
        provider: "cord",
        url: "https://cord.com/u/example/jobs/4018138-platform-engineer",
      },
      url: "https://cord.com/u/example/jobs/4018138-platform-engineer?token=personal",
    },
    {
      expected: {
        externalPostingId: "627626618486524716",
        host: "uk.talent.com",
        provider: "talent",
        url: "https://uk.talent.com/redirect?id=627626618486524716",
      },
      url: "https://uk.talent.com/redirect?id=627626618486524716&utm_campaign=email&publisher=opaque",
    },
  ])(
    "identifies and canonicalizes $expected.provider postings",
    ({ expected, url }) => {
      expect(service.extract({ content: url })).toEqual([expected]);
    },
  );

  it("recognizes CV-Library apply URLs and Indeed job-path identifiers", () => {
    expect(
      service.extract({
        content: [
          "https://www.cv-library.co.uk/job/apply/225388377?email_token=personal",
          "https://uk.indeed.com/job/solutions-delivery-automation-lead-0cdda04f28d81908?from=email",
        ].join("\n"),
      }),
    ).toEqual([
      {
        externalPostingId: "225388377",
        host: "www.cv-library.co.uk",
        provider: "cv_library",
        url: "https://www.cv-library.co.uk/job/225388377",
      },
      {
        externalPostingId: "0cdda04f28d81908",
        host: "uk.indeed.com",
        provider: "indeed",
        url: "https://uk.indeed.com/viewjob?jk=0cdda04f28d81908",
      },
    ]);
  });

  it("unwraps deterministic Cord and hackajob click links", () => {
    const cordTarget =
      "https://cord.com/u/example/jobs/4018138-platform-engineer?token=personal";
    const cordClick = `https://email-send.cord.co/CL0/${encodeURIComponent(cordTarget)}/1/opaque`;
    const hackajobId = "98a97190-8201-11f1-a7b8-0a05e249917d";
    const hackajobTarget = `https://hackajob.com/sso/candidate/example?redirect=${encodeURIComponent(`/apply/${hackajobId}`)}`;
    const encoded = Buffer.from(
      JSON.stringify({ href: hackajobTarget }),
      "utf8",
    ).toString("base64url");
    const hackajobClick = `https://cio.mail-hackajob.com/e/c/${encoded}/signature`;

    expect(
      service.extract({ content: `${cordClick}\n${hackajobClick}` }),
    ).toEqual([
      {
        externalPostingId: "4018138",
        host: "cord.com",
        provider: "cord",
        url: "https://cord.com/u/example/jobs/4018138-platform-engineer",
      },
      {
        externalPostingId: hackajobId,
        host: "user.hackajob.com",
        provider: "hackajob",
        url: `https://user.hackajob.com/apply/${hackajobId}`,
      },
    ]);
  });

  it("deduplicates provider URLs after canonicalization", () => {
    expect(
      service.extract({
        content: [
          "https://www.linkedin.com/comm/jobs/view/4405273020?trackingId=first",
          "https://www.linkedin.com/jobs/view/4405273020?trackingId=second",
        ].join("\n"),
      }),
    ).toEqual([
      {
        externalPostingId: "4405273020",
        host: "www.linkedin.com",
        provider: "linkedin",
        url: "https://www.linkedin.com/jobs/view/4405273020",
      },
    ]);
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
