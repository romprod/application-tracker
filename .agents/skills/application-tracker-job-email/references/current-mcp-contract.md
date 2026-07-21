# Current Application Tracker MCP contract

Use this reference with Application Tracker servers that expose the generic
application tools described below. Treat each live tool schema and description
as authoritative if it differs from this file.

## Required read sequence

1. `get_tracker_context`
   - Confirms the bound actor, workspace, and `read_only` or `read_write`
     access.
2. `get_reference_data`
   - Returns workspace-specific statuses, sources, role types, and document
     types.
   - Use an ID only when its value is active and its category is correct.
3. `list_applications`
   - Accepts `limit` from 1 to 100, `offset`, and optional `statusId`.
   - Follow `nextOffset` until it is null when checking for duplicates.
   - Summaries contain company and title but do not contain links or `sourceUrl`.
4. `get_application`
   - Returns the full application, including `links`, `sourceUrl`, notes,
     contacts, and immutable stage events.

## Current writes

`create_application` requires:

- `companyName`: 1 to 160 characters;
- `roleTitle`: 1 to 160 characters; and
- `statusId`: an active status reference ID from the bound workspace.

It optionally accepts:

- `appliedOn`: ISO date;
- `contacts`: at most 10;
- `links`: at most 10;
- `location`: at most 160 characters;
- `nextAction`: at most 500 characters;
- `nextActionDue`: ISO date;
- `notes`: at most 5000 characters;
- `roleTypeId`: active role-type reference ID;
- `sourceId`: active source reference ID; and
- `sourceUrl`: HTTP or HTTPS URL, at most 2048 characters.

`update_application` accepts an `applicationId` and an `update` object. Omitted
fields remain unchanged. Nullable scalar fields can be cleared with `null`.
The update object must contain at least one changed field.

Important: `links` and `contacts` are replacement arrays. Always retrieve and
merge the complete existing array before adding an item.

The default reference labels are commonly `Prospect`, `Applied`, `Interview`,
`Offer`, and `Closed` for statuses, and `Company website`, `Job board`,
`Referral`, `Recruiter`, and `Other` for sources. Workspaces can change them;
never hardcode an ID and never select an inactive value.

## Posting identity

The current generic MCP contract does not expose posting identifiers as a
first-class unique field and does not expose the web application's email-link
extractor. Store the canonical posting URL in `sourceUrl` and, when available,
store a job-posting link whose label includes the provider and external ID.

Recognize an external ID only from these transparent forms:

| Provider     | Transparent evidence                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| LinkedIn     | Numeric ID in `/jobs/view/<id>`                                                |
| CV-Library   | Numeric ID in `/job/<id>` or `/job/apply/<id>`                                 |
| Indeed       | `jk` or `vjk` parameter, or the 16-character posting token in a direct job URL |
| Totaljobs    | Numeric `/job/<id>` path or `JobId` parameter                                  |
| Michael Page | `JN-<digits>-<digits>` value following `/ref/`                                 |
| hackajob     | UUID following `/apply/` or `/job/` in a direct decoded posting URL            |
| Cord         | Numeric ID immediately following `/jobs/`                                      |
| Talent.com   | Numeric `id` parameter on a direct posting URL                                 |

For other providers, retain a direct posting URL but set no external ID. Do not
use campaign IDs, email click IDs, recruiter IDs, account IDs, or search-result
IDs as posting identities.

The web application may unwrap known deterministic click links and remove
tracking parameters through its internal provider registry. An AI client using
only the current MCP tools cannot call that registry. Do not imitate network
redirect resolution or guess an ID from an opaque URL.

## Matching and storage conventions

Match records in this order:

1. provider plus external posting ID;
2. canonical posting URL in `sourceUrl` or `links`;
3. source-email URL or stable message identifier already stored;
4. exact normalized company plus exact normalized role title.

The current schema cannot enforce provider-ID uniqueness. Therefore, two
records with the same strongest identity are a data conflict, not permission to
choose one. Stop and report both IDs.

Use source-email evidence to make repeat runs safe. If a write result is
unknown, search again before retrying because generic application writes are
not idempotent.

## Expected evolution

A future server may expose dedicated posting extraction, matching, email
evidence, or idempotent upsert tools. Prefer those tools when available because
they can keep provider rules and uniqueness enforcement inside the
application. Inspect the live schema before calling them; this skill must not
invent future tool arguments.
