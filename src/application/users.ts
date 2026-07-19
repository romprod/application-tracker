import type { AuthenticatedActor } from "./auth.js";
import type { PasswordHasher } from "./setup.js";
import type {
  CreateExternalIdentityInput,
  CreateLocalUserInput,
  UpdateUserStatusInput,
} from "../domain/users.js";

export interface ExternalIdentityLink {
  createdAt: string;
  id: string;
  subject: string;
}

export interface WorkspaceUser {
  createdAt: string;
  displayName: string;
  externalIdentities: ExternalIdentityLink[];
  id: string;
  localAccount: boolean;
  role: "admin" | "member";
  status: "active" | "disabled";
  username: string;
}

export interface ManagedUser extends WorkspaceUser {
  isCurrentUser: boolean;
}

export interface CreateLocalUserRecord {
  createdAt: string;
  displayName: string;
  passwordHash: string;
  role: "admin" | "member";
  username: string;
  workspaceId: string;
}

export interface SetUserStatusRecord {
  changedAt: string;
  status: "active" | "disabled";
  userId: string;
  workspaceId: string;
}

export interface CreateExternalIdentityRecord extends CreateExternalIdentityInput {
  createdAt: string;
  issuer: string;
  userId: string;
  workspaceId: string;
}

export interface DeleteExternalIdentityRecord {
  identityId: string;
  issuer: string;
  userId: string;
  workspaceId: string;
}

export interface UsersRepository {
  createExternalIdentity(
    input: CreateExternalIdentityRecord,
  ): ExternalIdentityLink;
  createLocalUser(input: CreateLocalUserRecord): WorkspaceUser;
  deleteExternalIdentity(input: DeleteExternalIdentityRecord): void;
  listWorkspaceUsers(
    workspaceId: string,
    externalIdentityIssuer?: string,
  ): WorkspaceUser[];
  setUserStatus(input: SetUserStatusRecord): WorkspaceUser;
}

export class UserAdministrationForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "UserAdministrationForbiddenError";
  }
}

export class UsernameUnavailableError extends Error {
  public constructor() {
    super("The username is unavailable");
    this.name = "UsernameUnavailableError";
  }
}

export class ManagedUserNotFoundError extends Error {
  public constructor() {
    super("The workspace user was not found");
    this.name = "ManagedUserNotFoundError";
  }
}

export class ExternalIdentityUnavailableError extends Error {
  public constructor() {
    super("The external identity is unavailable");
    this.name = "ExternalIdentityUnavailableError";
  }
}

export class ManagedExternalIdentityNotFoundError extends Error {
  public constructor() {
    super("The external identity link was not found");
    this.name = "ManagedExternalIdentityNotFoundError";
  }
}

export class CannotDisableCurrentUserError extends Error {
  public constructor() {
    super("The current user cannot disable their own account");
    this.name = "CannotDisableCurrentUserError";
  }
}

function requireAdministrator(actor: AuthenticatedActor): void {
  if (actor.user.role !== "admin") {
    throw new UserAdministrationForbiddenError();
  }
}

function forActor(user: WorkspaceUser, actor: AuthenticatedActor): ManagedUser {
  return { ...user, isCurrentUser: user.id === actor.userId };
}

export class UserAdministrationService {
  public constructor(
    private readonly repository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public listUsers(actor: AuthenticatedActor): ManagedUser[] {
    requireAdministrator(actor);
    return this.repository
      .listWorkspaceUsers(actor.workspaceId)
      .map((user) => forActor(user, actor));
  }

  public async createLocalUser(
    actor: AuthenticatedActor,
    input: CreateLocalUserInput,
  ): Promise<ManagedUser> {
    requireAdministrator(actor);
    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = this.repository.createLocalUser({
      createdAt: this.clock().toISOString(),
      displayName: input.displayName,
      passwordHash,
      role: input.role,
      username: input.username,
      workspaceId: actor.workspaceId,
    });
    return forActor(user, actor);
  }

  public setUserStatus(
    actor: AuthenticatedActor,
    userId: string,
    input: UpdateUserStatusInput,
  ): ManagedUser {
    requireAdministrator(actor);
    if (userId === actor.userId && input.status === "disabled") {
      throw new CannotDisableCurrentUserError();
    }
    const user = this.repository.setUserStatus({
      changedAt: this.clock().toISOString(),
      status: input.status,
      userId,
      workspaceId: actor.workspaceId,
    });
    return forActor(user, actor);
  }
}
