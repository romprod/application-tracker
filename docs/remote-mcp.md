# Remote MCP

Remote Model Context Protocol access uses one authenticated Streamable HTTP
endpoint at `/mcp`. A fresh installation exposes no remote MCP route.

## Network configuration

Set every OAuth verifier value described in [`mcp-status.md`](mcp-status.md),
then set:

| Variable                     | Meaning                                     |
| ---------------------------- | ------------------------------------------- |
| `MCP_REMOTE_ENABLED`         | Explicit `true` switch                      |
| `MCP_REMOTE_URL`             | Canonical public HTTPS URL ending in `/mcp` |
| `MCP_REMOTE_ALLOWED_HOSTS`   | Comma-separated accepted HTTP `Host` values |
| `MCP_REMOTE_ALLOWED_ORIGINS` | Comma-separated accepted HTTPS origins      |

The OAuth audience must equal `MCP_REMOTE_URL`, and the host allowlist must
include that URL's host. Host values contain only a hostname and optional port.
Origin values contain only an HTTPS scheme and authority.

Startup rejects partial settings, duplicate entries, embedded credentials,
query strings, fragments, insecure origins, and remote URLs on another path.
When every network and OAuth setting is valid, the server installs the endpoint
and the administrator MCP status view reports the remote transport as ready.

Remote authorization also requires an identity link from the token issuer and
subject to an active local workspace user. Until an administrator creates that
link, the remote endpoint rejects the actor.

## Link a remote identity

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

## Authorization discovery

When remote configuration is complete, the server publishes RFC 9728 protected
resource metadata at:

```text
/.well-known/oauth-protected-resource/mcp
```

The document identifies the canonical MCP resource, authorization server,
required scope, and header-based bearer method. It is public, cacheable for five
minutes, and contains no JWKS URL, subject, token, hostname beyond the public
resource, or private deployment setting. The endpoint accepts `GET` and
`OPTIONS` only.

## Bearer authorization boundary

The remote adapter accepts one `Authorization: Bearer <token>` header. Missing
credentials receive `401 authentication_required`; malformed or rejected
tokens receive `401 invalid_token`; a missing required scope receives
`403 insufficient_scope`; and an identity without an active local workspace
membership receives `403 actor_unavailable`.

OAuth challenges include the protected-resource metadata URL and exact required
scope. They omit error descriptions, identity details, and verifier failures.
The server passes only the resolved local actor to downstream handlers and does
not retain or echo the bearer token.

## Session and tool behavior

Clients initialize a stateful MCP session and send its opaque `MCP-Session-Id`
on subsequent `GET`, `POST`, and `DELETE` requests. Each session is bound to the
resolved user and workspace; another authenticated actor receives the same
not-found response as an unknown session. Session admission, idle expiry,
absolute expiry, and shutdown cleanup use the limits shown in the administrator
MCP status view.

The remote endpoint exposes the same five read-only tools as the local stdio
server. Every tool call records the actor, workspace, result, target type, and
`remote_http` transport. The endpoint never accepts an application mutation.

## Request controls

The endpoint checks Host and Origin, applies the global concurrency cap, and
then authenticates the bearer token. It applies the per-actor rate limit and
JSON size cap before protocol handling:

| Variable                               | Default | Range           | Meaning                            |
| -------------------------------------- | ------: | --------------- | ---------------------------------- |
| `MCP_REMOTE_MAX_REQUEST_BYTES`         |   65536 | 1,024–1,048,576 | Maximum JSON request body          |
| `MCP_REMOTE_MAX_CONCURRENT_REQUESTS`   |       8 | 1–1,000         | Installation-wide in-flight limit  |
| `MCP_REMOTE_RATE_LIMIT_REQUESTS`       |      60 | 1–10,000        | Requests allowed per actor window  |
| `MCP_REMOTE_RATE_LIMIT_WINDOW_SECONDS` |      60 | 1–3,600         | Fixed rate-limit window in seconds |

The rate limit uses the resolved local actor ID, never an unverified subject,
token string, or client-supplied workspace. Limited requests return `429` with
`Retry-After`; oversized JSON returns `413`. Startup rejects values outside the
documented safe ranges.

Every `POST` must use `Content-Type: application/json` (parameters such as a
charset are allowed). Lookalike media types are rejected with `415` before body
parsing, and every accepted body passes through the configured size-limited
parser. The product accepts one JSON-RPC message per HTTP request; arrays are
rejected with `400` before session transport, tool execution, or audit writes.
