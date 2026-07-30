import { describe, expect, it, vi } from "vitest";

import {
  indeedInspectionMinimumIntervalMs,
  JobPostingInspectionService,
} from "./job_posting_inspection.js";
import type {
  PublicHttpsReader,
  PublicHttpsResponse,
} from "../infrastructure/network/public_https_reader.js";

const canonicalUrl = "https://uk.indeed.com/viewjob?jk=96550901704ee48a";

function response(
  input: Partial<PublicHttpsResponse> = {},
): PublicHttpsResponse {
  return {
    body: "",
    contentType: "text/html; charset=utf-8",
    location: null,
    status: 200,
    ...input,
  };
}

function inspectionService(
  read: PublicHttpsReader["read"],
): JobPostingInspectionService {
  return new JobPostingInspectionService(
    undefined,
    { read },
    () => new Date("2026-07-27T12:00:00.000Z"),
  );
}

describe("JobPostingInspectionService", () => {
  it("extracts bounded structured JobPosting metadata from a canonical page", async () => {
    const read = vi.fn(() =>
      Promise.resolve(
        response({
          body: `
          <html><head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "JobPosting",
                "title": "Senior Platform Engineer",
                "hiringOrganization": {"@type": "Organization", "name": "Example Ltd"},
                "jobLocation": {
                  "@type": "Place",
                  "address": {
                    "@type": "PostalAddress",
                    "addressLocality": "London",
                    "addressRegion": "Greater London",
                    "addressCountry": "GB"
                  }
                },
                "jobLocationType": "TELECOMMUTE",
                "baseSalary": {
                  "@type": "MonetaryAmount",
                  "currency": "GBP",
                  "value": {
                    "@type": "QuantitativeValue",
                    "minValue": 80000,
                    "maxValue": 100000,
                    "unitText": "YEAR"
                  }
                },
                "description": "<p>Build &amp; operate the platform.</p><ul><li>Own reliability</li></ul>",
                "validThrough": "2026-08-31T23:59:59Z",
                "url": "${canonicalUrl}"
              }
            </script>
          </head></html>
        `,
        }),
      ),
    );
    const service = inspectionService(read);

    await expect(service.inspect({ url: canonicalUrl })).resolves.toEqual({
      applyUrl: canonicalUrl,
      canonicalUrl,
      closingDate: "2026-08-31",
      description: "Build & operate the platform. Own reliability",
      employer: "Example Ltd",
      location: "London, Greater London, GB",
      salary: "GBP 80000–100000 YEAR",
      status: "available",
      title: "Senior Platform Engineer",
      workArrangement: "remote",
    });
    expect(read).toHaveBeenCalledWith(
      new URL(canonicalUrl),
      expect.objectContaining({
        includeBody: true,
        maxBytes: 1_048_576,
      }),
    );
  });

  it("returns unavailable instead of inferring data from ordinary page text", async () => {
    const service = inspectionService(
      vi.fn(() =>
        Promise.resolve(
          response({
            body: "<html><h1>Senior Engineer at Example</h1></html>",
          }),
        ),
      ),
    );

    await expect(service.inspect({ url: canonicalUrl })).resolves.toEqual({
      canonicalUrl,
      reason: "missing_structured_data",
      status: "unavailable",
    });
  });

  it("rejects an unrecognized URL before any network request", async () => {
    const read = vi.fn();
    const service = inspectionService(read);

    await expect(
      service.inspect({ url: "https://example.com/account/profile" }),
    ).resolves.toEqual({
      canonicalUrl: null,
      reason: "unrecognized_url",
      status: "unavailable",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("returns unavailable for expired, challenged, and ambiguous postings", async () => {
    const expired = inspectionService(
      vi.fn(() =>
        Promise.resolve(
          response({
            body: `<script type="application/ld+json">${JSON.stringify({
              "@type": "JobPosting",
              title: "Expired role",
              validThrough: "2026-07-26",
            })}</script>`,
          }),
        ),
      ),
    );
    await expect(expired.inspect({ url: canonicalUrl })).resolves.toEqual({
      canonicalUrl,
      reason: "expired",
      status: "unavailable",
    });

    const blocked = inspectionService(
      vi.fn(() => Promise.resolve(response({ status: 403 }))),
    );
    await expect(blocked.inspect({ url: canonicalUrl })).resolves.toEqual({
      canonicalUrl,
      reason: "provider_challenge",
      retryAfter: "2026-07-27T12:15:00.000Z",
      status: "unavailable",
    });

    const ambiguous = inspectionService(
      vi.fn(() =>
        Promise.resolve(
          response({
            body: `<script type="application/ld+json">${JSON.stringify([
              { "@type": "JobPosting", title: "One" },
              { "@type": "JobPosting", title: "Two" },
            ])}</script>`,
          }),
        ),
      ),
    );
    await expect(ambiguous.inspect({ url: canonicalUrl })).resolves.toEqual({
      canonicalUrl,
      reason: "ambiguous_metadata",
      status: "unavailable",
    });
  });

  it("does not follow redirects that the provider registry does not recognize", async () => {
    const read = vi.fn(() =>
      Promise.resolve(
        response({
          location: "https://example.com/account/sign-in",
          status: 302,
        }),
      ),
    );
    const service = inspectionService(read);

    await expect(service.inspect({ url: canonicalUrl })).resolves.toEqual({
      canonicalUrl,
      reason: "blocked",
      status: "unavailable",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stops after three recognized redirects", async () => {
    const read = vi.fn(() =>
      Promise.resolve(
        response({
          location: canonicalUrl,
          status: 302,
        }),
      ),
    );
    const service = inspectionService(read);

    await expect(service.inspect({ url: canonicalUrl })).resolves.toEqual({
      canonicalUrl,
      reason: "redirect_limit",
      status: "unavailable",
    });
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("canonicalizes a recognized input before fetching it", async () => {
    const read = vi.fn(() => Promise.resolve(response({ status: 410 })));
    const service = inspectionService(read);

    await expect(
      service.inspect({
        url: "https://uk.indeed.com/rc/clk?jk=96550901704ee48a&from=email",
      }),
    ).resolves.toEqual({
      canonicalUrl,
      reason: "expired",
      status: "unavailable",
    });
    expect(read.mock.calls[0]?.[0]).toEqual(new URL(canonicalUrl));
  });

  it("deduplicates concurrent and recently completed canonical inspections", async () => {
    let releaseRead: (() => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<PublicHttpsResponse>((resolve) => {
          releaseRead = () => resolve(response({ status: 410 }));
        }),
    );
    const service = inspectionService(read);

    const first = service.inspect({ url: canonicalUrl });
    const duplicate = service.inspect({
      url: `${canonicalUrl}&from=email`,
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    releaseRead!();

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { canonicalUrl, reason: "expired", status: "unavailable" },
      { canonicalUrl, reason: "expired", status: "unavailable" },
    ]);
    await expect(service.inspect({ url: canonicalUrl })).resolves.toEqual({
      canonicalUrl,
      reason: "expired",
      status: "unavailable",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("serializes and spaces distinct Indeed inspections", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
    try {
      let active = 0;
      let maximumActive = 0;
      const startedAt: number[] = [];
      const read = vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        startedAt.push(Date.now());
        await Promise.resolve();
        active -= 1;
        return response({ status: 410 });
      });
      const service = new JobPostingInspectionService(
        undefined,
        { read },
        () => new Date(Date.now()),
      );

      const inspections = Promise.all([
        service.inspect({ url: canonicalUrl }),
        service.inspect({
          url: "https://uk.indeed.com/viewjob?jk=0ecc2e04f72bf31c",
        }),
      ]);
      await vi.advanceTimersByTimeAsync(indeedInspectionMinimumIntervalMs);
      await inspections;

      expect(maximumActive).toBe(1);
      expect(startedAt).toHaveLength(2);
      expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(
        indeedInspectionMinimumIntervalMs,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens an Indeed cooldown after a provider challenge without another fetch", async () => {
    const read = vi.fn(() => Promise.resolve(response({ status: 403 })));
    const service = inspectionService(read);

    await expect(service.inspect({ url: canonicalUrl })).resolves.toMatchObject(
      {
        reason: "provider_challenge",
        retryAfter: "2026-07-27T12:15:00.000Z",
        status: "unavailable",
      },
    );
    await expect(
      service.inspect({
        url: "https://uk.indeed.com/viewjob?jk=e56772bb8f333a4d",
      }),
    ).resolves.toEqual({
      canonicalUrl: "https://uk.indeed.com/viewjob?jk=e56772bb8f333a4d",
      reason: "provider_challenge",
      retryAfter: "2026-07-27T12:15:00.000Z",
      status: "unavailable",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("recognizes an Indeed security-check page without returning its content", async () => {
    const service = inspectionService(
      vi.fn(() =>
        Promise.resolve(
          response({
            body: `
              <html>
                <head><title>Security Check - Indeed.com</title></head>
                <body>Challenge reference secret-value</body>
              </html>
            `,
          }),
        ),
      ),
    );

    const result = await service.inspect({ url: canonicalUrl });

    expect(result).toEqual({
      canonicalUrl,
      reason: "provider_challenge",
      retryAfter: "2026-07-27T12:15:00.000Z",
      status: "unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});
