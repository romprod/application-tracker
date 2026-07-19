import { describe, expect, it, vi } from "vitest";

import {
  AuthService,
  InvalidCredentialsError,
  LoginVerificationCapacityError,
  type AuthRepository,
  type PasswordVerifier,
  type SessionTokenManager,
} from "./auth.js";

function authService(
  passwordVerifier: PasswordVerifier,
  options: {
    clock?: () => Date;
    loginAttemptLimit?: number;
    loginAttemptWindowMs?: number;
  } = {},
): AuthService {
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
  return new AuthService(
    repository,
    passwordVerifier,
    tokenManager,
    {
      absoluteDurationMs: 86_400_000,
      dummyPasswordHash: "dummy-password-hash",
      idleDurationMs: 1_800_000,
      loginAttemptLimit: options.loginAttemptLimit ?? 100,
      loginAttemptMaxTrackedKeys: 1000,
      loginAttemptWindowMs: options.loginAttemptWindowMs ?? 60_000,
      maxConcurrentVerifications: 1,
      refreshIntervalMs: 60_000,
    },
    options.clock,
  );
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

  it("limits replenished password checks by source and normalized account", async () => {
    let nowMs = 1_000;
    const verify = vi.fn<PasswordVerifier["verify"]>(() =>
      Promise.resolve(false),
    );
    const service = authService(
      { verify },
      {
        clock: () => new Date(nowMs),
        loginAttemptLimit: 2,
        loginAttemptWindowMs: 60_000,
      },
    );

    for (const username of ["missing-one", "missing-two"]) {
      await expect(
        service.login(
          { password: "wrong password", username },
          undefined,
          "192.0.2.1",
        ),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(
      service.login(
        { password: "wrong password", username: "missing-three" },
        undefined,
        "192.0.2.1",
      ),
    ).rejects.toMatchObject({ name: "LoginAttemptRateLimitError" });
    expect(verify).toHaveBeenCalledTimes(2);

    nowMs += 60_000;
    await expect(
      service.login(
        { password: "wrong password", username: "missing-three" },
        undefined,
        "192.0.2.1",
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    await expect(
      service.login(
        { password: "wrong password", username: "Target-Account" },
        undefined,
        "192.0.2.2",
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      service.login(
        { password: "wrong password", username: "target-account" },
        undefined,
        "192.0.2.3",
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      service.login(
        { password: "wrong password", username: "TARGET-ACCOUNT" },
        undefined,
        "192.0.2.4",
      ),
    ).rejects.toMatchObject({ name: "LoginAttemptRateLimitError" });
    expect(verify).toHaveBeenCalledTimes(5);
  });
});
