# Local MCP

Application Tracker provides a Model Context Protocol server over stdio. An MCP
client starts the process on the same host as the SQLite database
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

Copy the [MCP configuration example](../examples/mcp.json) to `.mcp.json` and
replace the absolute paths and local username. `.mcp.json` is ignored by Git.
Fresh installations use the workspace slug `default`.

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

## Access mode

Each local process has its own permission through `MCP_LOCAL_ACCESS_MODE`.
Omit it or use `read_only` to block mutations. Use `read_write` only in the
specific protected client configuration that needs mutation tools. Changing
the value requires restarting that local MCP process.

## Tools

The local server registers 20 tools:

| Tool                               | Result                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| `get_tracker_context`              | Bound actor, workspace, role, and access mode              |
| `get_connector_schema_status`      | Live and last-published MCP schema versions and hashes     |
| `get_job_search_summary`           | Status totals and due-action counts                        |
| `list_applications`                | A bounded, optionally filtered summary page                |
| `get_application`                  | One full record, events, and job-email evidence            |
| `match_job_application_email`      | Deterministic posting, email, or company match             |
| `extract_job_links`                | Offline canonical job-link candidates                      |
| `get_reference_data`               | Statuses, sources, role types, and document types          |
| `get_document_import_capabilities` | Accepted document and chunk sizes                          |
| `list_documents`                   | A bounded metadata and association page                    |
| `export_document_chunk`            | Hash-verified original-document bytes                      |
| `create_application`               | Create one validated workspace application                 |
| `update_application`               | Update selected fields on one application                  |
| `bulk_update_applications`         | Atomically update selected fields on up to 25 applications |
| `delete_application`               | Confirmed, audited soft deletion                           |
| `upsert_application_from_email`    | Ordered, idempotent application and email reconciliation   |
| `begin_document_import`            | Begin or resume a bounded document transfer                |
| `append_document_chunk`            | Append or replay one hash-verified chunk                   |
| `complete_document_import`         | Verify, store, and associate the original file             |
| `cancel_document_import`           | Discard an unfinished transient transfer                   |

Tools return JSON text and structured content. Before calling
`update_application`, read the record and send its `updatedAt` value as
`update.expectedUpdatedAt`. `bulk_update_applications` accepts 1–25 such
per-record updates and commits them atomically; one missing, stale, or invalid
record rolls back the entire batch. A concurrent change returns the stable
`application_conflict` code; read the latest record before retrying. Other
expected failures use stable codes such as `actor_unavailable` and
`application_not_found`; unexpected
failures return `internal_error` without exception details. Read tools are
annotated as read-only, non-destructive, idempotent, and closed-world. Mutation
application mutations are non-read-only and non-idempotent; deletion is also
destructive and requires `confirm=true`. Job-email upsert and document-transfer
mutations are non-read-only and idempotent.

See [`mcp-data-transfer.md`](mcp-data-transfer.md) for the document chunk
protocol and the boundary between logical MCP transfer and exact backup.
See
[`mcp-schema-publication.md`](mcp-schema-publication.md) for the generated
contract manifest, publication drift check, and OpenAI plugin release workflow.

Each accepted tool invocation appends an immutable audit event with its actor,
workspace, action, target type, result, transport, and timestamp. The event
stores no tool arguments, application content, credentials, or protocol
payloads. If the event cannot be stored, the tool returns `internal_error`
without returning workspace data. Settings → MCP shows the 20 most recent
events to administrators. A successful mutation and its audit event share one
immediate SQLite transaction. If the audit insert fails, the application change
rolls back and the tool returns `internal_error`.

Deployments that need authenticated remote access can configure the separate
Streamable HTTP endpoint described in [`remote-mcp.md`](remote-mcp.md). Both
transports expose the same tool contracts and connection-bound access policy.
