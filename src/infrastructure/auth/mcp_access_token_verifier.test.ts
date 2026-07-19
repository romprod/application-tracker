// @vitest-environment node

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  InvalidMcpAccessTokenError,
  type McpOAuthConfig,
} from "../../application/mcp_oauth.js";
import { JoseMcpAccessTokenVerifier } from "./mcp_access_token_verifier.js";

const config: McpOAuthConfig = {
  algorithm: "RS256",
  audience: "https://tracker.example/mcp",
  issuer: "https://identity.example/application/o/mcp/",
  jwksUrl: "https://identity.example/application/o/mcp/jwks/",
  requiredScope: "tracker:read",
  workspaceSlug: "default",
};

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const [generated, other] = await Promise.all([
    generateKeyPair("RS256", { extractable: true }),
    generateKeyPair("RS256", { extractable: true }),
  ]);
  privateKey = generated.privateKey;
  otherPrivateKey = other.privateKey;
  publicJwk = {
    ...(await exportJWK(generated.publicKey)),
    alg: "RS256",
    kid: "test-key",
    use: "sig",
  };
});

async function tokenWith(
  overrides: {
    audience?: string;
    expiresAt?: number;
    issuer?: string;
    notBefore?: number;
    scope?: unknown;
    subject?: string | null;
  } = {},
  signingKey: CryptoKey = privateKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let token = new SignJWT(
    overrides.scope === undefined
      ? { scope: "openid tracker:read profile" }
      : { scope: overrides.scope },
  )
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? config.issuer)
    .setAudience(overrides.audience ?? config.audience)
    .setIssuedAt(now)
    .setExpirationTime(overrides.expiresAt ?? now + 60);
  if (overrides.subject !== null) {
    token = token.setSubject(overrides.subject ?? "identity-123");
  }
  if (overrides.notBefore !== undefined) {
    token = token.setNotBefore(overrides.notBefore);
  }
  return token.sign(signingKey);
}

function verifier(): JoseMcpAccessTokenVerifier {
  return new JoseMcpAccessTokenVerifier(
    config,
    createLocalJWKSet({ keys: [publicJwk] }),
  );
}

describe("JoseMcpAccessTokenVerifier", () => {
  it("verifies the signature and required JWT bindings", async () => {
    await expect(verifier().verify(await tokenWith())).resolves.toEqual({
      issuer: config.issuer,
      scopes: new Set(["openid", "tracker:read", "profile"]),
      subject: "identity-123",
    });
  });

  it.each([
    ["issuer", { issuer: "https://other.example/" }],
    ["audience", { audience: "https://other.example/mcp" }],
    ["expiry", { expiresAt: 1 }],
    ["not-before time", { notBefore: 4_102_444_800 }],
    ["subject", { subject: null }],
    ["scope shape", { scope: ["tracker:read"] }],
    ["scope syntax", { scope: "tracker:read  profile" }],
  ])("rejects an invalid %s", async (_name, overrides) => {
    await expect(verifier().verify(await tokenWith(overrides))).rejects.toEqual(
      new InvalidMcpAccessTokenError(),
    );
  });

  it("rejects a disallowed algorithm and a signature from an unknown key", async () => {
    const now = Math.floor(Date.now() / 1000);
    const symmetricToken = await new SignJWT({ scope: "tracker:read" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject("identity-123")
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode("a-secure-test-secret-with-32-bytes"));

    await expect(verifier().verify(symmetricToken)).rejects.toBeInstanceOf(
      InvalidMcpAccessTokenError,
    );
    await expect(
      verifier().verify(await tokenWith({}, otherPrivateKey)),
    ).rejects.toBeInstanceOf(InvalidMcpAccessTokenError);
  });

  it("allows a valid token without scopes so authorization can return insufficient_scope", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject("identity-123")
      .setExpirationTime(now + 60)
      .sign(privateKey);

    await expect(verifier().verify(token)).resolves.toEqual({
      issuer: config.issuer,
      scopes: new Set(),
      subject: "identity-123",
    });
  });

  it("rejects malformed and oversized compact tokens before key resolution", async () => {
    await expect(verifier().verify("not-a-jwt")).rejects.toBeInstanceOf(
      InvalidMcpAccessTokenError,
    );
    await expect(
      verifier().verify("a.b." + "x".repeat(16_384)),
    ).rejects.toBeInstanceOf(InvalidMcpAccessTokenError);
  });
});
