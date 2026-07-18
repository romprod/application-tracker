# Backup and restore

Application Tracker provides operator commands for online SQLite backup,
artifact verification, and restore into a new database file. The backup command
can run while the application is serving requests in WAL mode.

The commands use the compiled server tools. Run `npm run build` after each
checkout or update before using them.

## Guarantees

The commands:

- use SQLite's online backup API instead of copying the live database file;
- write through a temporary file and publish the completed artifact atomically;
- refuse to overwrite a file, including a symbolic link;
- set backup and restored database files to owner-only (`0600`) permissions;
- run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`;
- verify every recorded migration name and checksum against this release; and
- report the byte size, SHA-256 digest, stored schema version, and current
  application schema version.

Backups contain application data, local password hashes, and active session
records. Store them as sensitive data. The commands do not encrypt artifacts,
copy them off-host, schedule backups, or delete old backups.

## Create an online backup

Set `DATABASE_PATH` and `BACKUP_DIRECTORY` in `.env`, then run:

```sh
npm run db:backup
```

The command creates a timestamped file under `BACKUP_DIRECTORY`. Use an
explicit destination when needed:

```sh
npm run db:backup -- --output /secure/backup/application-tracker.sqlite
```

The destination must not exist. A successful command prints one JSON object
with the artifact path and verification report. Treat success from the command
as the local backup result; copy the artifact and its SHA-256 digest to separate
storage according to the deployment's retention policy.

Never use `cp` or a similar filesystem copy as the backup procedure for a live
WAL database. The main file may not contain committed pages still present in
its WAL companion.

## Verify an artifact

Verification opens the artifact read-only and does not apply migrations:

```sh
npm run db:verify -- --input /secure/backup/application-tracker.sqlite
```

The command exits with a nonzero status for an invalid SQLite file, failed
integrity check, foreign-key violation, unknown migration, missing migration,
or changed migration checksum. `requiresMigration` is `true` when the artifact
contains a valid older schema that this release can migrate during startup.

## Rehearse a restore

Restore to a new path while the running application continues using its normal
database:

```sh
npm run db:restore -- \
  --input /secure/backup/application-tracker.sqlite \
  --output /secure/restore-rehearsal/application-tracker.sqlite
```

The restore command verifies the input, writes a new database through SQLite's
backup API, and verifies the result. Query only synthetic or approved operator
metadata during a rehearsal; do not print user or credential records into
logs. Remove the rehearsal directory through the host's normal secure-data
disposal process after recording the result.

## Replace a failed database

A replacement restore requires downtime:

1. Stop every Application Tracker process that opens the database.
2. Move the current database, `-wal`, and `-shm` files together into a
   timestamped recovery directory on the same protected host.
3. Run `db:restore` with the selected backup as `--input` and the configured
   `DATABASE_PATH` as `--output`.
4. Confirm the command's schema version, SHA-256 digest, and successful exit.
5. Start the application. Startup applies any supported pending migrations.
6. Verify application health, login, workspace access, and the expected schema
   version before resuming normal traffic.

The restore command will not replace the database until step 2 leaves the
target path absent. Keep the recovery directory until the restored service and
the next scheduled backup both pass verification.
