import { describe, expect, it, vi } from "vitest";

import {
  browserEmailLinksClient,
  EmailLinksClientError,
} from "./email_links_client";

describe("browserEmailLinksClient", () => {
  it("extracts and validates bounded job-link candidates", async () => {
    const links = [
      {
        externalPostingId: null,
        host: "boards.greenhouse.io",
        provider: "generic",
        url: "https://boards.greenhouse.io/example/jobs/123",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ links }), {
          status: 200,
        }),
      ),
    );

    await expect(
      browserEmailLinksClient.extractJobLinks("synthetic email"),
    ).resolves.toEqual(links);
    expect(fetch).toHaveBeenCalledWith("/api/documents/email-links/extract", {
      body: JSON.stringify({ content: "synthetic email" }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("rejects malformed responses and reports stable errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              links: [
                {
                  externalPostingId: null,
                  host: "local",
                  provider: "generic",
                  url: "file:///tmp",
                },
              ],
            }),
            {
              status: 200,
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { code: "validation_error" } }),
            {
              status: 400,
            },
          ),
        ),
    );

    await expect(
      browserEmailLinksClient.extractJobLinks("synthetic email"),
    ).rejects.toEqual(new EmailLinksClientError("invalid_response"));
    await expect(
      browserEmailLinksClient.extractJobLinks("synthetic email"),
    ).rejects.toEqual(new EmailLinksClientError("validation_error"));
  });

  it("rejects unknown providers and malformed posting identifiers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              links: [
                {
                  externalPostingId: "123",
                  host: "example.com",
                  provider: "unknown",
                  url: "https://example.com/jobs/123",
                },
              ],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              links: [
                {
                  externalPostingId: "x".repeat(129),
                  host: "www.linkedin.com",
                  provider: "linkedin",
                  url: "https://www.linkedin.com/jobs/view/123",
                },
              ],
            }),
          ),
        ),
    );

    await expect(
      browserEmailLinksClient.extractJobLinks("synthetic email"),
    ).rejects.toEqual(new EmailLinksClientError("invalid_response"));
    await expect(
      browserEmailLinksClient.extractJobLinks("synthetic email"),
    ).rejects.toEqual(new EmailLinksClientError("invalid_response"));
  });
});
