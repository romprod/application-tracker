import type { AuthenticatedActor } from "./auth.js";

export const supportedMcpOAuthAlgorithms = ["ES256", "RS256"] as const;

export type McpOAuthAlgorithm = (typeof supportedMcpOAuthAlgorithms)[number];

export interface McpOAuthConfig {
  algorithm: McpOAuthAlgorithm;
  audience: string;
  issuer: string;
  jwksUrl: string;
  requiredScope: string;
  workspaceSlug: string;
}

export interface VerifiedMcpAccessToken {
  issuer: string;
  scopes: ReadonlySet<string>;
  subject: string;
}

export interface McpAccessTokenVerifier {
  verify(token: string): Promise<VerifiedMcpAccessToken>;
}

export interface RemoteMcpActorBinding {
  issuer: string;
  subject: string;
  workspaceSlug: string;
}

export interface RemoteMcpActorRepository {
  findActiveActor(
    binding: RemoteMcpActorBinding,
  ): AuthenticatedActor | undefined;
}

export class InvalidMcpAccessTokenError extends Error {
  public constructor() {
    super("The MCP access token is invalid");
    this.name = "InvalidMcpAccessTokenError";
  }
}

export class InsufficientMcpScopeError extends Error {
  public constructor(public readonly requiredScope: string) {
    super("The MCP access token does not grant the required scope");
    this.name = "InsufficientMcpScopeError";
  }
}

export class RemoteMcpActorUnavailableError extends Error {
  public constructor() {
    super("The MCP identity is not authorized for the configured workspace");
    this.name = "RemoteMcpActorUnavailableError";
  }
}

export class RemoteMcpAuthorizationService {
  public constructor(
    private readonly verifier: McpAccessTokenVerifier,
    private readonly actors: RemoteMcpActorRepository,
    private readonly requiredScope: string,
    private readonly workspaceSlug: string,
  ) {}

  public async authorize(token: string): Promise<AuthenticatedActor> {
    const verified = await this.verifier.verify(token);
    if (!verified.scopes.has(this.requiredScope)) {
      throw new InsufficientMcpScopeError(this.requiredScope);
    }

    const actor = this.actors.findActiveActor({
      issuer: verified.issuer,
      subject: verified.subject,
      workspaceSlug: this.workspaceSlug,
    });
    if (!actor) throw new RemoteMcpActorUnavailableError();
    return actor;
  }
}
