# MCP status

Application Tracker exposes an administrator-only MCP status page at
Settings → MCP. The page reports what the current build can do without exposing
deployment or identity details.

The MCP runtime is not implemented yet. Local stdio is unavailable, remote
Streamable HTTP is disabled, no tools are registered, and no MCP sessions can
exist. The page states this directly.

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

## Session policy

The environment controls the future MCP session policy:

| Variable                       | Default | Meaning                   |
| ------------------------------ | ------: | ------------------------- |
| `MCP_SESSION_GLOBAL_LIMIT`     |       6 | Installation-wide limit   |
| `MCP_SESSION_PER_ACTOR_LIMIT`  |       2 | Limit for one actor       |
| `MCP_SESSION_IDLE_SECONDS`     |     900 | Idle expiry, 15 minutes   |
| `MCP_SESSION_ABSOLUTE_SECONDS` |   14400 | Maximum lifetime, 4 hours |

Startup rejects a per-actor limit above the global limit and an absolute
lifetime at or below the idle lifetime.

These values are configuration, not enforcement. The status reports
`enforcement: inactive` until the MCP session registry implements race-safe
admission, expiry, explicit close, and shutdown cleanup. The capability
checklist keeps that implementation milestone unchecked.

## Next MCP milestone

The next stage adds a local stdio server with explicit operator-selected actor
and workspace context. Remote HTTPS, OAuth verification, session enforcement,
audit events, and tools remain separate later stages so each boundary can be
tested before it opens.
