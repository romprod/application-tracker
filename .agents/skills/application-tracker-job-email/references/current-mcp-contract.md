# Current Application Tracker MCP contract

Treat live tool schemas and descriptions as authoritative if they differ from
this reference.

## Contents

- [Required sequence](#required-sequence)
- [Match input and result](#match-input-and-result)
- [Upsert input and idempotency](#upsert-input-and-idempotency)
- [Application detail evidence](#application-detail-evidence)
- [Supported provider identities](#supported-provider-identities)
- [Generic application schemas](#generic-application-schemas)

## Required sequence

1. Call `get_tracker_context` to confirm the bound actor, workspace, and
   `read_only` or `read_write` access.
2. Call `get_reference_data` and use only active, category-correct reference
   IDs from this workspace.
3. Call `match_job_application_email` before a write.
4. Call `upsert_application_from_email` for an authorized reconciliation.
5. Call `get_application` for read-back verification.

## Match input and result

`match_job_application_email` accepts:

- `posting` with an HTTP(S) `url`, or a non-generic `provider` plus
  `externalPostingId` pair;
- `emailMessageId`;
- `companyName` and `roleTitle` as a pair.

At least one identity is required. The server canonicalizes supported posting
URLs and evaluates evidence in this order:

1. provider plus external posting ID;
2. canonical posting URL;
3. source-email Message-ID;
4. exact normalized company plus exact normalized role title.

The result contains `outcome`, `level`, and bounded candidate summaries:

- `matched`: one application at the strongest available level;
- `none`: no candidate;
- `ambiguous`: more than one candidate at the strongest level;
- `conflict`: supplied levels point to different applications.

Lower-confidence evidence never overrides a stronger identity.

## Upsert input and idempotency

`upsert_application_from_email` requires:

- `application`, using the normal `create_application` schema;
- `email.messageId`, 1 to 998 characters;
- `email.receivedAt`, an ISO date-time.

It optionally accepts:

- `email.webUrl`, an HTTP(S) URL up to 2048 characters;
- `posting`, using the match posting schema; and
- `update`, using the non-empty application field schema. The reconciliation
  service reads and supplies the matched record's concurrency value internally;
  callers do not add `expectedUpdatedAt` to this nested update.

`application` is the create fallback if no record matches. `update` is applied
only when at least one supplied value differs. Reusing the same Message-ID
returns the linked application instead of creating a duplicate. Exact retries
do not duplicate posting rows, email rows, or unchanged application updates.

The result contains:

- `action`: `created`, `matched`, or `updated`;
- the full `application`;
- `matchLevel`;
- `postingLinked` and `emailEvidenceLinked` booleans; and
- all persisted `jobPostings` and `emailEvidence` for the application.

Stable expected failures include `job_email_ambiguous`,
`job_email_conflict`, `invalid_job_posting_evidence`,
`invalid_application_reference`, and `write_access_disabled`.

## Application detail evidence

`get_application` returns:

- `application` with normal contacts, links, notes, source, and status fields;
- immutable stage `events`;
- `jobPostings`; and
- `emailEvidence`.

A job posting contains provider, external posting ID when available, canonical
URL when available, and timestamps. Email evidence contains Message-ID,
received timestamp, optional Outlook web URL, and persistence timestamps. The
server does not store email subjects, senders, or bodies in this evidence.

## Supported provider identities

| Provider     | Transparent posting identity                                  |
| ------------ | ------------------------------------------------------------- |
| LinkedIn     | Numeric ID in `/jobs/view/<id>`                               |
| CV-Library   | Numeric ID in `/job/<id>` or `/job/apply/<id>`                |
| Indeed       | `jk` or `vjk`, or a 16-character direct-job token             |
| Totaljobs    | Numeric `/job/<id>` path or `JobId`                           |
| Michael Page | `JN-<digits>-<digits>` following `/ref/`                      |
| hackajob     | UUID following `/apply/` or `/job/`                           |
| Cord         | Numeric ID following `/jobs/`                                 |
| Talent.com   | Numeric `id` parameter on a direct posting URL                |
| Generic      | Direct canonical posting URL only; never claim an external ID |

Do not submit campaign, email-click, recruiter, account, or search-result IDs.

## Generic application schemas

The create fallback requires `companyName`, `roleTitle`, and active `statusId`.
Optional fields are `appliedOn`, contacts, links, location, next action and due
date, notes, role type ID, source ID, and source URL.

Updates omit unchanged fields and use `null` to clear nullable scalars. Contacts
and links are replacement arrays with at most 10 entries each.
