import { browserApiFetch } from "./browser_api_fetch";

export interface ExternalIdentityLink {
  createdAt: string;
  id: string;
  subject: string;
}

export interface ManagedUser {
  createdAt: string;
  displayName: string;
  externalIdentities: ExternalIdentityLink[];
  id: string;
  isCurrentUser: boolean;
  localAccount: boolean;
  role: "admin" | "member";
  status: "active" | "disabled";
  username: string;
}

export interface UserDirectory {
  externalIdentityProviderConfigured: boolean;
  users: ManagedUser[];
}

export interface CreateLocalUserInput {
  displayName: string;
  password: string;
  role: "admin" | "member";
  username: string;
}

export interface UsersClient {
  createUser(input: CreateLocalUserInput): Promise<ManagedUser>;
  linkExternalIdentity(userId: string, subject: string): Promise<ManagedUser>;
  listUsers(): Promise<UserDirectory>;
  setStatus(
    userId: string,
    status: "active" | "disabled",
  ): Promise<ManagedUser>;
  unlinkExternalIdentity(
    userId: string,
    identityId: string,
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
    !Array.isArray(value.externalIdentities) ||
    typeof value.id !== "string" ||
    typeof value.isCurrentUser !== "boolean" ||
    typeof value.localAccount !== "boolean" ||
    (value.role !== "admin" && value.role !== "member") ||
    (value.status !== "active" && value.status !== "disabled") ||
    typeof value.username !== "string"
  ) {
    throw new UsersClientError("invalid_response");
  }
  const externalIdentities = value.externalIdentities.map((identity) => {
    if (
      !isRecord(identity) ||
      typeof identity.createdAt !== "string" ||
      typeof identity.id !== "string" ||
      typeof identity.subject !== "string"
    ) {
      throw new UsersClientError("invalid_response");
    }
    return {
      createdAt: identity.createdAt,
      id: identity.id,
      subject: identity.subject,
    };
  });
  return {
    createdAt: value.createdAt,
    displayName: value.displayName,
    externalIdentities,
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
    const response = await browserApiFetch("/api/settings/users", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await successfulBody(response);
    if (
      !isRecord(body) ||
      typeof body.externalIdentityProviderConfigured !== "boolean" ||
      !Array.isArray(body.users)
    ) {
      throw new UsersClientError("invalid_response");
    }
    return {
      externalIdentityProviderConfigured:
        body.externalIdentityProviderConfigured,
      users: body.users.map(parseUser),
    };
  },

  async createUser(input) {
    const response = await browserApiFetch("/api/settings/users", {
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
    const response = await browserApiFetch(
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

  async linkExternalIdentity(userId, subject) {
    const response = await browserApiFetch(
      `/api/settings/users/${encodeURIComponent(userId)}/external-identities`,
      {
        body: JSON.stringify({ subject }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    return parseUserResponse(await successfulBody(response));
  },

  async unlinkExternalIdentity(userId, identityId) {
    const response = await browserApiFetch(
      `/api/settings/users/${encodeURIComponent(userId)}/external-identities/${encodeURIComponent(identityId)}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
    return parseUserResponse(await successfulBody(response));
  },
};
