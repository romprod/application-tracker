---
name: application-tracker-job-email
description: Reconcile job-search emails with Application Tracker through its MCP server. Use when asked to inspect an Outlook Jobs folder or supplied job email, identify the corresponding tracked application, match by job-board posting identity or company plus title, create or update an application idempotently, persist source-email evidence, or explain why an email cannot be matched safely.
---

# Application Tracker Job Email

Reconcile each job email with the correct Application Tracker record. Use the
email connector only to read the requested messages. Use Application Tracker's
dedicated MCP match and upsert tools for authoritative identity, uniqueness,
permissions, and persistence.

Never invent tool arguments, reference IDs, job identities, employer names, or
application facts. Never store a full email body in Application Tracker.

## Preconditions

Require these Application Tracker MCP tools:

- `get_tracker_context`;
- `get_reference_data`;
- `extract_job_links` when the email contains posting links;
- `match_job_application_email`;
- `get_application`; and
- `upsert_application_from_email` for mutations.

Also require an email connector that can read the requested folder or message,
or email content supplied by the user. Tool names may be namespaced by the
client; resolve them by final tool name.

Treat inspect, investigate, compare, and preview requests as read-only. Treat
reconcile, import, create, link, and update requests as authorization for the
corresponding non-destructive tracker writes. Never delete an application in
this workflow.

Read
[references/current-mcp-contract.md](references/current-mcp-contract.md)
before making tracker calls. Treat each live MCP schema as authoritative if it
differs from the reference.

## Workflow

### 1. Establish scope and access

1. Resolve the exact mailbox and folder. For a general request, use
   `Inbox\Jobs`; do not expand to the whole mailbox without authorization.
2. Call `get_tracker_context` before other tracker operations.
3. For writes, require `read_write`. If access is `read_only`, complete the
   read-only analysis and report the blocker without retrying mutations.
4. Call `get_reference_data`. Use only active IDs from the bound workspace.

### 2. Read and classify emails

For each in-scope message, retain working evidence for:

- stable internet Message-ID;
- durable Outlook message web URL, when available;
- sender, subject, and received timestamp;
- company and job title explicitly named by the message;
- direct job-posting URL and explicit board-scoped posting ID; and
- event type and effective date.

Classify the message as an application acknowledgement, interview or
assessment, recruiter conversation, status or rejection, offer, posting-only
opportunity, or irrelevant alert/marketing/account message.

Do not create an application from a digest, recommendation, marketing message,
security code, or account notification unless the user explicitly asks to
track the opportunity. A job-board sender is not the employer. Do not infer an
undisclosed employer from an agency or recruiter name.

### 3. Extract identity without guessing

When the connector returns email text or HTML, call `extract_job_links` with
that bounded content. The tool repairs narrowly recognized connector line
wraps, unwraps only transparently encoded targets, and returns at most 20
canonical candidates without making network requests. Pass a trustworthy
candidate's `url` as `posting.url` to `match_job_application_email`; do not
invent a provider or external posting ID from a rejected link.

Prefer a direct posting URL. Pass supported email click URLs only when their
target is encoded transparently; the server owns provider-specific
canonicalization. Supply `provider` plus `externalPostingId` without a URL only
when both values are explicit and trustworthy.

Do not fetch redirects, visit links, decode opaque tracking payloads, or use
campaign, recruiter, account, search-result, or click IDs as posting IDs.

Preserve the best explicit company and title for display. Normalize them only
for comparison: Unicode-compatible case folding, collapsed whitespace, and
standard apostrophes/dashes. Retain seniority, discipline, location qualifiers,
and legal company suffixes.

### 4. Match through the server

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

### 5. Build the idempotent upsert

Call `upsert_application_from_email` only after the intended create-or-update
decision is clear. Supply:

- `application`: the complete validated create fallback, including explicit
  company, role title, and an active status ID;
- `email.messageId` and `email.receivedAt`, plus `email.webUrl` when durable;
- `posting` when trustworthy evidence exists; and
- `update` only for selected fields that should change on an existing match.

Use `Applied` only for clear submission or acknowledgement evidence. Use
`Prospect` for a posting-only opportunity the user explicitly asked to track.
Set `appliedOn` only when the date is known. Select `sourceId` from active
reference data, normally Job board or Recruiter, and set `sourceUrl` to the
direct posting URL when appropriate.

For updates:

- retrieve the current application when its full state is needed;
- pass its `updatedAt` value as `update.expectedUpdatedAt` when using generic
  `update_application`, and read the latest record after
  `application_conflict` before retrying;
- send only fields supported by the email;
- never replace a newer status with an older event;
- preserve notes, contacts, links, source, and source URL unless replacement is
  explicitly intended; and
- remember that generic `update_application` semantics replace contacts and
  links when those arrays are present.

The upsert persists posting identity and bounded email evidence in dedicated
tables. Workspace uniqueness on posting identity, canonical URL, and Message-ID
prevents duplicate attribution. An exact retry is safe; do not fall back to
generic create/update after an uncertain upsert result.

### 6. Verify and report

After a successful upsert, call `get_application` and verify:

- company, title, and status;
- the expected `jobPostings` entry;
- the expected `emailEvidence` Message-ID and optional web URL; and
- any selected field update.

Report matched, created, updated, skipped, ambiguous, conflicting, and failed
counts. For each mutation, report the email subject or date, application ID,
match level, and whether new posting or email evidence was linked.

Never claim a link or change unless the MCP write succeeded and read-back
confirmed it.
