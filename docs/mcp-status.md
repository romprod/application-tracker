# MCP status

Application Tracker exposes an administrator-only MCP status page at
Settings → MCP. The page reports what the current build can do without exposing
deployment or identity-provider details.

The build includes local stdio and optional remote Streamable HTTP transports
for five read-only tools. The page reports whether runtime configuration has
enabled each transport.

## Status API

`GET /api/settings/mcp` requires an active local administrator session and
returns `Cache-Control: no-store`. Unauthenticated requests receive `401`;
members receive `403`.

The response contains only:

- overall runtime availability;
- local and remote transport states;
- active and initializing session counts;
- configured global and per-actor session limits;
- configured idle and absolute lifetimes;
- Boolean readiness flags for OAuth verification and audit events, plus the
  registered tool count; and
- the 20 most recent workspace-scoped MCP audit events.

Each displayed event contains the local actor's display name and username,
tool action, target type, result, transport, and timestamp. It contains no tool
arguments, application fields, protocol payloads, or internal errors. Audit
rows are append-only and remain in the database until the installation's data
is retired under the operator's retention policy.

The response omits network addresses, hostnames, identity-provider details,
subjects, tokens, credentials, database paths, and internal errors. Server tests
check this disclosure contract.

The status marks local stdio as ready when the build contains the transport and
tool registry. Each local client spawns its own process, so the website does
not discover or count those processes. Active and initializing counts cover
remote sessions only. The remote transport reports ready only when startup
installs the authenticated `/mcp` endpoint. OAuth verification reports ready
only when all verifier settings pass startup validation and the server
constructs the authorization service.

Local client setup, actor binding, revocation behavior, and tool contracts are
documented in [`local-mcp.md`](local-mcp.md).

## Remote session policy

The environment controls the remote MCP session policy:

| Variable                       | Default | Meaning                          |
| ------------------------------ | ------: | -------------------------------- |
| `MCP_SESSION_GLOBAL_LIMIT`     |       6 | Installation-wide remote limit   |
| `MCP_SESSION_PER_ACTOR_LIMIT`  |       2 | Remote limit for one actor       |
| `MCP_SESSION_IDLE_SECONDS`     |     900 | Remote idle expiry, 15 minutes   |
| `MCP_SESSION_ABSOLUTE_SECONDS` |   14400 | Remote maximum lifetime, 4 hours |

Startup rejects a per-actor limit above the global limit and an absolute
lifetime at or below the idle lifetime.

These values do not govern local child processes. The registry reports
`enforcement: active` because it now provides:

- atomic admission that counts initializing reservations;
- installation-wide and per-actor limits;
- idle expiry capped by an absolute lifetime;
- idempotent explicit close;
- periodic cleanup that releases capacity before closing resources; and
- shutdown cleanup for active and initializing sessions.

The registry stores opaque session IDs, local actor IDs, workspace IDs,
timestamps, state, and an in-process close handle. The status API exposes only
workspace-scoped counts. Startup installs the network route only after all
remote network and OAuth settings pass validation.

## OAuth verifier prerequisite

The optional verifier uses six environment variables. Configure all six or
leave all six blank:

| Variable                   | Meaning                                       |
| -------------------------- | --------------------------------------------- |
| `MCP_OAUTH_ALGORITHM`      | One allowed signing algorithm: RS256 or ES256 |
| `MCP_OAUTH_AUDIENCE`       | Exact audience assigned to this MCP resource  |
| `MCP_OAUTH_ISSUER`         | Exact HTTPS token issuer                      |
| `MCP_OAUTH_JWKS_URL`       | HTTPS signing-key set on the issuer's origin  |
| `MCP_OAUTH_REQUIRED_SCOPE` | Exact scope required for MCP access           |
| `MCP_OAUTH_WORKSPACE_SLUG` | Fixed local workspace for remote MCP          |

Startup rejects partial configuration, unsupported algorithms, insecure URLs,
embedded URL credentials, fragments, query strings, and a JWKS URL on another
origin. The verifier checks the signature, configured algorithm, issuer,
audience, expiry, subject, and OAuth scope syntax. Authorization then requires
the exact configured scope and maps the issuer-subject pair to an active local
user with a membership in the fixed workspace. Tokens and tool inputs cannot
select a workspace.

Complete remote configuration publishes protected-resource metadata, installs
the bearer boundary, and enables Streamable HTTP. See
[`remote-mcp.md`](remote-mcp.md) for the network and request controls.

## Remaining MCP milestones

The remaining MCP milestones are an administrator workflow for external
identity linking and separately approved mutating tools. Until then, remote
access requires a pre-provisioned external identity mapping and all tools stay
read-only.
