import { describe, expect, it } from "vitest";

import { CryptoMcpClientTokenManager } from "./mcp_client_token_manager.js";

describe("CryptoMcpClientTokenManager", () => {
  it("issues parseable high-entropy credentials and verifies only the secret", () => {
    const manager = new CryptoMcpClientTokenManager();
    const issued = manager.issue();

    expect(issued.clientId).toMatch(/^atmcp_[A-Za-z0-9_-]{24}$/);
    expect(issued.bearerToken).toMatch(
      /^atmcp_[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.bearerToken).not.toContain(issued.tokenHash);
    const parsed = manager.parse(issued.bearerToken);
    expect(parsed?.clientId).toBe(issued.clientId);
    expect(manager.matches(parsed?.tokenSecret ?? "", issued.tokenHash)).toBe(
      true,
    );
    expect(manager.matches("A".repeat(43), issued.tokenHash)).toBe(false);
  });

  it("rotates a stable client ID without reusing the secret", () => {
    const manager = new CryptoMcpClientTokenManager();
    const first = manager.issue();
    const second = manager.issue(first.clientId);

    expect(second.clientId).toBe(first.clientId);
    expect(second.bearerToken).not.toBe(first.bearerToken);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it.each([
    "",
    "atmcp_short.secret",
    "atmcp_abcdefghijklmnopqrstuvwx.short",
    "atmcp_abcdefghijklmnopqrstuvwx.secret.with.dots",
    "Bearer atmcp_abcdefghijklmnopqrstuvwx.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
  ])("rejects malformed bearer token %j", (token) => {
    expect(new CryptoMcpClientTokenManager().parse(token)).toBeUndefined();
  });
});
