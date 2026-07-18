# Application ledger

The first ledger slice lets every authenticated workspace member create and
list application records. It provides the durable record on which history,
actions, outcomes, documents, and MCP tools can later operate.

## Current record

An application contains:

- company and role title;
- one built-in stage: `prospect`, `applied`, `interview`, `offer`, or `closed`;
- optional location, HTTP(S) source link, applied date, and notes; and
- created and updated timestamps.

Company and role are required. The server trims text, rejects unknown fields,
limits notes to 5,000 characters, validates ISO dates, and accepts only HTTP(S)
source links. The browser validates returned links again before rendering them.

The built-in stages provide a small working workflow. Configurable stages and
transition rules belong to the Lists milestone; this slice does not claim that
capability.

## Authorization and HTTP boundary

`GET /api/applications` and `POST /api/applications` require an active browser
session. Both administrators and members may use them. The application service
derives the workspace and creator from the authenticated actor; request bodies
cannot select either value.

Browser mutations require an Origin that matches the request host. Responses
use `Cache-Control: no-store` and omit workspace identifiers, creator
identifiers, sessions, and credentials.

## Persistence

Migration 3 creates a strict `applications` table. Its foreign keys bind every
record to a workspace and one of that workspace's members. The repository binds
all values as SQL parameters and lists records through an index on workspace,
updated time, and identifier.

## Deferred behavior

This slice creates and lists records. Editing, deletion, search, sorting
controls, stage transitions, timeline events, contacts, follow-up actions, and
outcomes remain unchecked in the capability checklist.
