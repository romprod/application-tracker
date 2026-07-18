# Application ledger

The application ledger lets every authenticated workspace member create, list,
and edit application records. It also records creation and real stage changes
in a permanent timeline. These records provide the base for actions, outcomes,
documents, and MCP tools.

## Current record

An application contains:

- company and role title;
- one built-in stage: `prospect`, `applied`, `interview`, `offer`, or `closed`;
- optional location, HTTP(S) source link, applied date, and notes; and
- created and updated timestamps.

Company and role are required. The server trims text, rejects unknown fields,
limits notes to 5,000 characters, validates ISO dates, and accepts only HTTP(S)
source links. The browser validates returned links again before rendering them.

The built-in stages provide a small working workflow. A member can move a
record directly between them. Configurable stages and transition rules belong
to the Lists milestone; the current ledger does not claim that capability.

## Editing and stage history

The Edit control opens the selected record in the ledger form. Saving updates
the record's current fields and update time. Optional fields can be cleared.

Each application has an immutable timeline with two event types:

- `application_created`, with the stage selected at creation; and
- `status_changed`, with the previous and new stages.

Changing a company, role, date, location, source link, or note does not create
a timeline event. Saving the same stage again also creates no event. The
timeline identifies the member who made each recorded change and displays the
newest event first.

## Authorization and HTTP boundary

All ledger routes require an active browser session. Both administrators and
members may use them:

- `GET /api/applications` lists the active workspace's records;
- `POST /api/applications` creates a record;
- `PATCH /api/applications/:applicationId` edits a record; and
- `GET /api/applications/:applicationId/events` lists its timeline.

The application service derives the workspace, creator, and editing actor from
the authenticated session. Request bodies cannot select those values. A record
outside the active workspace has the same not-found response as a missing
record.

Browser mutations require an Origin that matches the request host. Responses
use `Cache-Control: no-store` and omit workspace identifiers, creator
identifiers, sessions, and credentials.

## Persistence

Migration 3 creates the strict `applications` table. Migration 4 adds the strict
`application_events` table and backfills one creation event for each existing
application. Because version 3 had no editing feature, the backfilled creation
event uses each record's existing stage.

Foreign keys bind records and events to a workspace and its members. Creation
and editing transactions update the application and insert any required event
atomically. Database triggers reject event updates and deletions. Repository
queries bind every supplied value as an SQL parameter and use workspace-first
indexes for ledger and timeline reads.

## Deferred behavior

Deletion, search, sorting controls, configurable transition rules, contacts,
follow-up actions, and outcomes remain unchecked in the capability checklist.
