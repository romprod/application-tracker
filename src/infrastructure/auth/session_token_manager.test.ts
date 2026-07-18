import { describe, expect, it } from "vitest";

import { CryptoSessionTokenManager } from "./session_token_manager.js";

describe("CryptoSessionTokenManager", () => {
  it("issues independent opaque tokens and reproducible hashes", () => {
    const manager = new CryptoSessionTokenManager();
    const first = manager.issue();
    const second = manager.issue();

    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toContain(first.token);
    expect(manager.hash(first.token)).toBe(first.tokenHash);
  });
});
