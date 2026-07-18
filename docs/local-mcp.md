# Local MCP

Application Tracker provides a read-only Model Context Protocol server over
stdio. An MCP client starts the process on the same host as the SQLite database
and communicates through stdin and stdout. The transport opens no network port.

## Security boundary

Each process binds to one local username and one workspace slug through its
private environment. Tool inputs cannot select or replace that context. Before
every tool call, the server confirms that the user remains active and still
belongs to the workspace. Disabling the account or removing its membership
blocks the next call without restarting the MCP process.

Local stdio relies on operating-system access to the process, configuration,
and database file. It does not accept a browser password or session token. Run
the client under the same protected operator account as the website; SQLite WAL
and migration startup require access to the database and its directory. Protect
the client configuration, and never expose stdio through a network relay.

## Build and configure

Build the compiled entry point after each checkout or update:

```sh
npm ci
npm run build
```

Copy [`.mcp.json.example`](../.mcp.json.example) to `.mcp.json` and replace the
absolute paths and local username. `.mcp.json` is ignored by Git. Fresh
installations use the workspace slug `default`.

The client must launch the compiled file directly:

```text
node /absolute/path/to/application-tracker/dist/server/server/mcp_stdio.js
```

Do not wrap this command in `npm run`; npm writes banners to stdout, while MCP
reserves stdout for JSON-RPC. The server writes redacted lifecycle diagnostics
to stderr. If a client uses a configuration format other than `.mcp.json`, copy
the same command, argument, and environment values into that format.

`DATABASE_PATH` must identify the same database used by the website. Relative
paths resolve from the MCP process's working directory, so an absolute path is
safer in client configuration. The server fails closed when either actor value
is missing, the database cannot be verified, or the selected account is not an
active workspace member.

## Tools

The local server registers five read-only tools:

| Tool                     | Result                                             |
| ------------------------ | -------------------------------------------------- |
| `get_tracker_context`    | Bound actor, role, workspace, and access mode      |
| `get_job_search_summary` | Totals, status counts, and due-action counts       |
| `list_applications`      | Up to 100 summaries, optionally filtered by status |
| `get_application`        | One full record and its immutable stage events     |
| `get_reference_data`     | Statuses, sources, role types, and document types  |

Tools return JSON text and structured content. Expected failures use stable
codes such as `actor_unavailable` and `application_not_found`; unexpected
failures return `internal_error` without exception details. Every tool is
annotated as read-only, non-destructive, idempotent, and closed-world.

The local milestone does not add create, update, or delete tools. It also does
not provide remote Streamable HTTP, OAuth, a remote session registry, or MCP
security audit events. Those controls remain closed release milestones.
