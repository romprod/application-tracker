import { describe, expect, it, vi } from "vitest";

import {
  isPublicIpAddress,
  pinnedHttpsRequestOptions,
  PublicHttpsPolicyError,
  SecurePublicHttpsReader,
  validatePublicHttpsUrl,
} from "./public_https_reader.js";

describe("public HTTPS reader", () => {
  it.each([
    ["0.0.0.0", false],
    ["10.0.0.1", false],
    ["100.64.0.1", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["198.18.0.1", false],
    ["192.0.2.1", false],
    ["198.51.100.1", false],
    ["203.0.113.1", false],
    ["224.0.0.1", false],
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["::1", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["2001:db8::1", false],
    ["::ffff:127.0.0.1", false],
    ["2606:4700:4700::1111", true],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected);
  });

  it("accepts only credential-free HTTPS on the standard port", () => {
    expect(() =>
      validatePublicHttpsUrl(new URL("https://jobs.example.com/jobs/1")),
    ).not.toThrow();
    for (const url of [
      "http://jobs.example.com/jobs/1",
      "https://user:secret@jobs.example.com/jobs/1",
      "https://jobs.example.com:8443/jobs/1",
    ]) {
      expect(() => validatePublicHttpsUrl(new URL(url))).toThrow(
        PublicHttpsPolicyError,
      );
    }
  });

  it("builds a credential-free request pinned through a custom DNS lookup", () => {
    const options = pinnedHttpsRequestOptions(
      new URL("https://jobs.example.com/jobs/1"),
      { address: "8.8.8.8", family: 4 },
    );

    expect(options).toMatchObject({
      agent: false,
      family: 4,
      headers: {
        Accept: "text/html, application/xhtml+xml;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": "ApplicationTrackerJobPostingInspector/1.0",
      },
      method: "GET",
      servername: "jobs.example.com",
    });
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.headers).not.toHaveProperty("Cookie");
    expect(options.lookup).toBeTypeOf("function");
  });

  it("rejects private or mixed DNS answers before opening a request", async () => {
    const transport = vi.fn();
    const privateReader = new SecurePublicHttpsReader(
      vi.fn(() =>
        Promise.resolve([{ address: "127.0.0.1", family: 4 as const }]),
      ),
      transport,
    );
    await expect(
      privateReader.read(new URL("https://jobs.example.com/jobs/1"), {
        includeBody: true,
        maxBytes: 1024,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "non_public_address" });

    const mixedReader = new SecurePublicHttpsReader(
      vi.fn(() =>
        Promise.resolve([
          { address: "8.8.8.8", family: 4 as const },
          { address: "10.0.0.1", family: 4 as const },
        ]),
      ),
      transport,
    );
    await expect(
      mixedReader.read(new URL("https://jobs.example.com/jobs/1"), {
        includeBody: true,
        maxBytes: 1024,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "non_public_address" });

    const mismatchedFamilyReader = new SecurePublicHttpsReader(
      vi.fn(() =>
        Promise.resolve([
          { address: "2606:4700:4700::1111", family: 4 as const },
        ]),
      ),
      transport,
    );
    await expect(
      mismatchedFamilyReader.read(new URL("https://jobs.example.com/jobs/1"), {
        includeBody: true,
        maxBytes: 1024,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "non_public_address" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects response and timeout limits above the fixed policy", async () => {
    const transport = vi.fn();
    const reader = new SecurePublicHttpsReader(
      vi.fn(() =>
        Promise.resolve([{ address: "8.8.8.8", family: 4 as const }]),
      ),
      transport,
    );
    const url = new URL("https://jobs.example.com/jobs/1");

    await expect(
      reader.read(url, {
        includeBody: true,
        maxBytes: 1_048_577,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(
      reader.read(url, {
        includeBody: true,
        maxBytes: 1024,
        timeoutMs: 5_001,
      }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("pins one validated public address and forwards strict read limits", async () => {
    const transport = vi.fn(() =>
      Promise.resolve({
        body: "<html></html>",
        contentType: "text/html",
        location: null,
        status: 200,
      }),
    );
    const reader = new SecurePublicHttpsReader(
      vi.fn(() =>
        Promise.resolve([
          { address: "8.8.8.8", family: 4 as const },
          { address: "1.1.1.1", family: 4 as const },
        ]),
      ),
      transport,
    );
    const url = new URL("https://jobs.example.com/jobs/1");
    const options = {
      includeBody: true,
      maxBytes: 4096,
      timeoutMs: 250,
    };

    await expect(reader.read(url, options)).resolves.toMatchObject({
      status: 200,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(url);
    expect(transport.mock.calls[0]?.[1]).toEqual({
      address: "8.8.8.8",
      family: 4,
    });
    const requestOptions = transport.mock.calls[0]?.[2];
    expect(requestOptions).toMatchObject({
      includeBody: options.includeBody,
      maxBytes: options.maxBytes,
    });
    expect(requestOptions?.timeoutMs).toBeGreaterThan(0);
    expect(requestOptions?.timeoutMs).toBeLessThanOrEqual(options.timeoutMs);
  });
});
