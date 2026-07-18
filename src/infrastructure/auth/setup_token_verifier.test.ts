import { describe, expect, it } from "vitest";

import { StaticSetupTokenVerifier } from "./setup_token_verifier.js";

describe("StaticSetupTokenVerifier", () => {
  it("reports configuration and compares the complete token", () => {
    const token = "a".repeat(64);
    const verifier = new StaticSetupTokenVerifier(token);

    expect(verifier.isConfigured()).toBe(true);
    expect(verifier.verify(token)).toBe(true);
    expect(verifier.verify(`${token}x`)).toBe(false);
  });

  it("rejects all candidates when no token is configured", () => {
    const verifier = new StaticSetupTokenVerifier();

    expect(verifier.isConfigured()).toBe(false);
    expect(verifier.verify("a".repeat(64))).toBe(false);
  });
});
