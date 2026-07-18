export interface ManagedUser {
  createdAt: string;
  displayName: string;
  id: string;
  isCurrentUser: boolean;
  localAccount: boolean;
  role: "admin" | "member";
  status: "active" | "disabled";
  username: string;
}

export interface CreateLocalUserInput {
  displayName: string;
  password: string;
  role: "admin" | "member";
  username: string;
}

export interface UsersClient {
  createUser(input: CreateLocalUserInput): Promise<ManagedUser>;
  listUsers(): Promise<ManagedUser[]>;
  setStatus(
    userId: string,
    status: "active" | "disabled",
  ): Promise<ManagedUser>;
}

export class UsersClientError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "UsersClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new UsersClientError("invalid_response");
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

function parseUser(value: unknown): ManagedUser {
  if (
    !isRecord(value) ||
    typeof value.createdAt !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.id !== "string" ||
    typeof value.isCurrentUser !== "boolean" ||
    typeof value.localAccount !== "boolean" ||
    (value.role !== "admin" && value.role !== "member") ||
    (value.status !== "active" && value.status !== "disabled") ||
    typeof value.username !== "string"
  ) {
    throw new UsersClientError("invalid_response");
  }
  return {
    createdAt: value.createdAt,
    displayName: value.displayName,
    id: value.id,
    isCurrentUser: value.isCurrentUser,
    localAccount: value.localAccount,
    role: value.role,
    status: value.status,
    username: value.username,
  };
}

async function successfulBody(response: Response): Promise<unknown> {
  const body = await readResponse(response);
  if (!response.ok) throw new UsersClientError(errorCode(body));
  return body;
}

function parseUserResponse(value: unknown): ManagedUser {
  if (!isRecord(value)) throw new UsersClientError("invalid_response");
  return parseUser(value.user);
}

export const browserUsersClient: UsersClient = {
  async listUsers() {
    const response = await fetch("/api/settings/users", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await successfulBody(response);
    if (!isRecord(body) || !Array.isArray(body.users)) {
      throw new UsersClientError("invalid_response");
    }
    return body.users.map(parseUser);
  },

  async createUser(input) {
    const response = await fetch("/api/settings/users", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    return parseUserResponse(await successfulBody(response));
  },

  async setStatus(userId, status) {
    const response = await fetch(
      `/api/settings/users/${encodeURIComponent(userId)}/status`,
      {
        body: JSON.stringify({ status }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      },
    );
    return parseUserResponse(await successfulBody(response));
  },
};
