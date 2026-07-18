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
- a supported previous schema migrates forward when version two is added

## Initial identity schema

The first migration creates workspaces, users, local credentials, workspace
memberships, external identities, and sessions. The second adds the singleton
installation state used to close first-run setup. A session has a composite
foreign key to workspace membership, so a user cannot receive a session for a
workspace they do not belong to. Only a token hash is stored.

No migration creates a user or a default password. See
[`initial-setup.md`](initial-setup.md) for the closed administrator flow.

## Backup status

Online backup and verified restore tooling have not been implemented yet. Do
not treat filesystem copies of a live WAL database as the project backup
procedure. The release checklist remains incomplete until backup and restore
are implemented and rehearsed.
