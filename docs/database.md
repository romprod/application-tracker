# Database development

Application Tracker uses SQLite through `better-sqlite3`. The database opens
at `DATABASE_PATH`, creates its parent directory when necessary, and applies
pending migrations before the HTTP server starts.

## Connection guarantees

Every application connection enables:

- foreign-key enforcement
- a 5-second busy timeout
- WAL journaling for file-backed databases
- normal synchronous mode
- owner-only (`0600`) permissions on the database file

The default path is suitable for local development. Production deployments
should place the database and its WAL companions in a persistent directory
owned by the service account.

## Migration policy

Migrations live in `src/infrastructure/database/migrations/` and are listed in
strict version order. A migration is applied inside an immediate transaction.
Its version, name, and SHA-256 checksum are recorded in `schema_migrations`.

Once merged, a migration is immutable. Change the schema by adding the next
version; never edit an applied migration. Startup stops if recorded history is
missing from the application or a checksum has changed.

Migration tests must prove all of the following:

- a new database migrates from zero
- rerunning migrations is safe
- a failed migration rolls back
- constraints and foreign keys reject invalid data
- supported previous schemas migrate forward

## Initial identity schema

The first migration creates workspaces, users, local credentials, workspace
memberships, external identities, and sessions. The second adds the singleton
installation state used to close first-run setup. A session has a composite
foreign key to workspace membership, so a user cannot receive a session for a
workspace they do not belong to. Only a token hash is stored.

No migration creates a user or a default password. See
[`initial-setup.md`](initial-setup.md) for the closed administrator flow.

## Application ledger schema

The third migration creates `applications`. Each row belongs to one workspace
and records the creating workspace member. A composite foreign key prevents an
actor from creating a record outside their membership. The list index covers
workspace scope and reverse update order.

The original table constrains field lengths and the initial built-in stage
values. Migration 9 replaces that public stage contract with workspace-owned
references while retaining the original column as an internal compatibility
field. The domain schema trims text, validates dates, restricts source links to
HTTP(S), and rejects unknown fields before SQL runs. Repository queries bind
every user value as a parameter. See
[`application-ledger.md`](application-ledger.md).

The fourth migration adds `application_events` and backfills a creation event
for every existing application. A composite foreign key keeps each event in
the same workspace as its application, and another binds its actor to a member
of that workspace. Creation and stage-transition writes use immediate
transactions. Database triggers reject event updates and deletions, while a
workspace-and-application index serves timeline reads.

The fifth migration adds optional current-next-action text and due-date columns
to `applications`. Existing rows receive `NULL` values. A partial
workspace-and-due-date index includes only open records with a next action.

The sixth migration adds application deletion state and a strict deletion audit
table. A deletion transaction marks one active workspace record and writes its
actor and timestamp atomically. Active-record indexes exclude removed rows;
immutable application events remain stored.

The seventh migration adds normalized, ordered application contacts and labeled
HTTP(S) links. Composite foreign keys enforce the parent application's
workspace, storage constraints bound field sizes and relation counts, and
workspace-first indexes cover drawer hydration. Relation replacement is part of
the parent application's immediate write transaction.

The eighth migration adds workspace-scoped statuses, sources, role types, and
document types. A workspace-insert trigger seeds generic defaults for new
installations, while the migration backfills any existing workspace. Database
constraints enforce category values, case-insensitive label uniqueness, active
and closed-outcome flags, and deterministic ordering. See
[`reference-lists.md`](reference-lists.md).

The ninth migration links applications to their workspace's reference values.
It backfills existing statuses, adds foreign keys, and combines unique
workspace-and-ID pairs with ownership triggers. New or changed selections must
use an active value from the correct category. Event storage is rebuilt without
the original fixed-stage constraint so immutable history can retain any
workspace status label. The open-action index no longer relies on a hard-coded
status name; the service uses each status's closed-outcome flag.

The tenth migration adds append-only MCP audit events. Each row records the
workspace, actor, transport, tool action, target type, result, and timestamp.
Database constraints restrict these fields to implemented values, and triggers
reject updates and deletions. The audit record retains actor attribution even
after an administrator disables the account.

The eleventh migration adds content-addressed document storage. `file_objects`
stores each unique byte sequence once under its server-calculated SHA-256
digest. Workspace-owned `documents` rows retain the original filename, media
type, active document-type reference, uploader, and creation time.
`application_documents` links a document to active applications in the same
workspace. An immediate transaction stores bytes, metadata, and associations
together. See [`documents.md`](documents.md).

## Backup and restore

The operator commands create online backups through SQLite's backup API and
verify integrity, foreign keys, migration checksums, and SHA-256 digests. They
set backup and restore outputs to owner-only permissions. Restore writes only
to an absent destination and verifies the result before reporting success. See
[`backup-restore.md`](backup-restore.md) for commands, rehearsal, live
replacement, retention, and encryption boundaries.
