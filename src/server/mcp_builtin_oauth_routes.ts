import { Router, urlencoded, type Request, type Response } from "express";
import {
  AccessDeniedError,
  InvalidClientMetadataError,
  InvalidGrantError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import {
  InvalidCredentialsError,
  LoginAttemptRateLimitError,
  LoginVerificationCapacityError,
  type AuthenticatedActor,
  type AuthService,
} from "../application/auth.js";
import {
  hostedMcpOAuthCallbackOrigins,
  InvalidMcpOAuthClientError,
  InvalidMcpOAuthGrantError,
  isTrustedMcpOAuthRedirectUri,
  type McpBuiltInOAuthService,
  type McpOAuthClient,
} from "../application/mcp_builtin_oauth.js";
import {
  createSessionCookie,
  requestClientAddress,
  requestSessionToken,
  type AuthCookieOptions,
} from "./auth_routes.js";

export interface McpBuiltInOAuthRouterOptions {
  authService: AuthService;
  cookieOptions: AuthCookieOptions;
  oauth: McpBuiltInOAuthService;
  requiredScope: string;
  resourceUrl: string;
}

function requestedRedirectOrigin(request: Request): string | undefined {
  const body: unknown = request.body;
  const bodyRedirect =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).redirect_uri
      : undefined;
  const candidate =
    request.method === "POST" ? bodyRedirect : request.query.redirect_uri;
  if (
    typeof candidate !== "string" ||
    !isTrustedMcpOAuthRedirectUri(candidate)
  ) {
    return undefined;
  }
  return new URL(candidate).origin;
}

function clientInformation(client: McpOAuthClient): OAuthClientInformationFull {
  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(
      new Date(client.createdAt).getTime() / 1000,
    ),
    client_name: client.clientName,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: client.redirectUris,
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hidden(name: string, value: string | undefined): string {
  return value === undefined
    ? ""
    : `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unexpected OAuth failure");
}

function authorizationFields(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): string {
  return [
    hidden("client_id", client.client_id),
    hidden("redirect_uri", params.redirectUri),
    hidden("response_type", "code"),
    hidden("code_challenge", params.codeChallenge),
    hidden("code_challenge_method", "S256"),
    hidden("scope", params.scopes?.join(" ")),
    hidden("state", params.state),
    hidden("resource", params.resource?.href),
  ].join("");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} · Application Tracker</title>
    <style>
      :root { color-scheme: light; font-family: Arial, sans-serif; background: #f7f3e9; color: #153c34; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
      main { width: min(92vw, 520px); padding: 36px; background: #fffdf7; border: 1px solid #b8b4a8; border-top: 4px solid #153c34; box-sizing: border-box; }
      h1 { margin: 0 0 12px; font-family: Georgia, serif; font-size: 32px; font-weight: 500; }
      p { color: #5d665f; line-height: 1.6; }
      label { display: grid; gap: 7px; margin-top: 16px; color: #5d665f; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
      input, select { min-height: 46px; padding: 0 12px; border: 1px solid #b8b4a8; background: #fff; font: inherit; }
      .actions { display: flex; gap: 10px; margin-top: 24px; }
      button { min-height: 44px; padding: 0 18px; border: 1px solid #153c34; background: #153c34; color: #fff; font-weight: 700; cursor: pointer; }
      button.secondary { background: transparent; color: #8a3f2c; border-color: #cfb5aa; }
      .identity { padding: 12px; background: #e4eadf; color: #153c34; }
      .error { color: #8a3f2c; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`;
}

function loginPage(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  error?: string,
): string {
  const name = client.client_name ?? "MCP client";
  return page(
    "Sign in",
    `<p>Application Tracker OAuth</p>
     <h1>Sign in to Application Tracker</h1>
     <p><strong>${escapeHtml(name)}</strong> is requesting access to your Application Tracker workspace.</p>
     ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
     <form method="post" action="/authorize">
       ${authorizationFields(client, params)}
       ${hidden("oauth_action", "login")}
       <label>Username<input name="username" autocomplete="username" required maxlength="64"></label>
       <label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
       <div class="actions"><button type="submit">Continue</button></div>
     </form>`,
  );
}

function consentPage(
  actor: AuthenticatedActor,
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): string {
  const name = client.client_name ?? "MCP client";
  return page(
    `Authorize ${name}`,
    `<p>Application Tracker OAuth</p>
     <h1>Authorize ${escapeHtml(name)}</h1>
     <p class="identity">Signed in as <strong>${escapeHtml(actor.user.displayName)}</strong> · @${escapeHtml(actor.user.username)}</p>
     <p>This grants access to the MCP tools for your current workspace. Choose the permission for this connection only.</p>
     <form method="post" action="/authorize">
       ${authorizationFields(client, params)}
       <label>Connection permission
         <select name="access_mode">
           <option value="read_only">Read only</option>
           <option value="read_write">Read and write</option>
         </select>
       </label>
       <div class="actions">
         <button name="oauth_action" value="approve" type="submit">Authorize</button>
         <button class="secondary" name="oauth_action" value="deny" type="submit">Deny</button>
       </div>
     </form>`,
  );
}

class ApplicationTrackerOAuthProvider implements OAuthServerProvider {
  public readonly clientsStore: OAuthRegisteredClientsStore;

  public constructor(private readonly options: McpBuiltInOAuthRouterOptions) {
    this.clientsStore = {
      getClient: (clientId) => {
        const client = this.options.oauth.getClient(clientId);
        return client ? clientInformation(client) : undefined;
      },
      registerClient: (metadata) => {
        if (metadata.token_endpoint_auth_method !== "none") {
          throw new InvalidClientMetadataError(
            "Application Tracker accepts public PKCE clients only",
          );
        }
        try {
          return clientInformation(
            this.options.oauth.registerClient({
              ...(metadata.client_name
                ? { clientName: metadata.client_name }
                : {}),
              redirectUris: metadata.redirect_uris,
            }),
          );
        } catch (error) {
          if (error instanceof InvalidMcpOAuthClientError) {
            throw new InvalidClientMetadataError(
              "The OAuth redirect URI is not supported",
            );
          }
          throw error;
        }
      },
    };
  }

  public async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    response: Response,
  ): Promise<void> {
    const body = response.req.body as Record<string, unknown> | undefined;
    const action =
      typeof body?.oauth_action === "string" ? body.oauth_action : "";
    if (action === "deny") throw new AccessDeniedError("Access was denied");

    let actor = this.options.authService.getActor(
      requestSessionToken(response.req),
    );
    if (action === "login") {
      const username = typeof body?.username === "string" ? body.username : "";
      const password = typeof body?.password === "string" ? body.password : "";
      try {
        const login = await this.options.authService.login(
          { password, username },
          requestSessionToken(response.req),
          requestClientAddress(response.req),
        );
        response.setHeader(
          "Set-Cookie",
          createSessionCookie(login.token, this.options.cookieOptions),
        );
        actor = this.options.authService.getActor(login.token);
      } catch (error) {
        const message =
          error instanceof InvalidCredentialsError
            ? "The username or password was not accepted."
            : error instanceof LoginAttemptRateLimitError ||
                error instanceof LoginVerificationCapacityError
              ? "Sign-in is temporarily limited. Please try again shortly."
              : undefined;
        if (message) {
          response.status(200).send(loginPage(client, params, message));
          return;
        }
        throw error;
      }
    }

    if (!actor) {
      response.status(200).send(loginPage(client, params));
      return;
    }
    if (action !== "approve") {
      response.status(200).send(consentPage(actor, client, params));
      return;
    }

    try {
      const authorization = this.options.oauth.beginAuthorization(actor, {
        accessMode:
          body?.access_mode === "read_write" ? "read_write" : "read_only",
        clientId: client.client_id,
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        ...(params.resource ? { resource: params.resource.href } : {}),
        scopes: params.scopes ?? [],
      });
      const redirect = new URL(params.redirectUri);
      redirect.searchParams.set("code", authorization.code);
      if (params.state) redirect.searchParams.set("state", params.state);
      response.redirect(302, redirect.href);
    } catch (error) {
      if (
        error instanceof InvalidMcpOAuthClientError ||
        error instanceof InvalidMcpOAuthGrantError
      ) {
        throw new InvalidGrantError("The authorization request is invalid");
      }
      throw error;
    }
  }

  public challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    try {
      return Promise.resolve(
        this.options.oauth.challengeForAuthorizationCode(
          client.client_id,
          authorizationCode,
        ),
      );
    } catch (error) {
      if (error instanceof InvalidMcpOAuthGrantError) {
        return Promise.reject(
          new InvalidGrantError("Invalid authorization code"),
        );
      }
      return Promise.reject(errorValue(error));
    }
  }

  public exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    try {
      const tokens = this.options.oauth.exchangeAuthorizationCode({
        authorizationCode,
        clientId: client.client_id,
        ...(redirectUri ? { redirectUri } : {}),
        ...(resource ? { resource: resource.href } : {}),
      });
      return Promise.resolve({
        access_token: tokens.accessToken,
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
        token_type: tokens.tokenType,
      });
    } catch (error) {
      if (error instanceof InvalidMcpOAuthGrantError) {
        return Promise.reject(
          new InvalidGrantError("Invalid authorization code"),
        );
      }
      return Promise.reject(errorValue(error));
    }
  }

  public exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    try {
      const tokens = this.options.oauth.exchangeRefreshToken({
        clientId: client.client_id,
        refreshToken,
        ...(resource ? { resource: resource.href } : {}),
        ...(scopes ? { scopes } : {}),
      });
      return Promise.resolve({
        access_token: tokens.accessToken,
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
        token_type: tokens.tokenType,
      });
    } catch (error) {
      if (error instanceof InvalidMcpOAuthGrantError) {
        return Promise.reject(new InvalidGrantError("Invalid refresh token"));
      }
      return Promise.reject(errorValue(error));
    }
  }

  public verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const principal = this.options.oauth.authorize(token);
      return Promise.resolve({
        clientId: principal.principalId,
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        extra: {
          actor: principal.actor,
          workspaceSlug: principal.workspaceSlug,
        },
        resource: new URL(this.options.resourceUrl),
        scopes: [this.options.requiredScope],
        token,
      });
    } catch (error) {
      if (error instanceof InvalidMcpOAuthGrantError) {
        return Promise.reject(new InvalidGrantError("Invalid access token"));
      }
      return Promise.reject(errorValue(error));
    }
  }

  public revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.options.oauth.revokeToken(client.client_id, request.token);
    return Promise.resolve();
  }
}

export function createMcpBuiltInOAuthRouter(
  options: McpBuiltInOAuthRouterOptions,
) {
  const resource = new URL(options.resourceUrl);
  const issuer = new URL("/", resource);
  const router = Router();
  router.use(
    "/authorize",
    urlencoded({ extended: false, limit: "16kb", parameterLimit: 32 }),
  );
  router.use("/authorize", (request, response, next) => {
    const policy = response.get("Content-Security-Policy");
    if (policy) {
      const redirectOrigin = requestedRedirectOrigin(request);
      const allowedOrigins = new Set([
        ...hostedMcpOAuthCallbackOrigins,
        ...(redirectOrigin ? [redirectOrigin] : []),
      ]);
      response.set(
        "Content-Security-Policy",
        policy.replace(
          "form-action 'self'",
          `form-action 'self' ${[...allowedOrigins].join(" ")}`,
        ),
      );
    }
    next();
  });
  router.use(
    "/.well-known/oauth-authorization-server",
    createPublicClientAuthorizationMetadataRouter({
      issuer,
      requiredScope: options.requiredScope,
    }),
  );
  router.use(
    mcpAuthRouter({
      authorizationOptions: {
        rateLimit: { limit: 30, windowMs: 15 * 60 * 1000 },
      },
      clientRegistrationOptions: {
        clientSecretExpirySeconds: 0,
        rateLimit: { limit: 20, windowMs: 60 * 60 * 1000 },
      },
      issuerUrl: issuer,
      provider: new ApplicationTrackerOAuthProvider(options),
      resourceName: "Application Tracker MCP",
      resourceServerUrl: resource,
      scopesSupported: [options.requiredScope],
      tokenOptions: {
        rateLimit: { limit: 50, windowMs: 15 * 60 * 1000 },
      },
    }),
  );
  return router;
}

function createPublicClientAuthorizationMetadataRouter(input: {
  issuer: URL;
  requiredScope: string;
}) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set({
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60, must-revalidate",
    });
    next();
  });
  router.get("/", (_request, response) => {
    response.json({
      authorization_endpoint: new URL("/authorize", input.issuer).href,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      issuer: input.issuer.href,
      registration_endpoint: new URL("/register", input.issuer).href,
      response_types_supported: ["code"],
      revocation_endpoint: new URL("/revoke", input.issuer).href,
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [input.requiredScope],
      token_endpoint: new URL("/token", input.issuer).href,
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
  router.options("/", (_request, response) => {
    response.sendStatus(204);
  });
  return router;
}
