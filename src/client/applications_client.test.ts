import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApplicationsClientError,
  browserApplicationsClient,
} from "./applications_client";

const application = {
  appliedOn: "2026-07-18",
  companyName: "Example Studio",
  contacts: [
    {
      email: "morgan@example.com",
      name: "Morgan Recruiter",
      phone: "+44 20 7946 0958",
      role: "Recruiter",
    },
  ],
  createdAt: "2026-07-18T12:15:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  location: "Remote",
  links: [
    {
      label: "Hiring portal",
      url: "https://careers.example.com/application",
    },
  ],
  nextAction: "Send the portfolio follow-up.",
  nextActionDue: "2026-07-21",
  notes: "Referred by a former colleague.",
  roleType: "Full-time",
  roleTypeId: "66666666-6666-4666-8666-666666666666",
  roleTitle: "Product Designer",
  source: "Referral",
  sourceId: "55555555-5555-4555-8555-555555555555",
  sourceUrl: "https://jobs.example.com/product-designer",
  status: "Applied",
  statusId: "44444444-4444-4444-8444-444444444444",
  statusIsTerminal: false,
  updatedAt: "2026-07-18T12:15:00.000Z",
} as const;

const events = [
  {
    actorDisplayName: "Alex Example",
    fromStatus: "Applied",
    id: "22222222-2222-4222-8222-222222222222",
    occurredAt: "2026-07-18T13:15:00.000Z",
    toStatus: "Interview",
    type: "status_changed",
  },
  {
    actorDisplayName: "Alex Example",
    fromStatus: null,
    id: "33333333-3333-4333-8333-333333333333",
    occurredAt: "2026-07-18T12:15:00.000Z",
    toStatus: "Applied",
    type: "application_created",
  },
] as const;

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
      statusId: application.statusId,
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

  it("updates through the same-origin JSON endpoint", async () => {
    const updated = {
      ...application,
      location: null,
      status: "Interview",
      statusId: "77777777-7777-4777-8777-777777777777",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ application: updated }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      expectedUpdatedAt: application.updatedAt,
      location: null,
      statusId: updated.statusId,
    };

    await expect(
      browserApplicationsClient.updateApplication(application.id, input),
    ).resolves.toEqual(updated);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/applications/${application.id}`,
      {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      },
    );
  });

  it("returns the latest record with an application conflict", async () => {
    const latest = {
      ...application,
      companyName: "Updated elsewhere",
      updatedAt: "2026-07-18T12:16:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            application: latest,
            error: { code: "application_conflict" },
          }),
          { status: 409 },
        ),
      ),
    );

    await expect(
      browserApplicationsClient.updateApplication(application.id, {
        companyName: "My stale edit",
        expectedUpdatedAt: application.updatedAt,
      }),
    ).rejects.toMatchObject({
      application: latest,
      code: "application_conflict",
    });
  });

  it("deletes through the same-origin endpoint without expecting a body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserApplicationsClient.deleteApplication(application.id),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/applications/${application.id}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
  });

  it("lists application history without caching the response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserApplicationsClient.listApplicationEvents(application.id),
    ).resolves.toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/applications/${application.id}/events`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
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

  it("rejects malformed contacts and unsafe additional links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            applications: [
              {
                ...application,
                contacts: [{ ...application.contacts[0], email: "invalid" }],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(browserApplicationsClient.listApplications()).rejects.toEqual(
      new ApplicationsClientError("invalid_response"),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            applications: [
              {
                ...application,
                links: [{ label: "Unsafe", url: "javascript:alert(1)" }],
              },
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

  it("rejects a malformed next-action due date returned by the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            applications: [{ ...application, nextActionDue: "21/07/2026" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(browserApplicationsClient.listApplications()).rejects.toEqual(
      new ApplicationsClientError("invalid_response"),
    );
  });

  it("rejects malformed or unpaired application list values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            applications: [{ ...application, sourceId: null }],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(browserApplicationsClient.listApplications()).rejects.toEqual(
      new ApplicationsClientError("invalid_response"),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            applications: [{ ...application, statusId: "not-an-id" }],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(browserApplicationsClient.listApplications()).rejects.toEqual(
      new ApplicationsClientError("invalid_response"),
    );
  });

  it("rejects malformed history entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            events: [{ ...events[0], type: "field_changed" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      browserApplicationsClient.listApplicationEvents(application.id),
    ).rejects.toEqual(new ApplicationsClientError("invalid_response"));
  });
});
