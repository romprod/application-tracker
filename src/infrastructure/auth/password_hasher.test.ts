import { describe, expect, it } from "vitest";

import { ScryptPasswordHasher } from "./password_hasher.js";

describe("ScryptPasswordHasher", () => {
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });

  it("creates salted hashes and verifies only the original password", async () => {
    const first = await hasher.hash("correct horse battery staple");
    const second = await hasher.hash("correct horse battery staple");

    expect(first).not.toBe(second);
    expect(first).not.toContain("correct horse battery staple");
    await expect(
      hasher.verify("correct horse battery staple", first),
    ).resolves.toBe(true);
    await expect(hasher.verify("incorrect password", first)).resolves.toBe(
      false,
    );
  });

  it("rejects a malformed encoded hash", async () => {
    await expect(
      hasher.verify("password", "not-a-password-hash"),
    ).resolves.toBe(false);
  });
});
