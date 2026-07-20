import type { AuthenticatedActor } from "./auth.js";

export type McpAccessMode = "read_only" | "read_write";

export interface McpAccessRepository {
  getAccessMode(workspaceId: string): McpAccessMode;
  setAccessMode(input: {
    accessMode: McpAccessMode;
    updatedAt: string;
    updatedByUserId: string;
    workspaceId: string;
  }): void;
}

export class McpAccessForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "McpAccessForbiddenError";
  }
}

export class McpWriteAccessDisabledError extends Error {
  public constructor() {
    super("MCP write access is disabled for this connection");
    this.name = "McpWriteAccessDisabledError";
  }
}

export class McpConnectionAccessPolicy {
  public constructor(private accessMode: McpAccessMode) {}

  public getAccessMode(): McpAccessMode {
    return this.accessMode;
  }

  public requireWriteAccess(): void {
    if (this.accessMode !== "read_write") {
      throw new McpWriteAccessDisabledError();
    }
  }

  public update(accessMode: McpAccessMode): void {
    this.accessMode = accessMode;
  }
}

export class McpAccessService {
  public constructor(
    private readonly repository: McpAccessRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public getAccessMode(workspaceId: string): McpAccessMode {
    return this.repository.getAccessMode(workspaceId);
  }

  public getAdministratorAccessMode(actor: AuthenticatedActor): McpAccessMode {
    this.requireAdministrator(actor);
    return this.getAccessMode(actor.workspaceId);
  }

  public requireWriteAccess(actor: AuthenticatedActor): void {
    if (this.getAccessMode(actor.workspaceId) !== "read_write") {
      throw new McpWriteAccessDisabledError();
    }
  }

  public setAdministratorAccessMode(
    actor: AuthenticatedActor,
    accessMode: McpAccessMode,
  ): void {
    this.requireAdministrator(actor);
    this.repository.setAccessMode({
      accessMode,
      updatedAt: this.clock().toISOString(),
      updatedByUserId: actor.userId,
      workspaceId: actor.workspaceId,
    });
  }

  private requireAdministrator(actor: AuthenticatedActor): void {
    if (actor.user.role !== "admin") throw new McpAccessForbiddenError();
  }
}
