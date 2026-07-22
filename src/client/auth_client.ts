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

export interface UnauthenticatedSession {
  authenticated: false;
}

export type AuthSession = AuthenticatedSession | UnauthenticatedSession;

export interface LoginInput {
  password: string;
  username: string;
}

export interface AuthClient {
  getSession(): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthenticatedSession>;
  logout(): Promise<void>;
}

export class AuthClientError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "AuthClientError";
  }
}

const maximumRetryAfterSeconds = 3_600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AuthClientError("invalid_response");
  }
}

function errorCode(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }
  return "request_failed";
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1) return undefined;
  return Math.min(seconds, maximumRetryAfterSeconds);
}

function parseSession(value: unknown): AuthSession {
  if (!isRecord(value) || typeof value.authenticated !== "boolean") {
    throw new AuthClientError("invalid_response");
  }
  if (!value.authenticated) return { authenticated: false };
  if (
    !isRecord(value.user) ||
    !isRecord(value.workspace) ||
    typeof value.user.displayName !== "string" ||
    (value.user.role !== "admin" && value.user.role !== "member") ||
    typeof value.user.username !== "string" ||
    typeof value.workspace.name !== "string"
  ) {
    throw new AuthClientError("invalid_response");
  }
  return {
    authenticated: true,
    user: {
      displayName: value.user.displayName,
      role: value.user.role,
      username: value.user.username,
    },
    workspace: { name: value.workspace.name },
  };
}

async function readSessionResponse(response: Response): Promise<AuthSession> {
  const body = await readResponse(response);
  if (!response.ok) {
    throw new AuthClientError(errorCode(body), retryAfterSeconds(response));
  }
  return parseSession(body);
}

export const browserAuthClient: AuthClient = {
  async getSession() {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    return readSessionResponse(response);
  },

  async login(input) {
    const response = await fetch("/api/auth/login", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const session = await readSessionResponse(response);
    if (!session.authenticated) throw new AuthClientError("invalid_response");
    return session;
  },

  async logout() {
    const response = await fetch("/api/auth/logout", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      const body = await readResponse(response);
      throw new AuthClientError(errorCode(body));
    }
  },
};
