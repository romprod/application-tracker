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
These checks prepare the network boundary; they do not enable an HTTP route on
their own.
