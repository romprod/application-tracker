# Remote MCP

Remote Model Context Protocol access uses one authenticated Streamable HTTP
endpoint at `/mcp`. A fresh installation exposes no remote MCP route.

## Network configuration

Set these network values:

| Variable                     | Meaning                                     |
| ---------------------------- | ------------------------------------------- |
| `MCP_REMOTE_ENABLED`         | Explicit `true` switch                      |
| `MCP_REMOTE_URL`             | Canonical public HTTPS URL ending in `/mcp` |
| `MCP_REMOTE_ALLOWED_HOSTS`   | Comma-separated accepted HTTP `Host` values |
| `MCP_REMOTE_ALLOWED_ORIGINS` | Comma-separated accepted HTTPS origins      |

The host allowlist must include the URL's host. Host values contain only a
hostname and optional port. Origin values contain only an HTTPS scheme and
authority.

Startup rejects partial settings, duplicate entries, embedded credentials,
query strings, fragments, insecure origins, and remote URLs on another path.
When every network setting is valid, the server installs the endpoint and the
administrator MCP status view reports the remote transport as ready.

### Reverse proxy

Terminate TLS at a trusted reverse proxy and send `/mcp` to the same backend as
the website. Preserve the public `Host` header so the server can enforce
`MCP_REMOTE_ALLOWED_HOSTS`. Set `HTTP_TRUST_PROXY_HOPS` to the exact number of
trusted proxies in the fixed path so source admission resolves the real client
address. Do not log `Authorization` headers.

Streamable HTTP may keep responses open. Disable response buffering for `/mcp`
and choose proxy read and idle timeouts that exceed the configured MCP session
idle period. The proxy must pass `GET`, `POST`, and `DELETE` and must not rewrite
or cache MCP responses. Restrict request bodies at or below the application's
configured maximum.

## Choose a connection method

Application Tracker supports four client paths:

| Client         | Transport    | Authentication                        |
| -------------- | ------------ | ------------------------------------- |
| Claude.ai      | Remote HTTPS | Built-in OAuth with local credentials |
| Remote Codex   | Remote HTTPS | Built-in OAuth with local credentials |
| Local Codex    | Local stdio  | Explicit local actor and workspace    |
| Claude Desktop | Local stdio  | Explicit local actor and workspace    |

For Claude.ai, add the MCP endpoint as a custom connector and select
**Connect**. Both remote clients register a public PKCE client automatically
and redirect the user to Application Tracker. Sign in with an existing local
username and password, choose read-only or read-and-write access for that
connection, and select **Authorize**. Users do not need Authentik, another
identity provider, a manually created OAuth client ID, or a client secret.

Local Codex and Claude Desktop run the compiled stdio adapter on the same
machine as the SQLite database. Replace the absolute installation and database
paths in the command or JSON before using it. Local stdio does not use
the public endpoint or the browser OAuth flow.

## Built-in OAuth

Enabling the remote endpoint also enables Application Tracker's authorization
server. It publishes protected-resource and authorization-server metadata,
supports dynamic client registration, requires authorization code flow with
S256 PKCE, issues rotating refresh tokens, and binds every grant to the exact
`MCP_REMOTE_URL` resource.

The public endpoints are:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/register
/authorize
/token
/revoke
```

The authorization page uses the same local username, password verifier,
login-rate controls, account status, and workspace membership as the website.
It requires explicit consent before redirecting to the client. Authorization
codes expire after five minutes, access tokens after 15 minutes, and rotating
refresh tokens after 30 days. Only token hashes are stored. Revocation removes
the whole token family from use.

Dynamic registration accepts only public clients whose redirect is either the
exact Claude.ai MCP callback or a local loopback HTTP callback used by native
clients. It does not issue client secrets.

## Create a direct bearer credential

Sign in as a local administrator and open **Settings → MCP**:

1. Enter a descriptive client name.
2. Select the active local user that the client will act as.
3. Select **Create client**.
4. Copy the MCP endpoint, client ID, and bearer token. The app shows the bearer
   token once; the other two values remain available.

Configure the MCP client with the public `MCP_REMOTE_URL` and an
`Authorization: Bearer <token>` header. The page retains the public client ID,
name, actor, state, and last-used time. The database stores the token's SHA-256
hash, never the bearer token.

Use **Rotate token** to replace a token while keeping its client ID. Use
**Revoke** to disable the credential. Both actions take effect on the next HTTP
request. A disabled local user also blocks every client bound to that user. A
revoked credential retains its row and can issue a new token, which restores
that same client ID. Every bearer or built-in OAuth connection can be deleted
directly with a two-click confirmation. Deletion immediately invalidates its
tokens, removes the workspace-bound connection record, and cannot be undone.

Direct bearer credentials are intended only for clients that let the operator
set an Authorization header. They are separate from the automatic OAuth
registration used by Claude.ai and remote Codex.

## Optional external OAuth verifier

The built-in local-account OAuth server is the default remote interactive login
path and needs no `MCP_OAUTH_*` settings. Installations that already operate an
external OAuth issuer may optionally configure all six verifier values
described in [`mcp-status.md`](mcp-status.md). External signed tokens are then
accepted beside built-in OAuth and native bearer credentials.

### Link a remote identity

After configuring the OAuth verifier, sign in with a local administrator
account and open **Settings → Users**:

1. Find the local user who should receive remote MCP access.
2. Select **Link identity**.
3. Enter the exact `sub` claim issued to that user, then select **Link
   subject**.

Obtain the subject from the identity provider's trusted administration or
token-inspection interface. Copy it exactly; subjects are case-sensitive and
the app does not trim or normalize them. Never paste an access token into the
subject field.

The server binds the subject to `MCP_OAUTH_ISSUER`, so the browser cannot select
another issuer. One issuer-subject pair can map to only one local user. Removing
the link from **Settings → Users** prevents that subject from opening new remote
MCP requests. Disabling the local user also blocks resolution.

This identity-linking flow applies only to the optional external verifier.
Built-in OAuth uses the authenticated local account directly and does not
require a subject link.

## Bearer authorization boundary

The remote adapter accepts one `Authorization: Bearer <token>` header. Missing
credentials receive `401 authentication_required`; malformed or rejected
tokens receive `401 invalid_token`; a missing required scope receives
`403 insufficient_scope`; and an identity without an active local workspace
membership receives `403 actor_unavailable`.

Challenges include the protected-resource metadata URL and exact built-in
scope. They omit error descriptions, identity details, and verifier failures.
The server passes only the resolved local principal to downstream handlers and
never retains or echoes the bearer token.

## Session and tool behavior

Clients initialize a stateful MCP session and send its opaque `MCP-Session-Id`
on subsequent `GET`, `POST`, and `DELETE` requests. Each session is bound to the
exact credential, resolved user, and workspace. Another credential receives the
same not-found response as an unknown session, even if it belongs to the same
user. Session admission, idle expiry, absolute expiry, and shutdown cleanup use
the limits shown in the administrator MCP status view.

The remote endpoint exposes the same nine read tools and eight mutation tools
as local stdio. Permission is selected for each OAuth authorization or bearer
credential and is checked on every call, including existing sessions. OAuth
tokens must also present the required `application-tracker:tools` scope. Every
tool call records the actor, workspace, result, target type, and `remote_http`
transport. Successful mutations and their audit rows commit atomically.

## Request controls

The endpoint checks Host and Origin, authenticates the bearer token, and then
applies global and per-actor concurrency caps. It applies a per-connection rate
limit and JSON size cap before protocol handling:

| Variable                                       | Default | Range           | Meaning                            |
| ---------------------------------------------- | ------: | --------------- | ---------------------------------- |
| `MCP_REMOTE_MAX_REQUEST_BYTES`                 |   65536 | 1,024–1,048,576 | Maximum JSON request body          |
| `MCP_REMOTE_MAX_CONCURRENT_REQUESTS`           |       8 | 2–1,000         | Installation-wide in-flight limit  |
| `MCP_REMOTE_MAX_CONCURRENT_REQUESTS_PER_ACTOR` |       4 | 1–999           | In-flight limit for one actor      |
| `MCP_REMOTE_RATE_LIMIT_REQUESTS`               |     600 | 1–10,000        | Requests per connection window     |
| `MCP_REMOTE_RATE_LIMIT_WINDOW_SECONDS`         |      60 | 1–3,600         | Fixed rate-limit window in seconds |

The rate limit uses the resolved authorized connection ID, never an unverified
subject, raw token, or client-supplied workspace. It counts all MCP HTTP and
protocol traffic, not only tool calls. Separate connections for one local user
therefore have separate budgets. Limited requests return `429` with
`Retry-After`; oversized JSON returns `413`. Startup rejects values outside the
documented safe ranges. The per-actor concurrency limit remains below the
global limit, so one actor cannot occupy every request slot.

Every `POST` must use `Content-Type: application/json` (parameters such as a
charset are allowed). Lookalike media types are rejected with `415` before body
parsing, and every accepted body passes through the configured size-limited
parser. The product accepts one JSON-RPC message per HTTP request; arrays are
rejected with `400` before session transport, tool execution, or audit writes.
