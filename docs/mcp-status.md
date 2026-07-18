# MCP status

Application Tracker exposes an administrator-only MCP status page at
Settings → MCP. The page reports what the current build can do without exposing
deployment or identity-provider details.

The build includes a local stdio transport and five read-only tools. Remote
Streamable HTTP remains disabled. The page reports both facts directly.

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
tool registry. Each MCP client spawns its own process, so the website does not
discover or count those processes. Active and initializing counts cover only
the closed remote registry. They stay at zero until a future authenticated
remote adapter admits sessions.

Local client setup, actor binding, revocation behavior, and tool contracts are
documented in [`local-mcp.md`](local-mcp.md).

## Remote session policy

The environment controls the closed remote MCP session policy:

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
workspace-scoped counts. Registry readiness does not enable a network route or
weaken the OAuth requirement.

## Remaining MCP milestones

Remote HTTPS, OAuth verification, and mutating tools remain separate stages.
Until those controls land, the remote transport stays disabled and local tools
stay read-only.
