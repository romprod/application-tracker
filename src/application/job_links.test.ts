import { describe, expect, it, vi } from "vitest";

import { EmailLinkExtractionService } from "./email_links.js";
import { JobLinkResolutionService } from "./job_links.js";
import type {
  PublicHttpsReader,
  PublicHttpsResponse,
} from "../infrastructure/network/public_https_reader.js";

function response(
  input: Partial<PublicHttpsResponse> = {},
): PublicHttpsResponse {
  return {
    body: "",
    contentType: null,
    location: null,
    status: 302,
    ...input,
  };
}

describe("JobLinkResolutionService", () => {
  it("preserves deterministic extraction and does not fetch direct postings", async () => {
    const read = vi.fn();
    const reader: PublicHttpsReader = { read };
    const service = new JobLinkResolutionService(
      new EmailLinkExtractionService(),
      undefined,
      reader,
    );

    await expect(
      service.resolve({
        content:
          "https://www.linkedin.com/jobs/view/4405273020?trackingId=email",
      }),
    ).resolves.toEqual({
      candidates: [
        {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin",
          redirectsFollowed: 0,
          resolution: "deterministic",
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      ],
      tracking: { attempted: 0, resolved: 0, unavailable: [] },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("resolves an allowlisted tracking redirect only to a recognized posting", async () => {
    const read = vi.fn(() =>
      Promise.resolve(
        response({
          location:
            "https://uk.indeed.com/pagead/clk?jk=96550901704ee48a&from=jobalert",
        }),
      ),
    );
    const service = new JobLinkResolutionService(
      new EmailLinkExtractionService(),
      undefined,
      { read },
    );

    const result = await service.resolve({
      content:
        '<a href="https://cts.indeed.com/v1/click?campaign=weekly&amp;token=opaque">View role</a>',
    });

    expect(result).toEqual({
      candidates: [
        {
          externalPostingId: "96550901704ee48a",
          host: "uk.indeed.com",
          provider: "indeed",
          redirectsFollowed: 1,
          resolution: "tracking_redirect",
          url: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
        },
      ],
      tracking: { attempted: 1, resolved: 1, unavailable: [] },
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toEqual(
      new URL("https://cts.indeed.com/v1/click?campaign=weekly&token=opaque"),
    );
    expect(read.mock.calls[0]?.[1]).toMatchObject({
      includeBody: false,
      maxBytes: 0,
    });
  });

  it("repairs wrapped HTML tracking links and unwraps transparent Safe Links", async () => {
    const read = vi.fn(() =>
      Promise.resolve(
        response({
          location:
            "https://uk.indeed.com/viewjob?jk=96550901704ee48a&from=email",
        }),
      ),
    );
    const service = new JobLinkResolutionService(
      new EmailLinkExtractionService(),
      undefined,
      { read },
    );
    const target =
      "https://cts.indeed.com/v1/click?campaign=weekly&token=opaque";
    const safeLink = `https://tenant.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&data=opaque`;

    const result = await service.resolve({
      content: [
        '<a href="https://cts.indeed.com/v1/\nclick?campaign=weekly&amp;token=opaque">Role</a>',
        safeLink,
      ].join("\n"),
    });

    expect(result.tracking).toMatchObject({ attempted: 1, resolved: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toEqual(new URL(target));
  });

  it("never follows a redirect to an unrecognized or non-allowlisted host", async () => {
    const read = vi.fn(() =>
      Promise.resolve(
        response({ location: "https://example.com/account/profile" }),
      ),
    );
    const service = new JobLinkResolutionService(
      new EmailLinkExtractionService(),
      undefined,
      { read },
    );

    await expect(
      service.resolve({
        content: "https://cts.indeed.com/v1/click?token=opaque",
      }),
    ).resolves.toEqual({
      candidates: [],
      tracking: {
        attempted: 1,
        resolved: 0,
        unavailable: [
          {
            host: "cts.indeed.com",
            reason: "redirect_not_allowed",
          },
        ],
      },
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable without exposing tracking tokens when resolution fails", async () => {
    const service = new JobLinkResolutionService(
      new EmailLinkExtractionService(),
      undefined,
      {
        read: vi.fn(() => Promise.reject(new Error("network failure"))),
      },
    );

    const result = await service.resolve({
      content: "https://cts.indeed.com/v1/click?token=personal-secret",
    });
    expect(result.tracking.unavailable).toEqual([
      { host: "cts.indeed.com", reason: "fetch_failed" },
    ]);
    expect(JSON.stringify(result)).not.toContain("personal-secret");
  });
});
