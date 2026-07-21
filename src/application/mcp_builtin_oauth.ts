import { randomUUID } from "node:crypto";

import type { AuthenticatedActor } from "./auth.js";
import type { McpAccessMode } from "./mcp_access.js";
import { InvalidMcpAccessTokenError } from "./mcp_oauth.js";
import type { RemoteMcpPrincipal } from "./mcp_remote_auth.js";

export interface McpOAuthClient {
  clientId: string;
  clientName: string;
  createdAt: string;
  redirectUris: string[];
}

export interface McpOAuthConnection {
  accessMode: McpAccessMode;
  actor: {
    displayName: string;
    id: string;
    username: string;
  };
  clientId: string;
  createdAt: string;
  lastUsedAt: string;
  name: string;
  state: "active" | "revoked";
}

export interface McpOAuthAuthorizationCodeRecord {
  accessMode: McpAccessMode;
  clientId: string;
  codeChallenge: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  redirectUri: string;
  resource: string;
  scope: string;
  userId: string;
  workspaceId: string;
}

export interface McpOAuthIssuedTokenRecord {
  accessMode: McpAccessMode;
  clientId: string;
  expiresAt: string;
  familyId: string;
  id: string;
  issuedAt: string;
  resource: string;
  scope: string;
  tokenHash: string;
  tokenKind: "access" | "refresh";
  userId: string;
  workspaceId: string;
}

export interface McpOAuthRefreshGrant {
  accessMode: McpAccessMode;
  clientId: string;
  familyId: string;
  resource: string;
  scope: string;
  userId: string;
  workspaceId: string;
}

export interface McpBuiltInOAuthRepository {
  challengeForAuthorizationCode(input: {
    clientId: string;
    codeHash: string;
    now: string;
  }): string | undefined;
  consumeAuthorizationCode(input: {
    access: McpOAuthIssuedTokenRecord;
    clientId: string;
    codeHash: string;
    now: string;
    redirectUri: string;
    refresh: McpOAuthIssuedTokenRecord;
    resource: string;
  }): boolean;
  consumeRefreshToken(input: {
    access: McpOAuthIssuedTokenRecord;
    clientId: string;
    now: string;
    refresh: McpOAuthIssuedTokenRecord;
    refreshTokenHash: string;
    resource: string;
  }): boolean;
  createAuthorizationCode(record: McpOAuthAuthorizationCodeRecord): void;
  createClient(input: {
    clientId: string;
    clientName: string;
    createdAt: string;
    redirectUris: string[];
  }): McpOAuthClient;
  deleteConnection(input: {
    actorUserId: string;
    clientId: string;
    workspaceId: string;
  }): boolean;
  findActiveAccessToken(input: {
    now: string;
    tokenHash: string;
  }): RemoteMcpPrincipal | undefined;
  findClient(clientId: string): McpOAuthClient | undefined;
  findRefreshGrant(input: {
    clientId: string;
    now: string;
    refreshTokenHash: string;
  }): McpOAuthRefreshGrant | undefined;
  listConnections(input: {
    now: string;
    workspaceId: string;
  }): McpOAuthConnection[];
  revokeToken(input: {
    clientId: string;
    revokedAt: string;
    tokenHash: string;
  }): void;
}

export interface McpOAuthOpaqueTokenManager {
  hash(token: string): string;
  issueAccessToken(): string;
  issueAuthorizationCode(): string;
  issueClientId(): string;
  issueRefreshToken(): string;
  isAccessToken(token: string): boolean;
}

export interface McpOAuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  scope: string;
  tokenType: "Bearer";
}

export class InvalidMcpOAuthClientError extends Error {
  public constructor() {
    super("The OAuth client is invalid");
    this.name = "InvalidMcpOAuthClientError";
  }
}

export class InvalidMcpOAuthGrantError extends InvalidMcpAccessTokenError {
  public constructor() {
    super();
    this.name = "InvalidMcpOAuthGrantError";
  }
}

export class McpOAuthConnectionForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "McpOAuthConnectionForbiddenError";
  }
}

export class McpOAuthConnectionNotFoundError extends Error {
  public constructor() {
    super("The OAuth connection was not found");
    this.name = "McpOAuthConnectionNotFoundError";
  }
}

export const claudeMcpOAuthCallback = "https://claude.ai/api/mcp/auth_callback";
export const chatGptMcpOAuthCallbackOrigin = "https://chatgpt.com";
export const chatGptLegacyMcpOAuthCallback =
  "https://chatgpt.com/connector_platform_oauth_redirect";
export const hostedMcpOAuthCallbackOrigins = [
  new URL(claudeMcpOAuthCallback).origin,
  chatGptMcpOAuthCallbackOrigin,
];
export const builtInMcpOAuthScope = "application-tracker:tools";
const accessLifetimeMs = 15 * 60 * 1000;
const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const authorizationCodeLifetimeMs = 5 * 60 * 1000;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const chatGptCallbackPathPrefix = "/connector/oauth/";

function trustedChatGptRedirectUri(url: URL): boolean {
  const callbackId = url.pathname.slice(chatGptCallbackPathPrefix.length);
  return (
    url.origin === chatGptMcpOAuthCallbackOrigin &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith(chatGptCallbackPathPrefix) &&
    callbackId.length > 0 &&
    callbackId.length <= 512 &&
    !callbackId.includes("/") &&
    url.search === "" &&
    url.hash === ""
  );
}

export function isTrustedMcpOAuthRedirectUri(value: string): boolean {
  if (
    value === claudeMcpOAuthCallback ||
    value === chatGptLegacyMcpOAuthCallback
  ) {
    return true;
  }
  try {
    const url = new URL(value);
    if (trustedChatGptRedirectUri(url)) return true;
    return (
      url.protocol === "http:" &&
      loopbackHosts.has(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  try {
    const requestedUrl = new URL(requested);
    const registeredUrl = new URL(registered);
    return (
      loopbackHosts.has(requestedUrl.hostname) &&
      loopbackHosts.has(registeredUrl.hostname) &&
      requestedUrl.protocol === registeredUrl.protocol &&
      requestedUrl.hostname === registeredUrl.hostname &&
      requestedUrl.pathname === registeredUrl.pathname &&
      requestedUrl.search === registeredUrl.search &&
      requestedUrl.hash === registeredUrl.hash
    );
  } catch {
    return false;
  }
}

function scopeValue(scopes: readonly string[], requiredScope: string): string {
  const unique = new Set(scopes.length === 0 ? [requiredScope] : scopes);
  if (unique.size !== 1 || !unique.has(requiredScope)) {
    throw new InvalidMcpOAuthGrantError();
  }
  return requiredScope;
}

export class McpBuiltInOAuthService {
  public constructor(
    private readonly repository: McpBuiltInOAuthRepository,
    private readonly tokens: McpOAuthOpaqueTokenManager,
    private readonly config: { requiredScope: string; resourceUrl: string },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public registerClient(input: {
    clientName?: string;
    redirectUris: string[];
  }): McpOAuthClient {
    const clientName = input.clientName?.trim() || "MCP client";
    if (
      clientName.length > 80 ||
      input.redirectUris.length < 1 ||
      input.redirectUris.length > 8 ||
      input.redirectUris.some((uri) => !isTrustedMcpOAuthRedirectUri(uri))
    ) {
      throw new InvalidMcpOAuthClientError();
    }
    return this.repository.createClient({
      clientId: this.tokens.issueClientId(),
      clientName,
      createdAt: this.clock().toISOString(),
      redirectUris: [...new Set(input.redirectUris)],
    });
  }

  public getClient(clientId: string): McpOAuthClient | undefined {
    return this.repository.findClient(clientId);
  }

  public deleteConnection(
    actor: AuthenticatedActor,
    clientId: string,
    actorUserId: string,
  ): void {
    if (actor.user.role !== "admin") {
      throw new McpOAuthConnectionForbiddenError();
    }
    const deleted = this.repository.deleteConnection({
      actorUserId,
      clientId,
      workspaceId: actor.workspaceId,
    });
    if (!deleted) throw new McpOAuthConnectionNotFoundError();
  }

  public listConnections(actor: AuthenticatedActor): McpOAuthConnection[] {
    return this.repository.listConnections({
      now: this.clock().toISOString(),
      workspaceId: actor.workspaceId,
    });
  }

  public beginAuthorization(
    actor: AuthenticatedActor,
    input: {
      accessMode: McpAccessMode;
      clientId: string;
      codeChallenge: string;
      redirectUri: string;
      resource?: string;
      scopes: string[];
    },
  ): { code: string } {
    const client = this.repository.findClient(input.clientId);
    if (
      !client ||
      !client.redirectUris.some((uri) =>
        redirectUriMatches(input.redirectUri, uri),
      )
    ) {
      throw new InvalidMcpOAuthClientError();
    }
    const resource = input.resource ?? this.config.resourceUrl;
    if (resource !== this.config.resourceUrl) {
      throw new InvalidMcpOAuthGrantError();
    }
    const scope = scopeValue(input.scopes, this.config.requiredScope);
    const now = this.clock();
    const code = this.tokens.issueAuthorizationCode();
    this.repository.createAuthorizationCode({
      accessMode: input.accessMode,
      clientId: client.clientId,
      codeChallenge: input.codeChallenge,
      codeHash: this.tokens.hash(code),
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + authorizationCodeLifetimeMs,
      ).toISOString(),
      redirectUri: input.redirectUri,
      resource,
      scope,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
    });
    return { code };
  }

  public challengeForAuthorizationCode(
    clientId: string,
    authorizationCode: string,
  ): string {
    const challenge = this.repository.challengeForAuthorizationCode({
      clientId,
      codeHash: this.tokens.hash(authorizationCode),
      now: this.clock().toISOString(),
    });
    if (!challenge) throw new InvalidMcpOAuthGrantError();
    return challenge;
  }

  public exchangeAuthorizationCode(input: {
    authorizationCode: string;
    clientId: string;
    redirectUri?: string;
    resource?: string;
  }): McpOAuthTokens {
    const resource = input.resource ?? this.config.resourceUrl;
    if (resource !== this.config.resourceUrl || !input.redirectUri) {
      throw new InvalidMcpOAuthGrantError();
    }
    const now = this.clock();
    const familyId = randomUUID();
    const accessToken = this.tokens.issueAccessToken();
    const refreshToken = this.tokens.issueRefreshToken();
    const grant = {
      accessMode: "read_only" as const,
      clientId: input.clientId,
      familyId,
      resource,
      scope: this.config.requiredScope,
      userId: "pending",
      workspaceId: "pending",
    };
    const consumed = this.repository.consumeAuthorizationCode({
      access: this.tokenRecord(
        grant,
        "access",
        accessToken,
        now,
        accessLifetimeMs,
      ),
      clientId: input.clientId,
      codeHash: this.tokens.hash(input.authorizationCode),
      now: now.toISOString(),
      redirectUri: input.redirectUri,
      refresh: this.tokenRecord(
        grant,
        "refresh",
        refreshToken,
        now,
        refreshLifetimeMs,
      ),
      resource,
    });
    if (!consumed) throw new InvalidMcpOAuthGrantError();
    return this.publicTokens(accessToken, refreshToken);
  }

  public exchangeRefreshToken(input: {
    clientId: string;
    refreshToken: string;
    resource?: string;
    scopes?: string[];
  }): McpOAuthTokens {
    const resource = input.resource ?? this.config.resourceUrl;
    if (resource !== this.config.resourceUrl) {
      throw new InvalidMcpOAuthGrantError();
    }
    const now = this.clock();
    const refreshTokenHash = this.tokens.hash(input.refreshToken);
    const grant = this.repository.findRefreshGrant({
      clientId: input.clientId,
      now: now.toISOString(),
      refreshTokenHash,
    });
    if (!grant) throw new InvalidMcpOAuthGrantError();
    scopeValue(input.scopes ?? [grant.scope], grant.scope);
    const accessToken = this.tokens.issueAccessToken();
    const nextRefreshToken = this.tokens.issueRefreshToken();
    const consumed = this.repository.consumeRefreshToken({
      access: this.tokenRecord(
        grant,
        "access",
        accessToken,
        now,
        accessLifetimeMs,
      ),
      clientId: input.clientId,
      now: now.toISOString(),
      refresh: this.tokenRecord(
        grant,
        "refresh",
        nextRefreshToken,
        now,
        refreshLifetimeMs,
      ),
      refreshTokenHash,
      resource,
    });
    if (!consumed) throw new InvalidMcpOAuthGrantError();
    return this.publicTokens(accessToken, nextRefreshToken);
  }

  public authorize(token: string): RemoteMcpPrincipal {
    if (!this.tokens.isAccessToken(token)) {
      throw new InvalidMcpOAuthGrantError();
    }
    const principal = this.repository.findActiveAccessToken({
      now: this.clock().toISOString(),
      tokenHash: this.tokens.hash(token),
    });
    if (!principal) throw new InvalidMcpOAuthGrantError();
    return principal;
  }

  public revokeToken(clientId: string, token: string): void {
    this.repository.revokeToken({
      clientId,
      revokedAt: this.clock().toISOString(),
      tokenHash: this.tokens.hash(token),
    });
  }

  private publicTokens(
    accessToken: string,
    refreshToken: string,
  ): McpOAuthTokens {
    return {
      accessToken,
      expiresIn: accessLifetimeMs / 1000,
      refreshToken,
      scope: this.config.requiredScope,
      tokenType: "Bearer",
    };
  }

  private tokenRecord(
    grant: McpOAuthRefreshGrant,
    tokenKind: "access" | "refresh",
    token: string,
    now: Date,
    lifetimeMs: number,
  ): McpOAuthIssuedTokenRecord {
    return {
      accessMode: grant.accessMode,
      clientId: grant.clientId,
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
      familyId: grant.familyId,
      id: randomUUID(),
      issuedAt: now.toISOString(),
      resource: grant.resource,
      scope: grant.scope,
      tokenHash: this.tokens.hash(token),
      tokenKind,
      userId: grant.userId,
      workspaceId: grant.workspaceId,
    };
  }
}
