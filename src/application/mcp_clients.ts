import type { AuthenticatedActor } from "./auth.js";
import { InvalidMcpAccessTokenError } from "./mcp_oauth.js";
import type {
  RemoteMcpAuthorizer,
  RemoteMcpPrincipal,
} from "./mcp_remote_auth.js";

export interface McpClientActor {
  displayName: string;
  id: string;
  username: string;
}

export interface McpClient {
  actor: McpClientActor;
  clientId: string;
  createdAt: string;
  lastUsedAt: string | null;
  name: string;
  rotatedAt: string | null;
  state: "active" | "revoked" | "unavailable";
}

export interface McpClientDirectory {
  actors: McpClientActor[];
  clients: McpClient[];
}

export interface IssuedMcpClientCredential {
  bearerToken: string;
  client: McpClient;
}

export interface NewMcpClientCredential {
  bearerToken: string;
  clientId: string;
  tokenHash: string;
}

export interface McpClientTokenManager {
  issue(clientId?: string): NewMcpClientCredential;
  matches(tokenSecret: string, expectedHash: string): boolean;
  parse(
    bearerToken: string,
  ): { clientId: string; tokenSecret: string } | undefined;
}

export interface CreateMcpClientRecord {
  actorUserId: string;
  clientId: string;
  createdAt: string;
  createdByUserId: string;
  name: string;
  tokenHash: string;
  workspaceId: string;
}

export interface McpClientCredentialRecord {
  actor: AuthenticatedActor;
  clientId: string;
  tokenHash: string;
  workspaceSlug: string;
}

export interface McpClientsRepository {
  countActive(workspaceId: string): number;
  create(input: CreateMcpClientRecord): McpClient;
  findCredential(clientId: string): McpClientCredentialRecord | undefined;
  listActors(workspaceId: string): McpClientActor[];
  listClients(workspaceId: string): McpClient[];
  markUsed(clientId: string, usedAt: string): void;
  revoke(input: {
    clientId: string;
    revokedAt: string;
    revokedByUserId: string;
    workspaceId: string;
  }): McpClient;
  rotate(input: {
    clientId: string;
    rotatedAt: string;
    tokenHash: string;
    workspaceId: string;
  }): McpClient;
}

export class McpClientForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "McpClientForbiddenError";
  }
}

export class McpClientNotFoundError extends Error {
  public constructor() {
    super("The MCP client was not found");
    this.name = "McpClientNotFoundError";
  }
}

export class McpClientActorUnavailableError extends Error {
  public constructor() {
    super("The selected MCP actor is unavailable");
    this.name = "McpClientActorUnavailableError";
  }
}

export class McpClientLimitError extends Error {
  public constructor() {
    super("The workspace MCP client limit has been reached");
    this.name = "McpClientLimitError";
  }
}

const maximumActiveClients = 100;

function requireAdministrator(actor: AuthenticatedActor): void {
  if (actor.user.role !== "admin") throw new McpClientForbiddenError();
}

export class McpClientCredentialsService implements RemoteMcpAuthorizer {
  public constructor(
    private readonly repository: McpClientsRepository,
    private readonly tokens: McpClientTokenManager,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public getDirectory(actor: AuthenticatedActor): McpClientDirectory {
    requireAdministrator(actor);
    return {
      actors: this.repository.listActors(actor.workspaceId),
      clients: this.repository.listClients(actor.workspaceId),
    };
  }

  public create(
    actor: AuthenticatedActor,
    input: { actorUserId: string; name: string },
  ): IssuedMcpClientCredential {
    requireAdministrator(actor);
    if (
      this.repository.countActive(actor.workspaceId) >= maximumActiveClients
    ) {
      throw new McpClientLimitError();
    }
    const credential = this.tokens.issue();
    const client = this.repository.create({
      actorUserId: input.actorUserId,
      clientId: credential.clientId,
      createdAt: this.clock().toISOString(),
      createdByUserId: actor.userId,
      name: input.name.trim(),
      tokenHash: credential.tokenHash,
      workspaceId: actor.workspaceId,
    });
    return { bearerToken: credential.bearerToken, client };
  }

  public rotate(
    actor: AuthenticatedActor,
    clientId: string,
  ): IssuedMcpClientCredential {
    requireAdministrator(actor);
    const credential = this.tokens.issue(clientId);
    const client = this.repository.rotate({
      clientId,
      rotatedAt: this.clock().toISOString(),
      tokenHash: credential.tokenHash,
      workspaceId: actor.workspaceId,
    });
    return { bearerToken: credential.bearerToken, client };
  }

  public revoke(actor: AuthenticatedActor, clientId: string): McpClient {
    requireAdministrator(actor);
    return this.repository.revoke({
      clientId,
      revokedAt: this.clock().toISOString(),
      revokedByUserId: actor.userId,
      workspaceId: actor.workspaceId,
    });
  }

  public authorize(token: string): RemoteMcpPrincipal {
    const parsed = this.tokens.parse(token);
    if (!parsed) throw new InvalidMcpAccessTokenError();
    const credential = this.repository.findCredential(parsed.clientId);
    if (
      !credential ||
      !this.tokens.matches(parsed.tokenSecret, credential.tokenHash)
    ) {
      throw new InvalidMcpAccessTokenError();
    }
    this.repository.markUsed(credential.clientId, this.clock().toISOString());
    return {
      actor: credential.actor,
      principalId: `client:${credential.clientId}:${credential.tokenHash}`,
      workspaceSlug: credential.workspaceSlug,
    };
  }
}
