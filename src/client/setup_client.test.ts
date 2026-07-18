import { afterEach, describe, expect, it, vi } from "vitest";

import { browserSetupClient, SetupClientError } from "./setup_client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserSetupClient", () => {
  it("requests setup status without using a cache", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ required: true, tokenConfigured: false }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(browserSetupClient.getStatus()).resolves.toEqual({
      required: true,
      tokenConfigured: false,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/setup/status", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("returns only the server error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "setup_complete" } }), {
          headers: { "content-type": "application/json" },
          status: 409,
        }),
      ),
    );

    await expect(
      browserSetupClient.completeSetup({
        displayName: "Alex Example",
        password: "correct horse battery staple",
        setupToken: "a".repeat(64),
        username: "alex",
        workspaceName: "Applications",
      }),
    ).rejects.toEqual(new SetupClientError("setup_complete"));
  });
});
