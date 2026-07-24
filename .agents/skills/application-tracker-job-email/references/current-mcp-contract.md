# Current Application Tracker MCP contract

Treat live tool schemas and descriptions as authoritative if they differ from
this reference.

## Contents

- [Required sequence](#required-sequence)
- [Microsoft 365 connector discovery](#microsoft-365-connector-discovery)
- [Job-link extraction](#job-link-extraction)
- [Match input and result](#match-input-and-result)
- [Duplicate audit and application merge](#duplicate-audit-and-application-merge)
- [Upsert input and idempotency](#upsert-input-and-idempotency)
- [Application detail evidence](#application-detail-evidence)
- [Attachment document imports](#attachment-document-imports)
- [Supported provider identities](#supported-provider-identities)
- [Generic application schemas](#generic-application-schemas)

## Required sequence

1. Call `get_tracker_context` to confirm the bound actor, workspace, and
   `read_only` or `read_write` access.
2. Call `get_reference_data` and use only active, category-correct reference
   IDs from this workspace.
3. Call `extract_job_links` when bounded email content contains posting links.
4. Call `match_job_application_email` before a write.
5. Call `upsert_application_from_email` for an authorized reconciliation.
6. Call `get_application` for read-back verification.

When duplicate consolidation is explicitly in scope, call
`audit_duplicate_applications`, then call `merge_applications` in preview mode
before any approved apply. Rerun `match_job_application_email` after a
successful merge and before the email upsert.

Application Tracker is consumed directly as an MCP server. Its schema version
and generated manifest describe that live contract. Optional publication
through an external managed distribution channel is separate from this
contract and requires an explicit user request; schema drift alone is not
authorization to register or submit a plugin.

## Microsoft 365 connector discovery

Discover an already-connected `@softeria/ms-365-mcp-server` instance from the
current task's MCP inventory. Do not require a fixed server name, URL, or
transport. Choose one namespace containing both `list-mail-folder-messages`
and `get-mail-message`, allowing hyphen/underscore normalization by the client.
Prefer exact package, Softeria, `ms365`, `m365`, or Microsoft 365 provenance,
but validate live schemas rather than trusting a label. When package metadata
is hidden, report only that the selected surface is Softeria-compatible. Ask
the user to choose if multiple candidates remain.

Its tools must be visible in the current task before mailbox work starts. An
existing hosted HTTP or local stdio instance is valid; do not register or
launch a replacement. Use `list-mail-folder-messages` to shortlist messages in
`Inbox\Jobs`, then `get-mail-message` from the same namespace for the selected
item. Explicitly select and verify both:

- `id`, the Microsoft Graph retrieval handle; and
- `internetMessageId`, the stable RFC Message-ID used by
  `match_job_application_email` and `upsert_application_from_email`.

The same non-empty `internetMessageId` must appear in list and detail results.
If it is absent or inconsistent, make no tracker write. For attachments, call
`list-mail-attachments` before `download-bytes` and download only the selected
named file attachment.

For attachments, require `list-mail-attachments` and `download-bytes` in the
same namespace. An alternative Outlook plugin is allowed only when the user
explicitly approves it and its live responses meet the same Message-ID and
attachment requirements. A client showing a connector as connected does not
prove that its tools are attached to the current task.

## Job-link extraction

`extract_job_links` accepts `content`, a 1 to 200,000 character email text or
HTML string. It returns up to 20 candidates with canonical `url`, `provider`,
nullable `externalPostingId`, and `host`. The tool performs no network
requests. It repairs Markdown and HTML destinations split by connector line
wrapping, joins bare URL lines only at URL punctuation, and unwraps only
deterministic targets such as supported Outlook Safe Links, Google redirects,
Cord links, hackajob links, and Totaljobs return URLs.

Opaque campaign, recruiter, account, search-result, and unsubscribe links are
not candidates. Pass a trustworthy returned candidate to
`match_job_application_email` as `posting.url`; do not decode rejected links or
follow their redirects independently.

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

## Duplicate audit and application merge

`audit_duplicate_applications` is read-only. It accepts `limit` from 1 to 100
and a non-negative `offset`. It returns a bounded page with `returned`, `total`,
and nullable `nextOffset`. Each candidate contains both full application
records, a `definite`, `probable`, or `possible` confidence band, and one or
more deterministic reasons:

- `posting_id`;
- `canonical_url`;
- `email_message_id`;
- `company_title`;
- `agency`;
- `location`;
- `applied_date`; and
- `contact`.

Treat reasons as evidence, not an instruction to merge. The audit performs no
mutation.

`merge_applications` uses one discriminated input:

- `mode: "preview"` requires distinct `sourceApplicationId` and
  `targetApplicationId`, and optionally accepts resolutions;
- `mode: "apply"` additionally requires `confirm: true`,
  `expectedSourceUpdatedAt`, `expectedTargetUpdatedAt`, and `resolutions`.

`resolutions.fields` maps each conflicting scalar field to `source` or
`target`. Conflicting status IDs require an explicit choice; the server does
not derive a "most advanced" status from labels. If contacts share an identity
but differ, links share a canonical URL but differ, or a combined set exceeds
ten entries, supply an explicit selected `contacts` or `links` array from the
previewed union.

Both modes return `preview` with:

- source, target, and provisional or applied survivor records;
- scalar `fieldConflicts`, their requested resolutions, and resolved values;
- source, target, additions, result, and resolution state for contacts, links,
  documents, postings, and email evidence;
- source and target immutable event arrays;
- `unresolvedConflicts`, `informationNotRetained`, and `safeToApply`.

Apply returns `applied`, `alreadyApplied`, and immutable `lineage` containing
the source ID, target ID, both previewed concurrency values, actor, and merge
time. It atomically associates source documents with the survivor, moves
posting and email evidence identities, replaces the survivor's bounded
contacts and links with the resolved result, records a target status event when
needed, inserts lineage, and finally marks the source merged. Existing source
events are never updated, deleted, or re-parented. Repeating the same completed
source-to-target merge returns the existing lineage.

Stable merge errors are:

- `application_merge_not_found`;
- `application_merge_deleted`;
- `application_merge_target_unavailable`;
- `application_already_merged`;
- `application_merge_conflict`; and
- `application_merge_unresolved_conflicts`.

Do not retry with guessed IDs, timestamps, or resolutions. Refresh the audit or
preview and obtain user approval for any changed decision.

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
- `statusOverride` only when a stale or regressive status change has been
  explicitly verified. It requires `allowStaleOrRegressive: true` and a
  concise reason retained with the immutable event.

`application` is the create fallback if no record matches. `update` is applied
only when at least one supplied value differs. Reusing the same Message-ID
returns the linked application instead of creating a duplicate. Exact retries
do not duplicate posting rows, email rows, or unchanged application updates.
When `update.statusId` is present, `email.receivedAt` is the status event's
effective time. The server retains processing time separately, rejects an
event older than the latest stage event, rejects a transition to a lower-order
status, and binds an accepted status event to the source Message-ID. Stable
failures are `job_email_status_stale`, `job_email_status_regression`, and
`job_email_status_conflict`.

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
- immutable stage `events`, including effective `occurredAt`, `processedAt`,
  the source email Message-ID when applicable, and any override reason;
- `jobPostings`; and
- `emailEvidence`.

A job posting contains provider, external posting ID when available, canonical
URL when available, and timestamps. Email evidence contains Message-ID,
received timestamp, optional Outlook web URL, and persistence timestamps. The
server does not store email subjects, senders, or bodies in this evidence.

## Attachment document imports

For a selected, named `fileAttachment`, list its metadata before materializing
only that attachment. Do not import `itemAttachment`, `referenceAttachment`,
inline content, an unsafe or empty filename, or an attachment without a valid
media type. Reject unsupported attachments before starting an upload.

The document sequence is:

1. `get_document_import_capabilities` returns `maxDocumentBytes` and
   `maxDocumentChunkBytes`.
2. Hash the materialized original and call `begin_document_import` with
   `applicationIds`, actual `byteSize`, active `documentTypeId`, caller-chosen
   `idempotencyKey`, original `mediaType` and `originalFilename`, and the
   whole-file `sha256`.
3. Call `append_document_chunk` at the returned `nextOffset`. Each canonical
   base64 chunk must decode within the chunk limit and match `chunkSha256`.
4. Call `complete_document_import` only after `receivedBytes` equals
   `byteSize`. Completion verifies the whole-file digest and stores one
   document associated with the supplied applications.
5. Use `export_document_chunk` to verify the stored byte size, whole-file
   digest, and per-chunk digests; use `list_documents` to verify metadata and
   associations.

Reusing the same idempotency key with identical metadata resumes or returns the
existing completed upload. Retrying completion returns the same document and
does not create a duplicate. Reusing the key with different metadata is an
error. Call `cancel_document_import` to discard transient chunks after an
abandoned import; it never deletes a stored document.

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
