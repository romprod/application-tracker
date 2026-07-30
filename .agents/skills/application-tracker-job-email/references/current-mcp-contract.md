# Current Application Tracker MCP contract

Treat live tool schemas and descriptions as authoritative if they differ from
this reference.

## Contents

- [Required sequence](#required-sequence)
- [Server-side one-application Outlook sync](#server-side-one-application-outlook-sync)
- [Server-side Graph connection reconciliation](#server-side-graph-connection-reconciliation)
- [Server-side Outlook digest processing](#server-side-outlook-digest-processing)
- [Microsoft 365 connector discovery](#microsoft-365-connector-discovery)
- [Job-link extraction](#job-link-extraction)
- [Job-link resolution](#job-link-resolution)
- [Job-posting inspection](#job-posting-inspection)
- [Match input and result](#match-input-and-result)
- [Evidence gaps and data quality](#evidence-gaps-and-data-quality)
- [Duplicate audit and application merge](#duplicate-audit-and-application-merge)
- [Evidence linking and atomic reconciliation](#evidence-linking-and-atomic-reconciliation)
- [Immutable application events](#immutable-application-events)
- [Application detail evidence](#application-detail-evidence)
- [Attachment document imports](#attachment-document-imports)
- [Supported provider identities](#supported-provider-identities)
- [Generic application schemas](#generic-application-schemas)

## Required sequence

For one existing application's Outlook evidence, call only
`sync_outlook_email_evidence` with its `applicationId`. Do not call
`get_tracker_context`, `get_application`, a matching or linking tool, or a
separate Outlook/MS365 MCP before or after it. The single tool performs its own
application read, Graph work, evidence write, application re-read, and storage
verification.

For new evidence across one configured Graph connection, call only
`reconcile_outlook_graph_connection` with its exact ID, name, or mailbox. Do not
call `get_tracker_context`, list applications, lower-level evidence tools, or a
separate Outlook/MS365 MCP around it.

For one exact digest RFC Message-ID, call only
`process_outlook_job_digest` with its exact connection selector, Message-ID, and
optional result-page offset. Do not fetch or pass the message body through
another connector. The tool is read-only and does not create prospects.

For a bounded historical digest search, call only
`search_outlook_job_digests` with an exact connection selector, fixed `after`
and `before` timestamps, and result-page offset. Do not fetch mail through
another connector or move the fixed window while paging.

Use the following sequence only for broader Jobs-folder enrichment, creation,
updates, or attachment import that is outside the dedicated one-application
tool:

1. Call `get_tracker_context` to confirm the bound actor, workspace, and
   `read_only` or `read_write` access.
2. Call `get_reference_data` and use only active, category-correct reference
   IDs from this workspace.
3. Call `extract_job_links` when bounded email content contains posting links.
4. Call `resolve_job_links` with the same content to resolve supported tracking
   links.
5. Call `inspect_job_posting` for each canonical candidate under suitability
   review.
6. Assess suitability from structured fields only.
7. Call `match_job_application_email` before a write.
8. Call `reconcile_application_from_evidence` with `mode: "match_or_create"`
   for an authorized reconciliation.
9. Call `get_application` for read-back verification.

When duplicate consolidation is explicitly in scope, call
`find_duplicate_applications`, then call `merge_applications` in preview mode
before any approved apply. Rerun `match_job_application_email` after a
successful merge and before the evidence reconciliation.

Application Tracker is consumed directly as an MCP server. Its schema version
and generated manifest describe that live contract. Optional publication
through an external managed distribution channel is separate from this
contract and requires an explicit user request; schema drift alone is not
authorization to register or submit a plugin.

## Server-side one-application Outlook sync

`sync_outlook_email_evidence` accepts one strict object:

- `applicationId`, the existing Application Tracker UUID.

It requires connection-bound `read_write` access and performs this sequence
inside the Application Tracker server:

1. read the application and at most 20 existing email-evidence rows;
2. validate stored RFC Message-IDs and received timestamps through Graph;
3. search the configured Inbox child folder with at most two bounded queries;
4. retain at most 20 message summaries and read at most five full messages;
5. classify and deterministically score each candidate;
6. reject absent or inconsistent Message-IDs, marketing/account mail,
   non-transactional mail, insufficient identity, ambiguity, and
   cross-application conflicts;
7. link only the highest deterministic candidate at or above the versioned
   threshold, unless valid evidence is already linked;
8. re-read the application and exact evidence row; and
9. commit the optional evidence link and successful MCP audit event atomically.

Graph reads occur before the SQLite transaction. A concurrent application
change returns `application_conflict`. An audit or read-back failure rolls the
evidence link back. The mailbox is read-only throughout.

The structured result includes:

- `outcome`: `linked`, `already_linked`, `no_match`, `ambiguous`, or `conflict`;
- the re-read `application` and all `emailEvidence`;
- `existingEvidenceValidation`;
- at most five `candidateAssessments`, each with classification, score, reasons,
  disqualifiers, qualification, bounded subject/sender metadata, Message-ID,
  and received time;
- `selectedEvidence`, `scoringVersion`, `threshold`, search counts, and link
  flags; and
- `verification.applicationReread`, `evidenceStored`, and `storedMessageId`.

Stable integration errors are `outlook_graph_connection_unassigned`,
`outlook_email_sync_unavailable`, `outlook_existing_evidence_limit`,
`outlook_folder_not_found`, `outlook_mailbox_unavailable`,
`outlook_graph_authentication_failed`, `outlook_graph_forbidden`,
`outlook_graph_throttled`, `outlook_graph_unavailable`, and
`outlook_email_verification_failed`. Do not retry through a separate connector
or lower-level tracker tools.

The workspace administrator manages named Graph connections under **Settings →
Connections**. Each application stores one nullable Graph origin, and the sync
tool resolves only that connection. Disabling it pauses synchronization. Hard
deletion preserves applications and evidence but clears affected assignments.
These lifecycle changes do not alter the MCP sync input.

The evidence record persists only RFC Message-ID, received time, optional
Outlook web URL, and evidence timestamps. Each workspace connection record
contains its non-secret route metadata and an encrypted client secret. The
server does not store Graph access tokens, plaintext secrets, subjects, senders,
headers, previews, or bodies.

## Server-side Graph connection reconciliation

`reconcile_outlook_graph_connection` accepts one strict object:

- `connection`, an exact configured connection ID, name, or mailbox.

It requires connection-bound `read_write` access. The server resolves one
enabled connection, starts after its last-successful cursor (or its creation
timestamp on the first run), lists at most 50 messages through a fixed run
timestamp, reads their full details, and deterministically scores each against
applications assigned to that connection. Only one unique high-confidence
application may receive a Message-ID. Existing, ambiguous, conflicting,
marketing, and unmatched mail is reported without a new link.

Evidence links, the new cursor, and the immutable MCP audit event commit
atomically after Graph reads. The result contains the connection,
previous/since/through/stored cursor window, per-message outcomes and bounded
identity metadata, aggregate counts, scoring version and threshold, and
connection/cursor/link verification. It never changes mailbox state, creates
opportunities, or changes application fields or status.

If more than 50 messages fall in the window, the tool returns
`outlook_reconcile_message_limit` without advancing the cursor. Other stable
connection-specific errors are `outlook_graph_connection_not_found`,
`outlook_graph_connection_ambiguous`, and
`outlook_graph_reconciliation_conflict`, in addition to normal Graph errors.

## Server-side Outlook digest processing

`process_outlook_job_digest` accepts one strict object:

- `connection`, an exact configured connection ID, name, or mailbox;
- `messageId`, the exact RFC Message-ID, up to 998 characters; and
- optional `offset`, from 0 through 19 and defaulting to 0.

It accepts connection-bound `read_only` or `read_write` access. The server
retrieves at most two exact matches from the configured Graph folder and
returns `not_found` or `ambiguous` instead of guessing. One exact message must
classify as `marketing_or_digest`; any other classification returns
`not_digest` without resolving links.

For a digest, the server resolves at most 20 canonical candidates and inspects
at most five from the requested offset. Every returned posting includes the
resolved candidate, structured inspection, a deterministic tracker match, and
whether its description was clipped to the digest-result limit of 4,000
characters. Follow `page.nextOffset` with otherwise identical input to read
another page.

The result never contains the message body. It does not advance a connection
cursor, persist the digest, link evidence, create a prospect, update an
application, or change mailbox state. Use the returned structured postings for
explicit suitability assessment. Treat any later tracker mutation as a
separate authorized workflow.

## Server-side historical Outlook digest search

`search_outlook_job_digests` accepts one strict object:

- `connection`, an exact configured connection ID, name, or mailbox;
- `after` and `before`, ISO timestamps defining a fixed window no longer than
  31 days;
- optional `limit`, 1 through 20 and defaulting to 20; and
- optional `offset`, 0 through 499 and defaulting to 0, with offset plus limit
  bounded to 500.

It accepts connection-bound `read_only` or `read_write` access. The server
queries only the configured Graph folder in descending received-time order,
reads details inside Application Tracker, classifies each bounded message, and
returns bounded metadata plus the exact RFC Message-ID when present. It never
returns a message body.

Follow `page.nextOffset` with the identical connection, window, and limit.
Stop when it is null. If `page.limitReached` is true, the fixed 500-message
ceiling was reached and callers must not widen or shift the window silently.
Use only messages explicitly returned with classification
`marketing_or_digest` and a non-null exact Message-ID as inputs to
`process_outlook_job_digest`.

The verification object reports `mailboxReadOnly: true`,
`messageBodyReturned: false`, `cursorChanged: false`, and
`applicationStateChanged: false`. The tool does not mark, move, categorize,
send, or delete mail; advance the reconciliation cursor; persist digest
content; or create or update applications. The normal immutable MCP audit event
is still recorded.

## Microsoft 365 connector discovery

This section applies only to broader folder enrichment and attachment workflows,
not to `sync_outlook_email_evidence` or `process_outlook_job_digest`.

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
  `match_job_application_email` and
  `reconcile_application_from_evidence`.

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
not candidates. Do not decode rejected links or follow their redirects
independently.

## Job-link resolution

`resolve_job_links` accepts the same bounded `content` as
`extract_job_links`. It runs the existing deterministic extractor unchanged,
then identifies at most five unresolved links whose exact host is on the
server's tracking-domain allowlist. The initial allowlist contains
`cts.indeed.com`.

The resolver:

- permits HTTPS on port 443 only;
- rejects embedded URL credentials;
- sends no authorization or cookie headers and keeps no cookie jar;
- resolves DNS before each request, rejects any private, loopback, link-local,
  documentation, multicast, reserved, or mixed public/private answer, and pins
  the request to one validated public address;
- follows at most three redirects and makes requests only to allowlisted
  tracking hosts;
- downloads no response body;
- enforces a five-second resolution deadline and process-wide outbound
  concurrency admission; and
- accepts a destination only when `JobBoardProviderRegistry` recognizes and
  canonicalizes it.

The result contains up to 20 deduplicated `candidates`. Each includes the normal
provider fields plus `resolution` (`deterministic` or `tracking_redirect`) and
`redirectsFollowed`. `tracking` reports attempted and resolved counts plus
bounded unavailable host and reason entries. It never returns tracking query
tokens. Pass a trustworthy candidate to `inspect_job_posting` and then to
`match_job_application_email` as `posting.url`.

## Job-posting inspection

`inspect_job_posting` accepts one HTTPS `url` up to 2,048 characters. The server
first requires `JobBoardProviderRegistry` to recognize it, then fetches the
registry's canonical URL. It applies the same credential-free, cookie-free,
public-IP-pinned HTTPS boundary, a five-second total deadline, at most three
redirects, and a 1 MiB response limit. Every redirect must also be recognized
by the provider registry. Only HTML and XHTML responses are parsed.

The inspector reads JSON-LD objects whose schema type is `JobPosting`. It
returns `status: available`, the canonical URL, and nullable structured fields:

- `employer`;
- `title`;
- `location`;
- `salary`;
- `workArrangement` (`remote`, `hybrid`, or `office`);
- inert, whitespace-normalized `description` capped at 20,000 characters;
- ISO `closingDate`; and
- HTTPS `applyUrl`.

Missing structured fields remain null. The inspector never fills them from
visible page text or snippets. HTTP 404 or 410 and an elapsed `validThrough`
return `status: unavailable` with `reason: expired`. Authentication,
anti-bot, rate-limit, unsafe redirect, fetch, missing structured-data, and
ambiguous-metadata outcomes also return `unavailable` with a stable reason
instead of guessed metadata.

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

## Evidence gaps and data quality

`list_unlinked_applications` is read-only and paginated with `limit` from 1 to
100 and a non-negative `offset`. “Unlinked” means the application has neither
dedicated email evidence nor dedicated job-posting evidence. Each summary
returns both zero counts and both missing-evidence flags. Records with either
evidence type are not included.

`get_application_data_quality` is read-only and uses the same bounded
pagination. It returns deterministic issue codes, per-code counts, total
applications, applications with findings, and total issues. It never guesses a
missing value and does not assign a subjective quality score. Codes cover
missing dedicated evidence, source, source URL, role type, location, working
arrangement, non-terminal next action, and inconsistent action/due-date pairs.
Evidence and optional-field gaps are signals for review, not permission to
invent or overwrite data.

## Duplicate audit and application merge

`find_duplicate_applications` is the exact-name read-only wrapper over the
existing `audit_duplicate_applications` algorithm. Both accept `limit` from 1
to 100 and a non-negative `offset`, and return the same bounded page with
`returned`, `total`, and nullable `nextOffset`. Each candidate contains both
full application records, a `definite`, `probable`, or `possible` confidence
band, and one or more deterministic reasons:

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

## Evidence linking and atomic reconciliation

For one known application's automatic Outlook evidence search, use
`sync_outlook_email_evidence` instead of the tools in this section.

`link_email_evidence` requires an explicit existing `applicationId` and one
bounded `email` object with `messageId`, `receivedAt`, and optional `webUrl`.
It is idempotent. A Message-ID already linked to the same application returns
the existing row; a Message-ID attributed to another application returns
`job_email_conflict`.

`reconcile_application_from_evidence` is a discriminated union:

- `mode: "link_existing"` requires an explicit `applicationId`, `email`, and
  optional `posting`; both evidence rows are linked in one transaction; or
- `mode: "match_or_create"` requires `reconciliation`, using the established
  application, email, posting, update, and status-override input below.

The `match_or_create` mode delegates to the same deterministic matcher and
idempotent service as `upsert_application_from_email`; it does not introduce a
second matching algorithm.

The nested `reconciliation` requires:

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

- `action`: `linked`, `created`, `matched`, or `updated`;
- the full `application`;
- `matchLevel`;
- `postingLinked` and `emailEvidenceLinked` booleans; and
- all persisted `jobPostings` and `emailEvidence` for the application.

Stable expected failures include `job_email_ambiguous`,
`job_email_conflict`, `invalid_job_posting_evidence`,
`invalid_application_reference`, and `write_access_disabled`.

`upsert_application_from_email` remains available as a backward-compatible
direct entry point to the same `match_or_create` behavior.

## Immutable application events

`add_application_event` does not accept arbitrary event types, notes, actors,
or historical rows. It permits only one status transition and requires:

- `applicationId`;
- an active target `statusId`;
- the current `expectedUpdatedAt`;
- the effective `occurredAt`;
- optional `sourceEmailMessageId`; and
- optional `statusOverride` with `allowStaleOrRegressive: true` and a bounded
  reason.

The application update and immutable `status_changed` event commit together.
Same-status, stale, regressive, conflicting, or stale-concurrency requests are
rejected. An exact retry carrying the same source Message-ID, occurrence time,
and target status returns the existing event without adding another row. Stable
event failures are `application_event_no_change`, `application_event_stale`,
`application_event_regression`, `application_event_conflict`, and
`application_conflict`.

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
