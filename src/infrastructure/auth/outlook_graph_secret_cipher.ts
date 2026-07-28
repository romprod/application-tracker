import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";

import type {
  OutlookGraphClientSecretCipher,
  OutlookGraphConnectionCipherContext,
} from "../../application/outlook_graph_connections.js";

const algorithm: CipherGCMTypes = "aes-256-gcm";
const currentEnvelopeVersion = "v2";
const legacyEnvelopeVersion = "v1";
const initializationVectorBytes = 12;
const authenticationTagBytes = 16;

function additionalData(
  version: typeof currentEnvelopeVersion | typeof legacyEnvelopeVersion,
  context: OutlookGraphConnectionCipherContext,
): Buffer {
  return Buffer.from(
    [
      "application-tracker",
      "outlook-graph",
      version,
      context.workspaceId,
      ...(version === currentEnvelopeVersion ? [context.connectionId] : []),
      context.tenantId,
      context.clientId,
    ].join("\0"),
    "utf8",
  );
}

function decodePart(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid encrypted Outlook credential");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new Error("Invalid encrypted Outlook credential");
  }
  return decoded;
}

export class AesGcmOutlookGraphSecretCipher implements OutlookGraphClientSecretCipher {
  public constructor(
    private readonly key: Buffer,
    private readonly random: (size: number) => Buffer = randomBytes,
  ) {
    if (key.length !== 32) {
      throw new Error("Outlook Graph encryption key must be 32 bytes");
    }
  }

  public encrypt(
    secret: string,
    context: OutlookGraphConnectionCipherContext,
  ): string {
    const iv = this.random(initializationVectorBytes);
    if (iv.length !== initializationVectorBytes) {
      throw new Error("Invalid Outlook credential initialization vector");
    }
    const cipher = createCipheriv(algorithm, this.key, iv, {
      authTagLength: authenticationTagBytes,
    });
    cipher.setAAD(additionalData(currentEnvelopeVersion, context));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      currentEnvelopeVersion,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  public decrypt(
    encrypted: string,
    context: OutlookGraphConnectionCipherContext,
  ): string {
    const parts = encrypted.split(".");
    const version = parts[0];
    if (
      parts.length !== 4 ||
      (version !== currentEnvelopeVersion && version !== legacyEnvelopeVersion)
    ) {
      throw new Error("Invalid encrypted Outlook credential");
    }
    const iv = decodePart(parts[1] ?? "", initializationVectorBytes);
    const tag = decodePart(parts[2] ?? "", authenticationTagBytes);
    const ciphertext = decodePart(parts[3] ?? "");
    const decipher = createDecipheriv(algorithm, this.key, iv, {
      authTagLength: authenticationTagBytes,
    });
    decipher.setAAD(additionalData(version, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}
