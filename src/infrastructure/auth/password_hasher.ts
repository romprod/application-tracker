import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import type { PasswordHasher } from "../../application/setup.js";

interface ScryptOptions {
  blockSize?: number;
  cost?: number;
  keyLength?: number;
  maxMemory?: number;
  parallelization?: number;
  saltLength?: number;
}

interface ResolvedScryptOptions {
  blockSize: number;
  cost: number;
  keyLength: number;
  maxMemory: number;
  parallelization: number;
  saltLength: number;
}

const defaultOptions: ResolvedScryptOptions = {
  blockSize: 8,
  cost: 131_072,
  keyLength: 64,
  maxMemory: 268_435_456,
  parallelization: 1,
  saltLength: 16,
};

function deriveKey(
  password: string,
  salt: Buffer,
  options: ResolvedScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      options.keyLength,
      {
        N: options.cost,
        maxmem: options.maxMemory,
        p: options.parallelization,
        r: options.blockSize,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export class ScryptPasswordHasher implements PasswordHasher {
  private readonly options: ResolvedScryptOptions;

  public constructor(options: ScryptOptions = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  public async hash(password: string): Promise<string> {
    const salt = randomBytes(this.options.saltLength);
    const derivedKey = await deriveKey(password, salt, this.options);

    return [
      "scrypt",
      this.options.cost,
      this.options.blockSize,
      this.options.parallelization,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  public async verify(password: string, encodedHash: string): Promise<boolean> {
    const parts = encodedHash.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") {
      return false;
    }

    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const parallelization = Number(parts[3]);
    if (
      !Number.isSafeInteger(cost) ||
      cost < 1024 ||
      cost > 262_144 ||
      (cost & (cost - 1)) !== 0 ||
      blockSize !== 8 ||
      parallelization !== 1 ||
      !parts[4] ||
      !parts[5]
    ) {
      return false;
    }

    try {
      const salt = Buffer.from(parts[4], "base64url");
      const expected = Buffer.from(parts[5], "base64url");
      if (salt.length < 16 || expected.length !== this.options.keyLength) {
        return false;
      }

      const actual = await deriveKey(password, salt, {
        ...this.options,
        blockSize,
        cost,
        parallelization,
      });
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
