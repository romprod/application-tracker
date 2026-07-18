import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApplicationsClientError,
  browserApplicationsClient,
} from "./applications_client";

const application = {
  appliedOn: "2026-07-18",
  companyName: "Example Studio",
  createdAt: "2026-07-18T12:15:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  location: "Remote",
  notes: "Referred by a former colleague.",
  roleTitle: "Product Designer",
  sourceUrl: "https://jobs.example.com/product-designer",
  status: "applied",
  updatedAt: "2026-07-18T12:15:00.000Z",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserApplicationsClient", () => {
  it("lists application records without caching the response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ applications: [application] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(browserApplicationsClient.listApplications()).resolves.toEqual(
      [application],
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/applications", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("creates through the same-origin JSON endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ application }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      companyName: "Example Studio",
      roleTitle: "Product Designer",
      status: "applied" as const,
    };

    await expect(
      browserApplicationsClient.createApplication(input),
    ).resolves.toEqual(application);
    expect(fetchMock).toHaveBeenCalledWith("/api/applications", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("rejects malformed application records", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ applications: [{ companyName: "Incomplete" }] }),
            { status: 200 },
          ),
        ),
    );

    await expect(browserApplicationsClient.listApplications()).rejects.toEqual(
      new ApplicationsClientError("invalid_response"),
    );
  });

  it("rejects an unsafe source link returned by the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            applications: [
              { ...application, sourceUrl: "javascript:alert(1)" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(browserApplicationsClient.listApplications()).rejects.toEqual(
      new ApplicationsClientError("invalid_response"),
    );
  });
});
