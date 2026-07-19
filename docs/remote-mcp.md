# Remote MCP

Remote Model Context Protocol access uses one authenticated Streamable HTTP
endpoint. A fresh installation exposes no remote MCP route.

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
These checks prepare the network boundary; they do not enable the MCP endpoint
on their own.

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
