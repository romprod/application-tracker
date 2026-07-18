# MCP status

Application Tracker exposes an administrator-only MCP status page at
Settings → MCP. The page reports what the current build can do without exposing
deployment or identity details.

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
- configured idle and absolute lifetimes; and
- Boolean readiness flags for OAuth verification and audit events, plus the
  registered tool count.

The response omits network addresses, hostnames, identity-provider details,
subjects, tokens, credentials, database paths, and internal errors. Server tests
check this disclosure contract.

The status marks local stdio as ready when the build contains the transport and
tool registry. Each MCP client spawns its own process, so the website does not
discover or count those processes. Active and initializing counts remain for
the future remote session registry and stay at zero.

Local client setup, actor binding, revocation behavior, and tool contracts are
documented in [`local-mcp.md`](local-mcp.md).

## Remote session policy

The environment controls the future MCP session policy:

| Variable                       | Default | Meaning                          |
| ------------------------------ | ------: | -------------------------------- |
| `MCP_SESSION_GLOBAL_LIMIT`     |       6 | Installation-wide remote limit   |
| `MCP_SESSION_PER_ACTOR_LIMIT`  |       2 | Remote limit for one actor       |
| `MCP_SESSION_IDLE_SECONDS`     |     900 | Remote idle expiry, 15 minutes   |
| `MCP_SESSION_ABSOLUTE_SECONDS` |   14400 | Remote maximum lifetime, 4 hours |

Startup rejects a per-actor limit above the global limit and an absolute
lifetime at or below the idle lifetime.

These values do not govern local child processes. The status reports
`enforcement: inactive` until the remote registry implements race-safe
admission, expiry, explicit close, and shutdown cleanup.

## Remaining MCP milestones

Remote HTTPS, OAuth verification, session enforcement, security audit events,
and mutating tools remain separate stages. Until those controls land, the
remote transport stays disabled and local tools stay read-only.
