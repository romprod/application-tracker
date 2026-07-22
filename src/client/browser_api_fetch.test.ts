import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserApiFetch,
  observeAuthenticationRequired,
} from "./browser_api_fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

function errorResponse(code: string, status = 401): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("browser API authentication boundary", () => {
  it("notifies only for an explicit authentication-required response", async () => {
    const listener = vi.fn();
    const stopObserving = observeAuthenticationRequired(listener);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(errorResponse("invalid_credentials"));
    await browserApiFetch("/api/auth/login");
    fetchMock.mockResolvedValueOnce(errorResponse("validation_error", 400));
    await browserApiFetch("/api/applications");
    expect(listener).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(errorResponse("authentication_required"));
    await browserApiFetch("/api/applications");
    expect(listener).toHaveBeenCalledOnce();

    stopObserving();
  });

  it("leaves network failures to the requesting client", async () => {
    const listener = vi.fn();
    const stopObserving = observeAuthenticationRequired(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );

    await expect(browserApiFetch("/api/applications")).rejects.toThrow(
      "offline",
    );
    expect(listener).not.toHaveBeenCalled();

    stopObserving();
  });
});
