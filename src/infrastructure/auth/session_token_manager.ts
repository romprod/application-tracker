import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { SessionTokenManager } from "../../application/auth.js";

export class CryptoSessionTokenManager implements SessionTokenManager {
  public hash(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  public issue() {
    const token = randomBytes(32).toString("base64url");
    return {
      sessionId: randomUUID(),
      token,
      tokenHash: this.hash(token),
    };
  }
}
