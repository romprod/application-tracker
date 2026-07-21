# MCP status

Application Tracker exposes an administrator-only MCP status page at
Settings → MCP. The page reports what the current build can do while exposing
only the canonical public MCP endpoint from its network configuration.

The build includes local stdio and optional remote Streamable HTTP transports
for eight read tools and seven mutation tools. The page reports
whether runtime configuration has enabled each transport and whether the
individual connection permits mutations.

## Status API

`GET /api/settings/mcp` requires an active local administrator session and
returns `Cache-Control: no-store`. Unauthenticated requests receive `401`;
members receive `403`.

Bearer credentials accept an `accessMode` of `read_only` or `read_write` when
created. `PATCH /api/settings/mcp/clients/:clientId` changes only that active
credential and requires an administrator with a matching same-host `Origin`.
Changing it takes effect on the next request, including an existing remote
session. New credentials default to `read_only` in the browser.

Every listed bearer or built-in OAuth connection has a two-click delete action.
Revoked bearer rows also retain a two-click token-generation action; the new
one-time token appears in that row and restores the same client ID.

The response contains only:

- overall runtime availability;
- local and remote transport states;
- the canonical public remote endpoint, when configured;
- active and initializing session counts;
- configured global and per-actor session limits;
- configured idle and absolute lifetimes;
- Boolean readiness flags for client credentials, local-account OAuth, and
  audit events, plus the registered tool count;
- eligible local actors and sanitized bearer and authorized OAuth connection
  records, including each connection's access mode; and
- the 20 most recent workspace-scoped MCP audit events.

Each displayed event contains the local actor's display name and username,
tool action, target type, result, transport, and timestamp. It contains no tool
arguments, application fields, protocol payloads, or internal errors. Audit
rows are append-only and remain in the database until the installation's data
is retired under the operator's retention policy.

Except for that public endpoint, the response omits network addresses,
hostnames, identity-provider details, subjects, bearer tokens, token hashes,
database paths, and internal errors. Server tests check this disclosure
contract.

The status marks local stdio as ready when the build contains the transport and
tool registry. Each local client spawns its own process, so the website does
not discover or count those processes. Active and initializing counts cover
remote sessions only. The remote transport reports ready only when startup
installs the authenticated `/mcp` endpoint. Client credentials are always
available to administrators. OAuth reports ready whenever the configured remote
endpoint has installed the built-in local-account authorization server.

Local client setup, actor binding, revocation behavior, and tool contracts are
documented in [`local-mcp.md`](local-mcp.md).

## Remote session policy

The environment controls the remote MCP session policy:

| Variable                       | Default | Meaning                          |
| ------------------------------ | ------: | -------------------------------- |
| `MCP_SESSION_GLOBAL_LIMIT`     |     256 | Installation-wide remote limit   |
| `MCP_SESSION_PER_ACTOR_LIMIT`  |      64 | Remote limit for one actor       |
| `MCP_SESSION_IDLE_SECONDS`     |     300 | Remote idle expiry, 5 minutes    |
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
remote network settings pass validation.

## Built-in local-account OAuth

A valid remote MCP network configuration installs OAuth discovery, dynamic
client registration, authorization, token, and revocation routes automatically.
Claude.ai and remote Codex register themselves, then redirect the user to an
Application Tracker login and consent page. The flow uses existing local users
and passwords and requires no external identity provider or extra environment
variables.

Settings → MCP displays the canonical remote readiness and lists both issued
bearer credentials and OAuth connections that completed authorization in the
current workspace. A dynamic registration that never reaches consent is not
shown because it has no workspace or local-account binding. OAuth consent asks
the signed-in user to choose read-only or read-and-write access for that
authorization only.

## Optional external OAuth verifier

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

External OAuth tokens are added to the same bearer boundary. Built-in OAuth and
native client credentials require none of these six settings. See
[`remote-mcp.md`](remote-mcp.md) for client, network, and request controls.

When the external verifier is configured, administrators can link an exact
provider subject to an existing local user from **Settings → Users**. The server
fixes the issuer to `MCP_OAUTH_ISSUER`; the browser never receives or selects it.

## Per-connection write policy

The seven mutation tools are always discoverable so connected clients retain a
stable tool registry. In `read_only` mode they fail with
`write_access_disabled` before changing application data. In `read_write` mode
active workspace members may create and update applications. Soft deletion also
requires `confirm=true` and is advertised as destructive to the MCP client.

The setting belongs to a bearer credential, OAuth grant, or local stdio process;
there is no workspace-wide switch. Existing sessions recheck the credential on
each request. Local stdio uses `MCP_LOCAL_ACCESS_MODE`, which defaults to
`read_only`. Tool arguments can never select an actor, workspace, or permission.
