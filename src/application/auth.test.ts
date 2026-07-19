import { describe, expect, it, vi } from "vitest";

import {
  AuthService,
  InvalidCredentialsError,
  LoginVerificationCapacityError,
  type AuthRepository,
  type PasswordVerifier,
  type SessionTokenManager,
} from "./auth.js";

function authService(passwordVerifier: PasswordVerifier): AuthService {
  const repository: AuthRepository = {
    cleanupExpiredSessions: vi.fn(() => 0),
    createSession: vi.fn(),
    findActiveSession: vi.fn(() => undefined),
    findLocalAccount: vi.fn(() => undefined),
    refreshSession: vi.fn(() => false),
    revokeSession: vi.fn(() => false),
  };
  const tokenManager: SessionTokenManager = {
    hash: vi.fn((token) => `hashed:${token}`),
    issue: vi.fn(() => ({
      sessionId: "session-1",
      token: "token-1",
      tokenHash: "token-hash-1",
    })),
  };
  return new AuthService(repository, passwordVerifier, tokenManager, {
    absoluteDurationMs: 86_400_000,
    dummyPasswordHash: "dummy-password-hash",
    idleDurationMs: 1_800_000,
    maxConcurrentVerifications: 1,
    refreshIntervalMs: 60_000,
  });
}

describe("AuthService login verification admission", () => {
  it("rejects excess logins before starting another password verification", async () => {
    let finishVerification: ((matches: boolean) => void) | undefined;
    const verify = vi.fn<PasswordVerifier["verify"]>(
      () =>
        new Promise<boolean>((resolve) => {
          finishVerification = resolve;
        }),
    );
    const service = authService({ verify });
    const first = service.login({
      password: "first password",
      username: "one",
    });
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));

    await expect(
      service.login({ password: "second password", username: "two" }),
    ).rejects.toBeInstanceOf(LoginVerificationCapacityError);
    expect(verify).toHaveBeenCalledTimes(1);

    finishVerification?.(false);
    await expect(first).rejects.toBeInstanceOf(InvalidCredentialsError);

    verify.mockResolvedValueOnce(false);
    await expect(
      service.login({ password: "third password", username: "three" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});
