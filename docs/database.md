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

The table constrains field lengths and the built-in stage values. The domain
schema also trims text, validates dates, restricts source links to HTTP(S), and
rejects unknown fields before SQL runs. Repository queries bind every user
value as a parameter. See [`application-ledger.md`](application-ledger.md).

The fourth migration adds `application_events` and backfills a creation event
for every existing application. A composite foreign key keeps each event in
the same workspace as its application, and another binds its actor to a member
of that workspace. Creation and stage-transition writes use immediate
transactions. Database triggers reject event updates and deletions, while a
workspace-and-application index serves timeline reads.

The fifth migration adds optional current-next-action text and due-date columns
to `applications`. Existing rows receive `NULL` values. A partial
workspace-and-due-date index includes only open records with a next action.

## Backup status

Online backup and verified restore tooling have not been implemented yet. Do
not treat filesystem copies of a live WAL database as the project backup
procedure. The release checklist remains incomplete until backup and restore
are implemented and rehearsed.
