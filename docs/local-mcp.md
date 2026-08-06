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

The local server registers 43 tools:

| Tool                                  | Result                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `get_tracker_context`                 | Bound actor, workspace, role, and access mode              |
| `get_connector_schema_status`         | Live schema and optional distribution metadata status      |
| `get_job_search_summary`              | Status totals and due-action counts                        |
| `query_application_attention`         | Bounded priority queue with reason codes and counts        |
| `list_applications`                   | A bounded, optionally filtered summary page                |
| `list_deleted_applications`           | Bounded deletion ledger with actor, reason, and lineage    |
| `preview_application_restore`         | Read-only relationship and reference conflict proof        |
| `get_application`                     | One full record, first activity page, and email evidence   |
| `list_application_events`             | Bounded unified stage and general activity page            |
| `list_unlinked_applications`          | Records with no email or posting evidence                  |
| `get_application_data_quality`        | Bounded deterministic issue-code report                    |
| `audit_duplicate_applications`        | Bounded deterministic duplicate candidates                 |
| `find_duplicate_applications`         | Exact-name wrapper over the duplicate audit                |
| `merge_applications`                  | Preview or apply one explicit audited merge                |
| `recover_application_merge`           | Preview or safely reverse one unchanged merge              |
| `match_job_application_email`         | Deterministic posting, email, or company match             |
| `link_email_evidence`                 | Idempotently link one typed Message-ID to an existing row  |
| `reconcile_application_from_evidence` | Atomic link or match/create/update reconciliation          |
| `sync_outlook_email_evidence`         | Server-side Outlook search, score, link, and verification  |
| `reconcile_outlook_graph_connection`  | Incremental Graph connection evidence reconciliation       |
| `search_outlook_job_digests`          | Read-only bounded backward Graph digest search             |
| `process_outlook_job_digest`          | Read-only exact digest resolution and posting inspection   |
| `extract_job_links`                   | Offline canonical job-link candidates                      |
| `resolve_job_links`                   | Allowlisted tracking-link resolution                       |
| `inspect_job_posting`                 | Structured canonical posting metadata                      |
| `get_reference_data`                  | Statuses, sources, role types, and document types          |
| `get_document_import_capabilities`    | Accepted document and chunk sizes                          |
| `list_documents`                      | A bounded metadata and association page                    |
| `export_document_chunk`               | Hash-verified original-document bytes                      |
| `create_application`                  | Create one validated workspace application                 |
| `update_application`                  | Update selected fields on one application                  |
| `bulk_update_applications`            | Atomically update selected fields on up to 25 applications |
| `add_application_event`               | Concurrency-checked immutable status transition            |
| `add_application_activity`            | Immutable non-status activity with correction support      |
| `record_application_field_provenance` | Store one immutable normalized-field observation           |
| `verify_application_field_provenance` | Manually verify one provenance observation                 |
| `restore_application`                 | Confirmed optimistic restore for one manual deletion       |
| `delete_application`                  | Reasoned, confirmed, audited soft deletion                 |
| `upsert_application_from_email`       | Ordered, idempotent application and email reconciliation   |
| `begin_document_import`               | Begin or resume a bounded document transfer                |
| `append_document_chunk`               | Append or replay one hash-verified chunk                   |
| `complete_document_import`            | Verify, store, and associate the original file             |
| `cancel_document_import`              | Discard an unfinished transient transfer                   |

Tools return JSON text and structured content. Before calling
`update_application`, read the record and send its `updatedAt` value as
`update.expectedUpdatedAt`. `bulk_update_applications` accepts 1–25 such
per-record updates and commits them atomically; one missing, stale, or invalid
record rolls back the entire batch. A concurrent change returns the stable
`application_conflict` code; read the latest record before retrying. Other
expected failures use stable codes such as `actor_unavailable` and
`application_not_found`; unexpected
failures return `internal_error` without exception details. Read tools are
annotated as read-only, non-destructive, and idempotent. The resolver,
inspector, and digest processor are open-world because they make tightly
constrained external HTTPS or Graph reads; every other read tool is
closed-world.
Application mutations are non-read-only and non-idempotent; deletion is also
destructive and requires `confirm=true` plus a 3–500 character reason.
Deleted records stay out of normal reads. Use `list_deleted_applications` and
`preview_application_restore` for bounded read-only recovery inspection.
Manual restore requires `confirm=true` with the previewed deletion and record
versions. Merge recovery additionally requires both previewed record versions
and refuses to reverse relationships changed since the merge. Evidence linking, reconciliation,
job-email upsert, one-application Outlook synchronization, merging, and
document-transfer mutations are non-read-only and idempotent. Connection-wide
Outlook reconciliation is non-idempotent because every success advances its
durable cursor. All three server-side Outlook tools are open-world because the
server makes bounded Graph reads; the digest processor remains read-only.

`resolve_job_links` issues requests only to its built-in tracking-host
allowlist. `inspect_job_posting` accepts only URLs recognized by the provider
registry. Both reject credentials, cookies, non-HTTPS and nonstandard ports,
private or mixed DNS answers, unsafe redirects, excessive responses, and
timeouts. They pin each request to a validated public address.

Application create, update, list, and detail contracts expose nullable `agency`,
`salary`, `rating`, and `workArrangement` fields. `agency` is kept separate from
the end company, `salary` preserves the advert's own bounded text, `rating` is a
whole number from one to five, and `workArrangement` accepts `hybrid`, `remote`,
or `office`. They also expose nullable `outlookGraphConnectionId` and the
read-only `outlookGraphConnectionName`. Set the ID when a record originates
from a configured Graph connection. Existing and manual records remain
unassigned until a user selects one.

To link an Outlook message to a known application, pass its stable RFC
Message-ID, received time, optional Outlook `webUrl`, and one required
`evidenceType` to `link_email_evidence`. Supported types are
`original_advert`, `application_confirmation`, `recruiter_message`,
`interview_invitation`, `rejection`, `offer`, `withdrawal`, `follow_up`, and
`other`. Use `reconcile_application_from_evidence` to atomically link explicit
evidence or run the established match/create/update workflow. The stored type
and link are returned by `get_application` in `emailEvidence[].evidenceType`
and `emailEvidence[].webUrl`. This dedicated evidence link is separate from
the application's user-managed related `links`.

When server-side Outlook synchronization is configured, a client that already
has one application ID calls `sync_outlook_email_evidence` directly. It must not
call `get_tracker_context`, `get_application`, or a separate Microsoft 365 MCP
as preflight or verification for this path. The single result includes the
application read-back, existing-evidence validation, bounded candidate
assessments, link outcome, and stored-evidence verification. The tool requires
`read_write` because it may create an evidence link. See
[`outlook-email-sync.md`](outlook-email-sync.md).

To process new mail for one configured connection, call
`reconcile_outlook_graph_connection` directly with `connection` set to its
exact ID, name, or mailbox. Do not call `get_tracker_context`, a separate
Microsoft 365 MCP, or the one-application tool around it. The result reports
the previous and stored cursors, bounded per-message outcomes, link counts,
`reconciliation.hasMore`, and cursor verification. Repeat the same call while
`hasMore` is true so a backlog drains through timestamp-safe batches.

To find older digests without a separate mailbox connector, call
`search_outlook_job_digests` with the exact connection and a fixed `after` /
`before` window of at most 31 days. Page with the returned exact offset inside
each batch, then use the exact returned cursor to continue after a bounded
500-message batch. The server classifies at most 20 messages per page and
supports up to 100,000 messages in one fixed window,
returns no body, leaves the mailbox and reconciliation cursor unchanged, and
does not modify application or evidence records. The continuation is stateless;
it is not a stored mailbox or reconciliation cursor. Only exact Message-IDs
returned with `marketing_or_digest` classification may be passed to the digest
processor.

To inspect one exact digest returned by a prior pass or otherwise identified by
its RFC Message-ID, call `process_outlook_job_digest` with `connection`,
`messageId`, and optional `offset`. The server retrieves the message from the
configured folder, returns at most five posting inspections, and supplies
`page.nextOffset` until all of the digest's at most 20 candidates are covered.
Provider JSON-LD is preferred; after a provider challenge, a strict same-card
fallback may return an explicitly paired employer and title with
`inspectionSource: digest_email`. It returns no message body and never creates
or updates applications.

See [`mcp-data-transfer.md`](mcp-data-transfer.md) for the document chunk
protocol and the boundary between logical MCP transfer and exact backup.
See [`mcp-schema-publication.md`](mcp-schema-publication.md) for the generated
contract manifest and the separate, optional OpenAI-managed distribution
workflow.

Each accepted tool invocation appends an immutable audit event with its actor,
workspace, action, target type, result, transport, and timestamp. The event
stores no tool arguments, application content, credentials, or protocol
payloads. If the event cannot be stored, the tool returns `internal_error`
without returning workspace data. Settings → Connections shows the 20 most
recent events to administrators. A successful mutation and its audit event
share one immediate SQLite transaction. If the audit insert fails, the
application change rolls back and the tool returns `internal_error`.

Deployments that need authenticated remote access can configure the separate
Streamable HTTP endpoint described in [`remote-mcp.md`](remote-mcp.md). Both
transports expose the same tool contracts and connection-bound access policy.
