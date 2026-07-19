import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import {
  InvalidMcpAccessTokenError,
  type McpAccessTokenVerifier,
  type McpOAuthConfig,
  type VerifiedMcpAccessToken,
} from "../../application/mcp_oauth.js";

const maximumAccessTokenLength = 16_384;
const maximumSubjectLength = 512;
const oauthScopePattern =
  /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/;

export class JoseMcpAccessTokenVerifier implements McpAccessTokenVerifier {
  private readonly keyResolver: JWTVerifyGetKey;

  public constructor(
    private readonly config: McpOAuthConfig,
    keyResolver?: JWTVerifyGetKey,
  ) {
    this.keyResolver =
      keyResolver ??
      createRemoteJWKSet(new URL(config.jwksUrl), {
        cooldownDuration: 30_000,
        timeoutDuration: 5_000,
      });
  }

  public async verify(token: string): Promise<VerifiedMcpAccessToken> {
    if (
      token.length === 0 ||
      token.length > maximumAccessTokenLength ||
      token.split(".").length !== 3
    ) {
      throw new InvalidMcpAccessTokenError();
    }

    try {
      const { payload, protectedHeader } = await jwtVerify(
        token,
        this.keyResolver,
        {
          algorithms: [this.config.algorithm],
          audience: this.config.audience,
          issuer: this.config.issuer,
          requiredClaims: ["exp", "sub"],
        },
      );
      if (protectedHeader.alg !== this.config.algorithm) {
        throw new InvalidMcpAccessTokenError();
      }
      if (
        typeof payload.sub !== "string" ||
        payload.sub.length === 0 ||
        payload.sub.length > maximumSubjectLength
      ) {
        throw new InvalidMcpAccessTokenError();
      }
      if (
        payload.scope !== undefined &&
        (typeof payload.scope !== "string" ||
          !oauthScopePattern.test(payload.scope))
      ) {
        throw new InvalidMcpAccessTokenError();
      }

      return {
        issuer: this.config.issuer,
        scopes: new Set(payload.scope?.split(" ") ?? []),
        subject: payload.sub,
      };
    } catch {
      throw new InvalidMcpAccessTokenError();
    }
  }
}
