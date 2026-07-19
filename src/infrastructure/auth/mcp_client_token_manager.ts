import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  McpClientTokenManager,
  NewMcpClientCredential,
} from "../../application/mcp_clients.js";

const clientIdPattern = /^atmcp_[A-Za-z0-9_-]{24}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export class CryptoMcpClientTokenManager implements McpClientTokenManager {
  public issue(clientId?: string): NewMcpClientCredential {
    const resolvedClientId =
      clientId ?? `atmcp_${randomBytes(18).toString("base64url")}`;
    if (!clientIdPattern.test(resolvedClientId)) {
      throw new Error("Invalid MCP client ID");
    }
    const tokenSecret = randomBytes(32).toString("base64url");
    return {
      bearerToken: `${resolvedClientId}.${tokenSecret}`,
      clientId: resolvedClientId,
      tokenHash: hashSecret(tokenSecret),
    };
  }

  public matches(tokenSecret: string, expectedHash: string): boolean {
    const actual = Buffer.from(hashSecret(tokenSecret), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  public parse(
    bearerToken: string,
  ): { clientId: string; tokenSecret: string } | undefined {
    const separator = bearerToken.indexOf(".");
    if (separator < 1 || bearerToken.indexOf(".", separator + 1) !== -1) {
      return undefined;
    }
    const clientId = bearerToken.slice(0, separator);
    const tokenSecret = bearerToken.slice(separator + 1);
    return clientIdPattern.test(clientId) && secretPattern.test(tokenSecret)
      ? { clientId, tokenSecret }
      : undefined;
  }
}
