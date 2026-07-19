import { describe, expect, it, vi } from "vitest";

import {
  browserEmailLinksClient,
  EmailLinksClientError,
} from "./email_links_client";

describe("browserEmailLinksClient", () => {
  it("extracts and validates bounded job-link candidates", async () => {
    const links = [
      {
        host: "boards.greenhouse.io",
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
            JSON.stringify({ links: [{ host: "local", url: "file:///tmp" }] }),
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
});
