import { createHash, randomBytes } from "node:crypto";

import type { McpOAuthOpaqueTokenManager } from "../../application/mcp_builtin_oauth.js";

function opaque(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export class CryptoMcpOAuthTokenManager implements McpOAuthOpaqueTokenManager {
  public hash(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  public issueAccessToken(): string {
    return opaque("atoat_");
  }

  public issueAuthorizationCode(): string {
    return opaque("atoac_");
  }

  public issueClientId(): string {
    return `atoc_${randomBytes(18).toString("base64url")}`;
  }

  public issueRefreshToken(): string {
    return opaque("ator_");
  }

  public isAccessToken(token: string): boolean {
    return /^atoat_[A-Za-z0-9_-]{43}$/.test(token);
  }
}
