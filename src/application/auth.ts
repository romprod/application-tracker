import type { LoginInput } from "../domain/auth.js";

export interface PasswordVerifier {
  verify(password: string, encodedHash: string): Promise<boolean>;
}

export interface SessionTokenManager {
  hash(token: string): string;
  issue(): {
    sessionId: string;
    token: string;
    tokenHash: string;
  };
}

export interface LocalAccount {
  displayName: string;
  passwordHash: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  userId: string;
  username: string;
  workspaceId: string;
  workspaceName: string;
}

export interface NewSessionRecord {
  absoluteExpiresAt: string;
  createdAt: string;
  idleExpiresAt: string;
  sessionId: string;
  tokenHash: string;
  userId: string;
  workspaceId: string;
}

export interface ActiveSession {
  absoluteExpiresAt: string;
  displayName: string;
  lastSeenAt: string;
  role: "admin" | "member";
  sessionId: string;
  userId: string;
  username: string;
  workspaceId: string;
  workspaceName: string;
}

export interface AuthRepository {
  cleanupExpiredSessions(now: string): number;
  createSession(session: NewSessionRecord): void;
  findActiveSession(tokenHash: string, now: string): ActiveSession | undefined;
  findLocalAccount(username: string): LocalAccount | undefined;
  refreshSession(
    sessionId: string,
    lastSeenAt: string,
    idleExpiresAt: string,
    now: string,
  ): boolean;
  revokeSession(tokenHash: string, revokedAt: string): boolean;
}

export interface AuthenticatedSession {
  authenticated: true;
  user: {
    displayName: string;
    role: "admin" | "member";
    username: string;
  };
  workspace: {
    name: string;
  };
}

export interface AuthenticatedActor extends AuthenticatedSession {
  userId: string;
  workspaceId: string;
}

export interface LoginResult {
  session: AuthenticatedSession;
  token: string;
}

export interface SessionPolicy {
  absoluteDurationMs: number;
  dummyPasswordHash: string;
  idleDurationMs: number;
  loginAttemptLimit?: number;
  loginAttemptMaxTrackedKeys?: number;
  loginAttemptWindowMs?: number;
  maxConcurrentVerifications: number;
  refreshIntervalMs: number;
}

export class InvalidCredentialsError extends Error {
  public constructor() {
    super("The supplied credentials are invalid");
    this.name = "InvalidCredentialsError";
  }
}

export class LoginVerificationCapacityError extends Error {
  public constructor() {
    super("Login verification capacity is temporarily full");
    this.name = "LoginVerificationCapacityError";
  }
}

export class LoginAttemptRateLimitError extends Error {
  public constructor(public readonly retryAfterSeconds: number) {
    super("Login attempts are temporarily limited");
    this.name = "LoginAttemptRateLimitError";
  }
}

interface LoginAttemptWindow {
  count: number;
  startedAtMs: number;
}

function publicSession(
  session: ActiveSession | LocalAccount,
): AuthenticatedSession {
  return {
    authenticated: true,
    user: {
      displayName: session.displayName,
      role: session.role,
      username: session.username,
    },
    workspace: { name: session.workspaceName },
  };
}

function authenticatedActor(session: ActiveSession): AuthenticatedActor {
  return {
    ...publicSession(session),
    userId: session.userId,
    workspaceId: session.workspaceId,
  };
}

export class AuthService {
  private activePasswordVerifications = 0;
  private readonly loginAttemptLimit: number;
  private readonly loginAttemptMaxTrackedKeys: number;
  private readonly loginAttemptWindowMs: number;
  private readonly loginAttemptWindows = new Map<string, LoginAttemptWindow>();

  public constructor(
    private readonly repository: AuthRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly tokenManager: SessionTokenManager,
    private readonly policy: SessionPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.loginAttemptLimit = policy.loginAttemptLimit ?? 10;
    this.loginAttemptMaxTrackedKeys =
      policy.loginAttemptMaxTrackedKeys ?? 10000;
    this.loginAttemptWindowMs = policy.loginAttemptWindowMs ?? 60_000;
    if (
      !Number.isInteger(policy.maxConcurrentVerifications) ||
      policy.maxConcurrentVerifications < 1 ||
      !Number.isInteger(this.loginAttemptLimit) ||
      this.loginAttemptLimit < 1 ||
      !Number.isInteger(this.loginAttemptMaxTrackedKeys) ||
      this.loginAttemptMaxTrackedKeys < 2 ||
      !Number.isInteger(this.loginAttemptWindowMs) ||
      this.loginAttemptWindowMs < 1
    ) {
      throw new Error("Invalid login verification policy");
    }
  }

  private admitLoginAttempt(
    username: string,
    source: string,
    nowMs: number,
  ): void {
    const keys = [
      `account:${username.trim().toLowerCase()}`,
      `source:${source.slice(0, 128)}`,
    ];
    const windows = keys.map((key) => {
      const current = this.loginAttemptWindows.get(key);
      return !current ||
        nowMs - current.startedAtMs >= this.loginAttemptWindowMs
        ? { count: 0, startedAtMs: nowMs }
        : current;
    });
    const retryAfterMs = windows.reduce(
      (longest, window) =>
        window.count >= this.loginAttemptLimit
          ? Math.max(
              longest,
              window.startedAtMs + this.loginAttemptWindowMs - nowMs,
            )
          : longest,
      0,
    );
    if (retryAfterMs > 0) {
      throw new LoginAttemptRateLimitError(
        Math.max(1, Math.ceil(retryAfterMs / 1000)),
      );
    }

    keys.forEach((key, index) => {
      if (!this.loginAttemptWindows.has(key)) {
        while (
          this.loginAttemptWindows.size >= this.loginAttemptMaxTrackedKeys
        ) {
          const oldestKey = this.loginAttemptWindows.keys().next().value;
          if (typeof oldestKey !== "string") break;
          this.loginAttemptWindows.delete(oldestKey);
        }
      } else {
        this.loginAttemptWindows.delete(key);
      }
      const window = windows[index];
      if (!window) throw new Error("Missing login attempt window");
      this.loginAttemptWindows.set(key, {
        count: window.count + 1,
        startedAtMs: window.startedAtMs,
      });
    });
  }

  public async login(
    input: LoginInput,
    replacedToken?: string,
    attemptSource = "unknown",
  ): Promise<LoginResult> {
    if (
      this.activePasswordVerifications >= this.policy.maxConcurrentVerifications
    ) {
      throw new LoginVerificationCapacityError();
    }
    const now = this.clock();
    this.admitLoginAttempt(input.username, attemptSource, now.getTime());
    this.activePasswordVerifications += 1;
    try {
      const nowIso = now.toISOString();
      this.repository.cleanupExpiredSessions(nowIso);

      const account = this.repository.findLocalAccount(input.username);
      const passwordMatches = await this.passwordVerifier.verify(
        input.password,
        account?.passwordHash ?? this.policy.dummyPasswordHash,
      );
      if (!account || !passwordMatches || account.status !== "active") {
        throw new InvalidCredentialsError();
      }

      if (replacedToken) {
        this.repository.revokeSession(
          this.tokenManager.hash(replacedToken),
          nowIso,
        );
      }

      const issued = this.tokenManager.issue();
      this.repository.createSession({
        absoluteExpiresAt: new Date(
          now.getTime() + this.policy.absoluteDurationMs,
        ).toISOString(),
        createdAt: nowIso,
        idleExpiresAt: new Date(
          now.getTime() + this.policy.idleDurationMs,
        ).toISOString(),
        sessionId: issued.sessionId,
        tokenHash: issued.tokenHash,
        userId: account.userId,
        workspaceId: account.workspaceId,
      });

      return { session: publicSession(account), token: issued.token };
    } finally {
      this.activePasswordVerifications -= 1;
    }
  }

  public getActor(token?: string): AuthenticatedActor | undefined {
    if (!token) return undefined;

    const now = this.clock();
    const nowIso = now.toISOString();
    const session = this.repository.findActiveSession(
      this.tokenManager.hash(token),
      nowIso,
    );
    if (!session) return undefined;

    const lastSeen = new Date(session.lastSeenAt).getTime();
    if (now.getTime() - lastSeen >= this.policy.refreshIntervalMs) {
      const nextIdleExpiry = Math.min(
        now.getTime() + this.policy.idleDurationMs,
        new Date(session.absoluteExpiresAt).getTime(),
      );
      const refreshed = this.repository.refreshSession(
        session.sessionId,
        nowIso,
        new Date(nextIdleExpiry).toISOString(),
        nowIso,
      );
      if (!refreshed) return undefined;
    }

    return authenticatedActor(session);
  }

  public getSession(token?: string): AuthenticatedSession | undefined {
    const actor = this.getActor(token);
    return actor
      ? {
          authenticated: true,
          user: { ...actor.user },
          workspace: { ...actor.workspace },
        }
      : undefined;
  }

  public logout(token?: string): void {
    if (!token) return;
    this.repository.revokeSession(
      this.tokenManager.hash(token),
      this.clock().toISOString(),
    );
  }
}
