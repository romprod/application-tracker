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

  public constructor(
    private readonly repository: AuthRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly tokenManager: SessionTokenManager,
    private readonly policy: SessionPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (
      !Number.isInteger(policy.maxConcurrentVerifications) ||
      policy.maxConcurrentVerifications < 1
    ) {
      throw new Error("Invalid login verification policy");
    }
  }

  public async login(
    input: LoginInput,
    replacedToken?: string,
  ): Promise<LoginResult> {
    if (
      this.activePasswordVerifications >= this.policy.maxConcurrentVerifications
    ) {
      throw new LoginVerificationCapacityError();
    }
    this.activePasswordVerifications += 1;
    try {
      const now = this.clock();
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
