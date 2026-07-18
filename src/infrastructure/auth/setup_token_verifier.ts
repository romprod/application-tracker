import { createHash, timingSafeEqual } from "node:crypto";

import type { SetupTokenVerifier } from "../../application/setup.js";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export class StaticSetupTokenVerifier implements SetupTokenVerifier {
  public constructor(private readonly token?: string) {}

  public isConfigured(): boolean {
    return this.token !== undefined;
  }

  public verify(candidate: string): boolean {
    if (this.token === undefined) {
      return false;
    }

    return timingSafeEqual(digest(candidate), digest(this.token));
  }
}
