---
name: application-tracker-job-email
description: Synchronize Outlook evidence for one known Application Tracker record through the tracker's server-side Microsoft Graph tool, or use the legacy connector-orchestrated flow for broader Jobs-folder enrichment and supported attachment imports. Use when asked to find, verify, link, reconcile, or import job-search email evidence without guessing identity.
---

# Application Tracker Job Email

For one known application, use Application Tracker's dedicated server-side
Outlook synchronization tool. The tracker owns Microsoft Graph authentication,
mailbox reads, deterministic scoring, persistence, audit, and verification.
Make one tracker MCP call and do not invoke a separate email connector.

The workspace administrator manages named Graph connections under **Settings →
Connections**. Each application must use its stored Graph origin. An unassigned
application returns `outlook_graph_connection_unassigned`; a disabled assigned
connection returns `outlook_email_sync_unavailable`. Do not bypass either state
with another connector for this one-application workflow.

Use the connector-orchestrated workflow only when the request is broader than
one known application's evidence sync, such as processing the Jobs folder,
creating worthwhile prospects, or importing an attachment.

Never invent tool arguments, reference IDs, job identities, employer names, or
application facts. Never store a full email body in Application Tracker.

## Preconditions

For one known application, require only:

- `sync_outlook_email_evidence`.

Do not require or call `get_tracker_context`, `get_reference_data`,
`get_application`, an Outlook plugin, or a Microsoft 365 MCP before or after
this tool. The Application Tracker server performs the complete read, Graph,
write, and read-back sequence. The call itself enforces actor, workspace, and
`read_write` permission.

For new-message evidence across one configured Graph connection, require only:

- `reconcile_outlook_graph_connection`.

Call it exactly once with `connection` set to the exact connection ID, name, or
mailbox supplied by the user. Do not call `get_tracker_context`, list
applications, lower-level matching or linking tools, an Outlook plugin, or a
Microsoft 365 MCP around it. The server owns the last-successful cursor,
bounded Graph reads, deterministic matching against assigned applications,
evidence persistence, cursor update, audit, and verification.

For one exact job-alert or digest RFC Message-ID, require only:

- `process_outlook_job_digest`.

Call it with `connection`, `messageId`, and optional `offset`. Do not call
`get_tracker_context`, retrieve the body through Outlook or Microsoft 365, or
pass body content to lower-level link tools. The server owns the exact Graph
lookup, digest classification, bounded link resolution, structured posting
inspection, deterministic tracker matching, and privacy verification. This
tool is read-only and never creates prospects.

For a bounded historical search for digest Message-IDs, require only:

- `search_outlook_job_digests`.

Call it with the exact `connection`, fixed `after` and `before` timestamps, and
the returned pagination offset. Do not call `get_tracker_context`, retrieve
mail through Outlook or Microsoft 365, or move the fixed search window while
paging. The server owns the Graph folder search, detail reads, classification,
and privacy verification. It returns no message body, changes no mailbox,
application, or evidence state, and never advances the reconciliation cursor.

For broader folder enrichment or connector-based reconciliation, require these
Application Tracker MCP tools:

- `get_tracker_context`;
- `get_reference_data`;
- `extract_job_links` when the email contains posting links;
- `resolve_job_links` when email links may use supported tracking redirects;
- `inspect_job_posting` before assessing or persisting a posting-only prospect;
- `match_job_application_email`;
- `get_application`; and
- `reconcile_application_from_evidence` for atomic mutations.

When a trustworthy message must only be linked to a known record, also require
`link_email_evidence`. Supply one explicit `evidenceType` from
`original_advert`, `application_confirmation`, `recruiter_message`,
`interview_invitation`, `rejection`, `offer`, `withdrawal`, `follow_up`, or
`other`. Use `add_application_event` only for an explicitly requested
standalone status transition; ordinary email-driven transitions belong inside
`reconcile_application_from_evidence`. Use `add_application_activity` only
when the user explicitly wants a meaningful non-status interaction recorded;
do not turn every linked email into a general activity automatically. Use
`list_application_events` to page beyond the bounded activity page embedded by
`get_application`.

When the user explicitly includes duplicate detection or consolidation, also
require:

- `find_duplicate_applications`; and
- `merge_applications`.

When the user asks for evidence-gap or data-quality review, also require
`list_unlinked_applications` and `get_application_data_quality`.

For that broader or attachment workflow, require an already-connected
`@softeria/ms-365-mcp-server` instance. Discover it from the current task's MCP
tool inventory instead of assuming a server name, URL, or transport:

1. Find one MCP namespace that exposes `list-mail-folder-messages` and
   `get-mail-message` (allow client-normalized hyphen or underscore forms).
2. Prefer a candidate whose server metadata, namespace, configuration, or tool
   descriptions identify `@softeria/ms-365-mcp-server`, Softeria, `ms365`,
   `m365`, or Microsoft 365.
3. Validate capability from the live tool schemas. A matching label alone is
   insufficient. If the client hides package metadata, describe the server as
   Softeria-compatible rather than claiming its package identity was verified.
4. If several candidates qualify and no exact Softeria identity is visible,
   stop and ask the user which connected server to use.

Confirm the selected tools are attached to the current task; a connected
status elsewhere in the client is not sufficient. Request
`internetMessageId` explicitly. Treat the Graph item `id` only as a retrieval
handle; persist the RFC `internetMessageId` as tracker email evidence.

Use an existing hosted HTTP or local stdio instance, but never install,
register, or launch another M365 server as a silent fallback. Do not substitute
an Outlook-specific plugin unless the user explicitly allows an alternative
and its live list and fetch results expose the same non-empty RFC
`internetMessageId`. If no qualifying tools are attached or authentication
fails, stop before tracker mutation and ask the user to attach or reconnect
their Softeria server.

Treat Application Tracker as a direct MCP server. Schema version or manifest
changes do not turn it into a plugin and do not authorize registration,
submission, or publication through any external distribution channel. Perform
such work only when the user explicitly requests that separate outcome.

When attachments are in scope, require `list-mail-attachments` and
`download-bytes` from that same selected M365 namespace so metadata can be
inspected before materializing one selected attachment. Also require these
tracker tools:

- `get_document_import_capabilities`;
- `begin_document_import`;
- `append_document_chunk`;
- `complete_document_import`;
- `cancel_document_import` for abandoned uploads;
- `export_document_chunk`; and
- `list_documents`.

Treat inspect, investigate, compare, and preview requests as read-only. Treat
reconcile, import, create, link, and update requests as authorization for the
corresponding non-destructive tracker writes. Never delete an application in
this workflow. Do not treat a reconciliation request as authorization to merge
records. Apply a duplicate merge only after the user explicitly approves the
source, target, and every conflict resolution.

Treat a general request to “process my Jobs folder” as authorization to run the
bounded enrichment sequence for that folder and to create or update only
worthwhile, inspected opportunities as `Prospect` records. It does not
authorize marking messages read, moving or deleting mail, applying for a role,
merging applications, deleting records, or changing an existing application
to `Applied`.

The automatic sequence is:

`email → extract links → resolve tracking links → inspect postings → assess
suitability → reconcile evidence → persist worthwhile prospects`.

Read
[references/current-mcp-contract.md](references/current-mcp-contract.md)
before making tracker calls. Treat each live MCP schema as authoritative if it
differs from the reference.

## Server-side one-application workflow

Use this path when the user supplies or has already selected one existing
Application Tracker application.

1. Call `sync_outlook_email_evidence` exactly once with only `applicationId`.
2. Do not add tracker context, application, matching, linking, verification, or
   Microsoft 365 calls around it.
3. Treat the returned `outcome` exactly:
   - `linked`: one qualifying RFC Message-ID was newly stored and verified;
   - `already_linked`: valid stored evidence was verified and no second row was
     added;
   - `no_match`: no candidate satisfied every deterministic requirement;
   - `ambiguous`: high-confidence evidence did not identify only this record;
   - `conflict`: evidence pointed to another application.
4. Confirm success only from `verification.applicationReread`,
   `verification.evidenceStored`, and `verification.storedMessageId`. Report the
   scoring version, threshold, bounded candidate assessments, and link flags.
5. Stop on `outlook_graph_connection_unassigned`,
   `outlook_email_sync_unavailable`,
   `outlook_folder_not_found`, `outlook_mailbox_unavailable`,
   `outlook_graph_authentication_failed`, `outlook_graph_forbidden`,
   `outlook_graph_throttled`, `outlook_graph_unavailable`,
   `outlook_existing_evidence_limit`, or
   `outlook_email_verification_failed`. Do not fall back to client-side mailbox
   matching or a separate MS365 MCP.

The server validates at most 20 existing evidence rows, searches the configured
Inbox child folder, retains at most 20 candidates, reads at most five full
messages, and applies a versioned deterministic confidence threshold. It never
changes mailbox state or stores subjects, senders, bodies, tokens, or
credentials in SQLite.

## Server-side connection reconciliation

Use this path when the user asks to recheck one named Graph connection or
mailbox for new evidence since its last successful pass.

1. Call `reconcile_outlook_graph_connection` exactly once with only
   `connection`.
2. Treat every message outcome exactly: `linked`, `already_linked`, `no_match`,
   `ambiguous`, or `conflict`.
3. Confirm success only when `verification.connectionReread` and
   `verification.cursorStored` are true and
   `window.storedLastReconciledAt` equals `window.through`.
4. Report the previous and stored cursors, assigned-application and bounded
   message counts, linked Message-IDs, and every ambiguous or conflicting
   message.
5. Stop on the normal Graph errors plus
   `outlook_graph_connection_not_found`,
   `outlook_graph_connection_ambiguous`,
   `outlook_graph_reconciliation_conflict`, or
   `outlook_reconcile_message_limit`. Do not fall back to another connector.

The first pass starts at the connection creation timestamp. Each successful
pass reads and inspects at most 50 new messages and advances the cursor only in
the same transaction as evidence links and the MCP audit event. It never
changes mailbox state, creates opportunities, changes application fields or
statuses, or stores subjects, senders, bodies, tokens, or credentials in
SQLite.

## Server-side digest processing

Use this path when one exact digest RFC Message-ID and configured Graph
connection are known.

1. Call `process_outlook_job_digest` with `connection`, `messageId`, and
   `offset: 0`.
2. Treat `processed`, `not_digest`, `not_found`, and `ambiguous` exactly. Do not
   guess around a non-processed result.
3. For `processed`, assess only the returned structured inspections and
   deterministic tracker matches. `inspectionSource: provider_page` means the
   fields came from provider JSON-LD. `inspectionSource: digest_email` means a
   provider challenge blocked inspection and the server found one exact
   supported posting link plus one explicit employer and title in the same
   bounded digest card. Report `digestFallback.attempted` and its stable
   `unavailableReason` for every challenged posting that could not use this
   fallback. Never infer missing employer, title, location, salary, or working
   arrangement from the digest metadata.
4. If `page.nextOffset` is non-null, repeat with the same connection and
   Message-ID and that exact offset.
5. Confirm the privacy boundary from `verification.mailboxReadOnly` and
   `verification.messageBodyReturned`. Do not claim the source body was
   returned or persisted.

The server resolves at most 20 candidates and inspects at most five per page.
Indeed inspections are serialized, spaced, deduplicated, briefly cached, and
placed in cooldown after a provider challenge. During that challenge only, the
server may fall back to an unambiguous same-card employer/title pair and marks
its provenance `digest_email`; incomplete or ambiguous cards remain
unavailable. Descriptions are capped at 4,000 characters and report truncation
explicitly. The tool does not return or store digest content, advance the
reconciliation cursor, link email evidence, create prospects, update
applications, or change mailbox state. Any later mutation requires separate
user authorization and the normal tracker context, reference, duplicate, and
reconciliation checks.

## Server-side historical digest search

Use this path when the user asks Application Tracker to search backward for
older job-alert or digest messages.

1. Call `search_outlook_job_digests` with `connection`, fixed ISO `after` and
   `before` timestamps, `offset: 0`, and a limit from 1 through 20.
2. Treat only messages whose returned `classification` is
   `marketing_or_digest` and whose exact returned `messageId` is non-null as
   digest-processing candidates.
3. When `page.nextOffset` is non-null, repeat with the same connection, fixed
   window, limit, and that exact offset.
4. Stop if `page.limitReached` is true; do not widen the 31-day or 500-message
   boundary or guess around unavailable details.
5. Confirm `verification.mailboxReadOnly`,
   `verification.messageBodyReturned`, `verification.cursorChanged`, and
   `verification.applicationStateChanged`.

The search reads and classifies at most 20 messages per page in a caller-fixed
window of at most 31 days and scans at most 500 messages. It returns bounded
subject, sender, received time, classification, and exact RFC Message-ID only.
It does not return bodies, change mailbox state, store digest content, advance
the reconciliation cursor, or change applications. Process each qualifying
Message-ID with `process_outlook_job_digest` before assessing or tracking any
posting.

## Connector-orchestrated broader workflow

### 1. Establish scope and access

1. Resolve the exact mailbox and folder. For a general request, use
   `Inbox\Jobs`; do not expand to the whole mailbox without authorization.
2. Discover and validate one already-connected Softeria M365 tool surface, and
   confirm it and the Application Tracker tools are available in the current
   task. Never create a replacement connector from the shell.
3. Call `get_tracker_context` before other tracker operations.
4. For writes, require `read_write`. If access is `read_only`, complete the
   read-only analysis and report the blocker without retrying mutations.
5. Call `get_reference_data`. Use only active IDs from the bound workspace.

### 2. Read and classify emails

For each in-scope message, retain working evidence for:

- stable internet Message-ID;
- durable Outlook message web URL, when available;
- the bounded evidence type the message actually proves;
- sender, subject, and received timestamp;
- company and job title explicitly named by the message;
- direct job-posting URL and explicit board-scoped posting ID; and
- event type and effective date.

Classify the message as an application acknowledgement, interview or
assessment, recruiter conversation, status or rejection, offer, posting-only
opportunity, or irrelevant alert/marketing/account message.

Do not create an application from a digest, recommendation, marketing message,
security code, or account notification unless the user explicitly asks to
track the opportunity. “Process my Jobs folder” is that explicit instruction
only for a specific posting that survives resolution, inspection, and
suitability assessment. A job-board sender is not the employer. Do not infer an
undisclosed employer from an agency or recruiter name.

### 3. Extract and resolve identity without guessing

When the connector returns email text or HTML, call `extract_job_links` with
that bounded content. The tool repairs narrowly recognized connector line
wraps, unwraps only transparently encoded targets, and returns at most 20
canonical candidates without making network requests.

Next call `resolve_job_links` with the same bounded content. It preserves the
existing deterministic extraction and may follow only its built-in allowlist
of HTTPS tracking domains. It sends no cookies or credentials, pins public DNS
results, and applies strict redirect, response-size, and timeout limits. Accept
only the returned canonical candidates; the server rejects final destinations
that `JobBoardProviderRegistry` does not recognize.

Prefer a direct posting URL. Pass supported email click URLs only when their
target is encoded transparently; the server owns provider-specific
canonicalization. Supply `provider` plus `externalPostingId` without a URL only
when both values are explicit and trustworthy.

Never fetch, browse, or decode a link independently. Do not use campaign,
recruiter, account, search-result, or click IDs as posting IDs.

Preserve the best explicit company and title for display. Normalize them only
for comparison: Unicode-compatible case folding, collapsed whitespace, and
standard apostrophes/dashes. Retain seniority, discipline, location qualifiers,
and legal company suffixes.

### 4. Inspect and assess posting-only opportunities

Call `inspect_job_posting` for each unique resolved canonical candidate that
could become a prospect. Use only its structured `JobPosting` result:

- employer and title;
- location and working arrangement;
- salary;
- description;
- closing date; and
- apply URL.

When the result is `unavailable`, make no prospect write and preserve the
reported reason. Do not recover missing fields from visible page text, the
email sender, snippets, or another URL. Require non-empty structured employer
and title before creating a prospect.

Assess suitability from explicit user criteria and the structured facts.
Consider discipline and seniority, stated location or working arrangement,
salary, role requirements, and closing date. Reject explicit mismatches and
expired roles. When the available evidence is insufficient to decide, report
the posting for review instead of persisting it. Never claim a role is suitable
from unavailable or inferred metadata.

For “process my Jobs folder,” continue automatically with each clearly
worthwhile posting. Use `Prospect`, the active Job board source, the canonical
posting URL, and only inspected location, salary, and working arrangement.
Include the explicit apply URL as a related link when it differs from the
canonical URL. Do not copy the full posting description into notes; retain at
most a concise suitability rationale.

### 5. Match through the server

Call `match_job_application_email` with every trustworthy discriminator:

- `posting.url`, or explicit `posting.provider` and
  `posting.externalPostingId`;
- `emailMessageId` when available; and
- `companyName` with `roleTitle` as a pair.

The server evaluates provider plus external ID, canonical URL, Message-ID, then
exact normalized company plus title. It also recognizes legacy posting URLs in
existing `sourceUrl` and links.

Handle the result exactly:

- `matched`: use the single returned application;
- `none`: create only when the classification and explicit facts justify it;
- `ambiguous`: make no write and report the candidate IDs;
- `conflict`: make no write and report that supplied evidence points to
  different applications.

Never choose between candidates using fuzzy title, recruiter, location, or
date similarity.

### 6. Handle duplicate consolidation as a separate action

Keep duplicate handling separate from ordinary email reconciliation. For an
`ambiguous` or `conflict` match, make no reconciliation write. If the user asks
to investigate duplicates, call `find_duplicate_applications` with a bounded
page and report each deterministic reason and confidence band.

Call `merge_applications` with `mode: "preview"` only after the user identifies
an explicit source record and surviving target. Preview is read-only and must
show:

- all scalar conflicts and requested source-or-target choices;
- contacts, links, documents, postings, and email evidence to consolidate;
- source and target event history;
- information that cannot be retained; and
- whether the merge is safe to apply.

Never infer the surviving status from label wording or apparent advancement.
If source and target statuses differ, require an explicit `statusId` resolution
through the preview. Do not choose a target from fuzzy evidence.

Apply only when the user explicitly approves the preview. Require
`mode: "apply"`, `confirm: true`, the previewed `updatedAt` value for both
records, and explicit choices for every unresolved field or bounded
contact/link conflict. Treat `application_merge_conflict`,
`application_merge_unresolved_conflicts`, `application_merge_deleted`,
`application_merge_target_unavailable`, and `application_already_merged` as
no-retry outcomes until the user reviews fresh state.

The server consolidates evidence, postings, documents, contacts, and links in
one transaction, records immutable merge lineage, preserves the source events
without rewriting or re-parenting them, and marks the source merged only after
success. An exact retry returns the existing lineage without duplicating
relationships.

After an approved merge, verify the returned survivor, lineage, consolidated
relationships, and retained source event count. Then rerun
`match_job_application_email` with the original evidence before continuing the
evidence reconciliation. Apply the reconciliation only if the original request
authorized it.

### 7. Reconcile evidence atomically

Call `reconcile_application_from_evidence` only after the intended
create-or-update decision is clear. Use `mode: "match_or_create"` and place the
following fields in `reconciliation`:

- `application`: the complete validated create fallback, including explicit
  company, role title, and an active status ID;
- `email.messageId` and `email.receivedAt`, plus `email.webUrl` when durable;
- `posting` when trustworthy evidence exists; and
- `update` only for selected fields that should change on an existing match.

For `update.statusId`, treat `email.receivedAt` as the source event's effective
time. The server rejects stale, lower-order, or conflicting events. Do not
retry those failures with a different timestamp. Use `statusOverride` only
after the user has explicitly verified the transition, and record a concrete
reason; the server preserves that reason with immutable stage history.
Do not use that status update as a substitute for a general activity row.

Use `Applied` only for clear submission or acknowledgement evidence. Use
`Prospect` for a worthwhile posting-only opportunity the user explicitly asked
to track, including the bounded “process my Jobs folder” workflow.
Set `appliedOn` only when the date is known. Select `sourceId` from active
reference data, normally Job board or Recruiter, and set `sourceUrl` to the
direct posting URL when appropriate.

For updates:

- retrieve the current application when its full state is needed;
- pass its `updatedAt` value as `update.expectedUpdatedAt` when using generic
  `update_application`, and read the latest record after
  `application_conflict` before retrying;
- send only fields supported by the email;
- handle `job_email_status_stale`, `job_email_status_regression`, and
  `job_email_status_conflict` as no-write outcomes;
- preserve notes, contacts, links, source, and source URL unless replacement is
  explicitly intended; and
- remember that generic `update_application` semantics replace contacts and
  links when those arrays are present.

The reconciliation persists posting identity and bounded email evidence in
dedicated tables. Workspace uniqueness on posting identity, canonical URL, and
Message-ID prevents duplicate attribution. An exact retry is safe; do not fall
back to generic create/update after an uncertain reconciliation result.

Use `mode: "link_existing"` only when the user or a prior deterministic match
has selected one explicit application and the operation needs to link evidence
without changing application fields. It accepts `applicationId`, `email`,
required `evidenceType`, and optional `posting` in one transaction. If only
email evidence is needed, `link_email_evidence` is the narrower idempotent
tool. The match-or-create reconciliation may also carry `evidenceType`; omit it
only for backward-compatible callers that must store the row as `other`.

### 8. Import a supported attachment

Only import an attachment after the email has been matched to one intended
application. List metadata first and retain the attachment ID, name, media
type, reported size, and inline flag. Select one relevant, named, non-inline
`fileAttachment` with a syntactically valid media type. Do not materialize
unrelated attachments.

Treat `itemAttachment`, `referenceAttachment`, inline content, empty or unsafe
filenames, missing media types, and files unrelated to the application as
unsupported. Skip them before `begin_document_import`; an unsupported
reference must leave no tracker upload or document state.

For the selected file:

1. Materialize only that attachment to a private temporary path.
2. Read the materialized bytes, record the actual byte size, and calculate the
   whole-file SHA-256. Connector metadata size is advisory and can include
   transport overhead.
3. Call `get_document_import_capabilities`; reject files over the document
   limit and split accepted bytes into chunks no larger than the returned
   chunk limit.
4. Choose an active, category-correct document type. Use `Other` when the file
   is application evidence but is not a CV, cover letter, or portfolio.
5. Call `begin_document_import` with only the matched application ID, original
   filename and media type, actual size and SHA-256, and a stable idempotency
   key such as `outlook-attachment-<sha256>`.
6. Append canonical base64 chunks in order. Supply the exact offset and
   SHA-256 of each decoded chunk, then call `complete_document_import`.
7. Retry `begin_document_import` with identical metadata and the same key.
   It must return the completed transfer and `complete_document_import` must
   return the same document ID.
8. Read the document back with `export_document_chunk` until complete and
   verify its actual size and whole-file SHA-256. Confirm through
   `list_documents` that exactly one document has the expected application,
   filename, media type, and document ID.

If materialization, hashing, chunking, or completion fails after an upload has
started, call `cancel_document_import` for its upload ID. Do not modify mailbox
read state, move the message, or delete the source attachment. Remove the
private temporary copy after successful verification.

### 9. Verify and report

After a successful reconciliation, call `get_application` and verify:

- company, title, and status;
- the expected `jobPostings` entry;
- the expected `emailEvidence` Message-ID, evidence type, and optional web URL;
  and
- any selected field update.

Report matched, created, updated, skipped, ambiguous, conflicting, and failed
counts. For each mutation, report the email subject or date, application ID,
match level, and whether new posting or email evidence was linked.

For automatic folder enrichment, also report resolved, inspected, suitable,
unavailable, and not-suitable counts. Include each unavailable reason and a
concise evidence-based rationale for each prospect persisted or held for
review.

For a duplicate merge, also report the source and target IDs, merge lineage ID,
whether the call applied or returned an existing merge, every chosen field
resolution, relationship additions, information not retained, and the number
of immutable source events preserved.

For an attachment import, also report the attachment ID and metadata, actual
byte size and SHA-256, document ID and application association, retry result,
and any unsupported attachment that was skipped before tracker mutation.

Never claim a link or change unless the MCP write succeeded and read-back
confirmed it.
