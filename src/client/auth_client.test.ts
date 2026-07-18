import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthClientError, browserAuthClient } from "./auth_client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserAuthClient", () => {
  it("requests the current session without using a cache", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(browserAuthClient.getSession()).resolves.toEqual({
      authenticated: false,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("returns a generic login error code without retaining credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "invalid_credentials" } }), {
        headers: { "content-type": "application/json" },
        status: 401,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserAuthClient.login({ password: "incorrect", username: "alex" }),
    ).rejects.toEqual(new AuthClientError("invalid_credentials"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
      body: JSON.stringify({ password: "incorrect", username: "alex" }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("accepts an empty successful logout response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(browserAuthClient.logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "POST",
    });
  });
});
