import type { AuthenticatedActor } from "./auth.js";
import type { McpAccessMode } from "./mcp_access.js";

export interface RemoteMcpPrincipal {
  accessMode: McpAccessMode;
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
    private readonly fallbackOauth?: RemoteMcpAuthorizer,
  ) {}

  public authorize(
    token: string,
  ): Promise<RemoteMcpPrincipal> | RemoteMcpPrincipal {
    if (token.startsWith("atmcp_")) {
      return this.clientCredentials.authorize(token);
    }
    if (token.startsWith("atoat_") && this.oauth) {
      return this.oauth.authorize(token);
    }
    if (this.fallbackOauth) return this.fallbackOauth.authorize(token);
    return this.oauth
      ? this.oauth.authorize(token)
      : this.clientCredentials.authorize(token);
  }
}
