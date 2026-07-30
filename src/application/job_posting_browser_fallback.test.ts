import { describe, expect, it, vi } from "vitest";

import {
  CamoufoxJobPostingBrowserFallback,
  exactBrowserCanaryMatch,
  type JobPostingBrowserFallbackConfig,
} from "./job_posting_browser_fallback.js";
import { JobBoardProviderRegistry } from "./job_board_provider_registry.js";

const canonicalUrl = "https://uk.indeed.com/viewjob?jk=96550901704ee48a";
const match = new JobBoardProviderRegistry().match(new URL(canonicalUrl))!;

function config(
  overrides: Partial<JobPostingBrowserFallbackConfig> = {},
): JobPostingBrowserFallbackConfig {
  return {
    enabled: true,
    navigationTimeoutMs: 1000,
    providers: ["indeed"],
    responseMaxBytes: 4096,
    token: "a".repeat(32),
    workerUrl: "http://camoufox-worker:8080",
    ...overrides,
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("CamoufoxJobPostingBrowserFallback", () => {
  it("validates and returns one bounded worker posting", async () => {
    const workerFetch = vi.fn(() =>
      Promise.resolve(
        response({
          blockedRequests: 2,
          canonicalUrl,
          posting: {
            "@type": "JobPosting",
            title: "Platform Engineer",
            url: canonicalUrl,
          },
          status: "available",
          version: 1,
        }),
      ),
    );
    const telemetry = vi.fn();
    const fallback = new CamoufoxJobPostingBrowserFallback(
      config(),
      workerFetch,
      () => 100,
      telemetry,
    );

    await expect(fallback.inspect(match)).resolves.toMatchObject({
      blockedRequests: 2,
      canonicalUrl,
      posting: { title: "Platform Engineer" },
      status: "available",
    });
    expect(workerFetch).toHaveBeenCalledWith(
      new URL("http://camoufox-worker:8080/v1/inspect"),
      expect.objectContaining({
        body: JSON.stringify({ canonicalUrl, provider: "indeed" }),
        method: "POST",
        redirect: "error",
      }),
    );
    expect(telemetry).toHaveBeenCalledWith({
      blockedRequests: 2,
      durationMs: 0,
      outcome: "available",
      provider: "indeed",
      reason: "none",
    });
  });

  it("does not contact the worker when disabled or not allowlisted", async () => {
    const workerFetch = vi.fn();
    const fallback = new CamoufoxJobPostingBrowserFallback(
      config({ enabled: false, providers: [] }),
      workerFetch,
    );

    await expect(fallback.inspect(match)).resolves.toEqual({
      blockedRequests: 0,
      canonicalUrl,
      reason: "worker_disabled",
      status: "unavailable",
    });
    expect(workerFetch).not.toHaveBeenCalled();
  });

  it("accepts only the fixed internal worker endpoint", () => {
    expect(
      () =>
        new CamoufoxJobPostingBrowserFallback(
          config({ workerUrl: "http://169.254.169.254:8080" }),
        ),
    ).toThrow("Invalid Camoufox worker URL");
    expect(
      () =>
        new CamoufoxJobPostingBrowserFallback(
          config({ workerUrl: "http://camoufox-worker" }),
        ),
    ).toThrow("Invalid Camoufox worker URL");
  });

  it("fails closed on worker crashes, invalid responses, and size limits", async () => {
    const cases = [
      vi.fn(() => Promise.reject(new Error("crashed"))),
      vi.fn(() =>
        Promise.resolve(
          response({
            blockedRequests: 0,
            canonicalUrl: "https://uk.indeed.com/viewjob?jk=other000",
            posting: { "@type": "JobPosting" },
            status: "available",
            version: 1,
          }),
        ),
      ),
      vi.fn(() =>
        Promise.resolve(
          new Response("x".repeat(4097), {
            headers: { "Content-Length": "4097" },
          }),
        ),
      ),
    ];
    for (const workerFetch of cases) {
      const fallback = new CamoufoxJobPostingBrowserFallback(
        config(),
        workerFetch,
      );
      await expect(fallback.inspect(match)).resolves.toEqual({
        blockedRequests: 0,
        canonicalUrl,
        reason: "worker_failure",
        status: "unavailable",
      });
    }
  });

  it("preserves deterministic worker unavailable reasons", async () => {
    const fallback = new CamoufoxJobPostingBrowserFallback(
      config(),
      vi.fn(() =>
        Promise.resolve(
          response({
            blockedRequests: 1,
            canonicalUrl,
            reason: "navigation_timeout",
            status: "unavailable",
            version: 1,
          }),
        ),
      ),
    );

    await expect(fallback.inspect(match)).resolves.toEqual({
      blockedRequests: 1,
      canonicalUrl,
      reason: "navigation_timeout",
      status: "unavailable",
    });
  });

  it("accepts only an already-canonical URL for the operator canary", () => {
    const providers = new JobBoardProviderRegistry();
    expect(exactBrowserCanaryMatch(providers, canonicalUrl)).toEqual(match);
    expect(
      exactBrowserCanaryMatch(providers, `${canonicalUrl}&from=email`),
    ).toBeUndefined();
    expect(
      exactBrowserCanaryMatch(providers, "https://example.com/jobs/1"),
    ).toBeUndefined();
  });
});
