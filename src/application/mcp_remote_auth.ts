import type { AuthenticatedActor } from "./auth.js";

export interface RemoteMcpPrincipal {
  actor: AuthenticatedActor;
  principalId: string;
  workspaceSlug: string;
}

export interface RemoteMcpAuthorizer {
  authorize(token: string): Promise<RemoteMcpPrincipal> | RemoteMcpPrincipal;
}

export class CompositeRemoteMcpAuthorizer implements RemoteMcpAuthorizer {
  public constructor(
    private readonly clientCredentials: RemoteMcpAuthorizer,
    private readonly oauth?: RemoteMcpAuthorizer,
  ) {}

  public authorize(
    token: string,
  ): Promise<RemoteMcpPrincipal> | RemoteMcpPrincipal {
    return token.startsWith("atmcp_") || !this.oauth
      ? this.clientCredentials.authorize(token)
      : this.oauth.authorize(token);
  }
}
