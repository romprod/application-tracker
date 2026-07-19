# Migration and rollback rehearsal: 2026-07-19

This record closes the database migration and rollback release gate for the
first public release. The rehearsal used synthetic data in isolated, detached
Git worktrees. It did not read a deployment `.env` file or any production data.

## Scope

- Prior application: `4318487802590b5cf6c14bd54fa72181582aa7be`
  (schema 10)
- Release candidate: `b3dcbde58fc3a1a5305aa4a49263b3a4306fcd84`
  (schema 15)
- Upgrade path: migrations 11 through 15
- Rollback path: restore the verified schema-10 backup and run the prior
  application build

Both worktrees passed `npm ci` and `npm run build` before the rehearsal.

## Synthetic fixture and backup

The schema-10 build created one administrator, workspace, application, contact,
link, timeline event, and MCP audit event. All names, URLs, and credential-like
values were synthetic.

Its online backup passed the schema-10 and schema-15 verification tools with:

| Property                 | Result                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| Schema version           | 10                                                                 |
| Size                     | 237,568 bytes, 58 pages                                            |
| Mode                     | `0600`                                                             |
| SHA-256                  | `089bec82feb35ab12302978bf285f1793edb3531b5c40ef851e02463788fec6e` |
| Release candidate result | Valid; migration required                                          |

## Forward migration result

The schema-15 restore tool restored the backup to a new file without changing
the source artifact. Opening the restored database with the release candidate
applied migrations 11 through 15. Verification then reported schema 15 with no
pending migration.

The following checks passed:

- migration versions were contiguous from 1 through 15;
- the user, workspace, application, contact, link, event, and MCP audit record
  remained readable;
- document, preview, MCP workspace settings, and MCP client tables existed;
- an absent MCP workspace settings row still resolved to the safe `read_only`
  default;
- the rebuilt MCP audit table admitted the new mutation actions; and
- `PRAGMA integrity_check` returned `ok` with no foreign-key violations.

The migrated file remained owner-only and the original backup retained its
size and SHA-256 digest.

## Rollback result

The current restore tool restored the same pre-upgrade backup to another new
file. The schema-10 build opened that file without applying a migration. It
read every synthetic record listed above, reported migrations 1 through 10,
and confirmed that schema-11-through-15 tables were absent.

The prior verification tool reported schema 10 with no pending migration. The
restored file matched the backup byte-for-byte, remained mode `0600`, passed
`PRAGMA integrity_check`, and had no foreign-key violations.

This confirms the documented rollback model: stop the service, preserve the
failed database and its WAL files, restore the verified pre-upgrade backup to a
new destination, and run the matching prior application version. Reverting an
image alone does not reverse a database migration.

## Outcome

**Passed.** The supported schema-10 database upgrades cleanly to schema 15, and
the verified pre-upgrade backup restores cleanly for the matching schema-10
application. The isolated worktrees and synthetic databases were removed after
this evidence was recorded.
