# Application ledger

The application ledger lets every authenticated workspace member create, list,
edit, and remove application records. It also records creation and real stage
changes in a permanent timeline. These records provide the base for actions,
outcomes, documents, and MCP tools.

## Current record

An application contains:

- end company and role title;
- an optional agency, kept separate from the end company;
- one workspace-defined status;
- optional workspace-defined source and role type;
- optional location, HTTP(S) source link, applied date, notes, current next
  action, next-action due date, salary text, one-to-five rating, and work
  arrangement (`hybrid`, `remote`, or `office`);
- up to ten ordered contacts, each with a name and optional role, email, and
  phone number;
- up to ten ordered, labeled HTTP(S) links; and
- created and updated timestamps.

End company and role are required. The server trims text, rejects unknown
fields, limits agency and salary text to 160 characters, limits notes to 5,000
characters and next actions to 500 characters, validates ISO dates and contact
email addresses, caps each relation list at ten entries, and accepts only
HTTP(S) web links. Ratings are whole numbers from one to five, and work
arrangement accepts only `hybrid`, `remote`, or `office`. The browser validates
returned dates, contacts, links, agency, salary, rating, and work arrangement
again before rendering them.

Administrators manage statuses, sources, and role types in Settings → Lists.
Members choose active values when creating or editing an application. An
inactive value remains visible on records that already use it but is not
offered for new selections. A status's closed-outcome flag, rather than its
label, determines whether the application counts as open.

## Workspace interface

The dashboard derives total, open, dynamic status, and closed counts from the
active workspace's application records. It orders open next actions by due date,
leaving undated actions last. Overdue, today, tomorrow, and upcoming labels make
the immediate work visible. The Opportunities page lists every tracked role.
The Applications page uses the same layout but includes only records with an
applied date. Both pages provide text search, stage and location filters, and
accessible sorting for every displayed data column, including agency, salary,
rating, and work arrangement. Their compact table pattern is reused for recent
dashboard records.

Selecting a row opens a detail drawer. The drawer presents the current record,
next action, source link, notes, and stage history without navigating away from
the table. Application intake and editing use a modal form. Saving updates the
record's current fields and update time; optional fields can be cleared.

Contacts and related links appear in numbered drawer sections that match the
established application-file layout. Email addresses and phone numbers use
their native contact links. Related web links open in a separate browser tab.
The create and edit modal lets members add, remove, and revise each ordered
entry without leaving the application record.

The drawer also opens a separate removal confirmation. Cancel receives initial
focus. A confirmed removal immediately removes the application from dashboard,
list, update, and timeline APIs. The application does not expose a restore
control, but the database retains the record and immutable history for audit and
operator-led recovery.

The table, drawer, and modal are keyboard operable. Sort buttons expose
`aria-sort`, rows open with Enter or Space, Escape closes overlays, and focus is
contained and restored while a dialog is open.

## Stage history

Each application has an immutable timeline with two event types:

- `application_created`, with the stage selected at creation; and
- `status_changed`, with the previous and new stages.

Changing an end company, agency, role, date, location, work arrangement, salary,
rating, source link, note, or next action does not create a timeline event.
Saving the same stage again also creates no event.
The timeline identifies the member who made each recorded change and displays
the newest event first. Events retain the status labels used at the time of the
change, so later list renames do not rewrite history.

Email-driven changes use the source email's received timestamp as the event's
effective time and retain the later processing timestamp separately. The
source Message-ID makes accepted email transitions idempotent. The server
rejects older or lower-order email stages unless the caller explicitly supplies
an override reason; accepted reasons remain part of immutable read-back.

## Authorization and HTTP boundary

All ledger routes require an active browser session. Both administrators and
members may use them:

- `GET /api/applications` lists the active workspace's records;
- `POST /api/applications` creates a record;
- `PATCH /api/applications/:applicationId` edits a record;
- `DELETE /api/applications/:applicationId` removes a record; and
- `GET /api/applications/:applicationId/events` lists its timeline.

Every application read includes `updatedAt`. A PATCH must send that value as
`expectedUpdatedAt` together with at least one changed field. The database
checks it atomically before updating fields, contacts, links, or stage history.
A stale PATCH returns HTTP 409 with `application_conflict` and the latest
application record; the browser keeps the edit open and offers to reload that
version before the user retries.

The application service derives the workspace and acting user from the
authenticated session. Request bodies cannot select those values. A record
outside the active workspace has the same not-found response as a missing or
already removed record.

Browser mutations require an Origin that matches the request host. Responses
use `Cache-Control: no-store` and omit workspace identifiers, creator
identifiers, sessions, and credentials.

## Persistence

Migration 3 creates the strict `applications` table. Migration 4 adds the strict
`application_events` table and backfills one creation event for each existing
application. Because version 3 had no editing feature, the backfilled creation
event uses each record's existing stage.

Migration 5 adds nullable `next_action` and `next_action_due` columns. Existing
records retain their data with both fields unset. A workspace-first partial
index covers open applications that have a next action.

Migration 6 adds nullable deletion state and the strict
`application_deletions` audit table. Removal marks the active application and
records its workspace, actor, and timestamp in one immediate transaction.
Normal repository queries exclude removed rows. Existing application events
remain unchanged and continue to reject updates and physical deletion.

Migration 7 adds strict `application_contacts` and `application_links` child
tables. Each row is workspace-bound to its application and carries a bounded
zero-based position. Creating or updating an application writes its ordered
contacts and links in the same immediate transaction as the parent record and
any stage event. A failed relation write rolls back the entire change.

Migration 9 connects each application to workspace-scoped status, source, and
role-type values. It backfills existing records against the generic defaults,
validates category and workspace ownership with foreign keys and triggers, and
rebuilds event storage to retain arbitrary status-label snapshots. The original
stage column remains as an internal compatibility field and is no longer part
of the repository or HTTP contract.

Migration 22 adds processing time, source email identity, and optional override
reason fields to immutable application events. It backfills existing processing
times from their effective timestamps and adds a workspace-unique partial index
for email-sourced status events.

Migration 25 adds nullable agency and salary text, a nullable one-to-five
integer rating, and a nullable work arrangement constrained to `hybrid`,
`remote`, or `office`. Existing records retain all four fields as unset.

Foreign keys bind records, contacts, links, events, and deletion audits to a
workspace and its members. Creation, editing, and removal transactions update
related state atomically. Database triggers reject event updates and deletions.
Repository queries bind every supplied value as an SQL parameter and use
workspace-first indexes for ledger, relation, and timeline reads.

## Deferred behavior

Configurable rules for member-driven transitions remain deferred. Statuses can
represent open or closed outcomes, but the browser does not restrict which
manual transition a member may make. Email-driven transitions use the ordering
guard described above.
