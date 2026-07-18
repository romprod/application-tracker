# Application ledger

The application ledger lets every authenticated workspace member create, list,
edit, and remove application records. It also records creation and real stage
changes in a permanent timeline. These records provide the base for actions,
outcomes, documents, and MCP tools.

## Current record

An application contains:

- company and role title;
- one built-in stage: `prospect`, `applied`, `interview`, `offer`, or `closed`;
- optional location, HTTP(S) source link, applied date, notes, current next
  action, and next-action due date; and
- created and updated timestamps.

Company and role are required. The server trims text, rejects unknown fields,
limits notes to 5,000 characters and next actions to 500 characters, validates
ISO dates, and accepts only HTTP(S) source links. The browser validates returned
next-action dates and links again before rendering them.

The built-in stages provide a small working workflow. A member can move a
record directly between them. Configurable stages and transition rules belong
to the Lists milestone; the current ledger does not claim that capability.

## Workspace interface

The dashboard derives total, open, stage, and closed counts from the active
workspace's application records. It orders open next actions by due date,
leaving undated actions last. Overdue, today, tomorrow, and upcoming labels make
the immediate work visible. The Applications page provides text search, stage
and location filters, and accessible sorting for every displayed data column.
Its compact table pattern is reused for recent dashboard records.

Selecting a row opens a detail drawer. The drawer presents the current record,
next action, source link, notes, and stage history without navigating away from
the table. Application intake and editing use a modal form. Saving updates the
record's current fields and update time; optional fields can be cleared.

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

Changing a company, role, date, location, source link, note, or next action does
not create a timeline event. Saving the same stage again also creates no event.
The timeline identifies the member who made each recorded change and displays
the newest event first.

## Authorization and HTTP boundary

All ledger routes require an active browser session. Both administrators and
members may use them:

- `GET /api/applications` lists the active workspace's records;
- `POST /api/applications` creates a record;
- `PATCH /api/applications/:applicationId` edits a record;
- `DELETE /api/applications/:applicationId` removes a record; and
- `GET /api/applications/:applicationId/events` lists its timeline.

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

Foreign keys bind records, events, and deletion audits to a workspace and its
members. Creation, editing, and removal transactions update related state
atomically. Database triggers reject event updates and deletions. Repository
queries bind every supplied value as an SQL parameter and use workspace-first
indexes for ledger and timeline reads.

## Deferred behavior

Configurable transition rules, contacts, additional links, and outcomes remain
unchecked in the capability checklist.
