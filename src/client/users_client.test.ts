import { afterEach, describe, expect, it, vi } from "vitest";

import { browserUsersClient, UsersClientError } from "./users_client";

const user = {
  createdAt: "2026-01-01T00:00:00.000Z",
  displayName: "Alex Example",
  externalIdentities: [],
  id: "11111111-1111-4111-8111-111111111111",
  isCurrentUser: true,
  localAccount: true,
  role: "admin",
  status: "active",
  username: "alex",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserUsersClient", () => {
  it("lists users without caching the response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          externalIdentityProviderConfigured: false,
          users: [user],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(browserUsersClient.listUsers()).resolves.toEqual({
      externalIdentityProviderConfigured: false,
      users: [user],
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/users", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("links and unlinks an external subject through scoped endpoints", async () => {
    const identity = {
      createdAt: "2026-01-01T01:00:00.000Z",
      id: "22222222-2222-4222-8222-222222222222",
      subject: "oauth-subject-123",
    };
    const linked = { ...user, externalIdentities: [identity] };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: linked }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserUsersClient.linkExternalIdentity(user.id, identity.subject),
    ).resolves.toEqual(linked);
    await expect(
      browserUsersClient.unlinkExternalIdentity(user.id, identity.id),
    ).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/settings/users/${user.id}/external-identities`,
      {
        body: JSON.stringify({ subject: identity.subject }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/settings/users/${user.id}/external-identities/${identity.id}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
  });

  it("returns a stable error when a username is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "username_unavailable" } }),
            { status: 409 },
          ),
        ),
    );

    await expect(
      browserUsersClient.createUser({
        displayName: "Another Alex",
        password: "another password phrase",
        role: "member",
        username: "alex",
      }),
    ).rejects.toEqual(new UsersClientError("username_unavailable"));
  });

  it("updates status through the scoped user endpoint", async () => {
    const disabled = { ...user, isCurrentUser: false, status: "disabled" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ user: disabled }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserUsersClient.setStatus(user.id, "disabled"),
    ).resolves.toEqual(disabled);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/settings/users/${user.id}/status`,
      {
        body: JSON.stringify({ status: "disabled" }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      },
    );
  });
});
