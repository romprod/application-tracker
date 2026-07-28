import { createCipheriv } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AesGcmOutlookGraphSecretCipher } from "./outlook_graph_secret_cipher.js";

const context = {
  clientId: "22222222-2222-4222-8222-222222222222",
  connectionId: "33333333-3333-4333-8333-333333333333",
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "workspace-alpha",
};

function legacyEnvelope(key: Buffer, secret: string): string {
  const iv = Buffer.alloc(12, 5);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(
    Buffer.from(
      [
        "application-tracker",
        "outlook-graph",
        "v1",
        context.workspaceId,
        context.tenantId,
        context.clientId,
      ].join("\0"),
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

describe("AesGcmOutlookGraphSecretCipher", () => {
  it("round-trips a secret in a versioned randomized envelope", () => {
    const cipher = new AesGcmOutlookGraphSecretCipher(Buffer.alloc(32, 7));
    const first = cipher.encrypt("private-client-secret", context);
    const second = cipher.encrypt("private-client-secret", context);

    expect(first).toMatch(
      /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(second).not.toBe(first);
    expect(cipher.decrypt(first, context)).toBe("private-client-secret");
  });

  it("binds ciphertext to the key and connection context", () => {
    const cipher = new AesGcmOutlookGraphSecretCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt("private-client-secret", context);

    expect(() =>
      new AesGcmOutlookGraphSecretCipher(Buffer.alloc(32, 8)).decrypt(
        encrypted,
        context,
      ),
    ).toThrow();
    for (const changed of [
      { ...context, workspaceId: "workspace-beta" },
      {
        ...context,
        connectionId: "55555555-5555-4555-8555-555555555555",
      },
      { ...context, tenantId: "33333333-3333-4333-8333-333333333333" },
      { ...context, clientId: "44444444-4444-4444-8444-444444444444" },
    ]) {
      expect(() => cipher.decrypt(encrypted, changed)).toThrow();
    }
  });

  it("decrypts version-one envelopes created before connection IDs existed", () => {
    const key = Buffer.alloc(32, 7);
    const cipher = new AesGcmOutlookGraphSecretCipher(key);

    expect(cipher.decrypt(legacyEnvelope(key, "legacy-secret"), context)).toBe(
      "legacy-secret",
    );
  });

  it("rejects malformed and tampered envelopes", () => {
    const cipher = new AesGcmOutlookGraphSecretCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt("private-client-secret", context);
    const parts = encrypted.split(".");
    const ciphertext = parts[3] ?? "";
    const replacement = ciphertext.endsWith("A") ? "B" : "A";
    parts[3] = `${ciphertext.slice(0, -1)}${replacement}`;

    expect(() => cipher.decrypt(parts.join("."), context)).toThrow();
    expect(() => cipher.decrypt("v2.invalid.envelope.value", context)).toThrow(
      "Invalid encrypted Outlook credential",
    );
    expect(() => new AesGcmOutlookGraphSecretCipher(Buffer.alloc(31))).toThrow(
      "must be 32 bytes",
    );
  });
});
