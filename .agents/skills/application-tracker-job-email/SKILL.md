---
name: application-tracker-job-email
description: Reconcile job-search emails with Application Tracker through its MCP server. Use when asked to inspect an Outlook Jobs folder or supplied job email, identify the corresponding tracked application, avoid duplicates using job-board posting evidence or company plus job title, create or update an application, attach source-email and posting links, or explain why an email cannot be matched safely.
---

# Application Tracker Job Email

Reconcile job email evidence with the correct Application Tracker record. Use
the email connector only to read the requested messages and use Application
Tracker MCP tools for tracker reads and writes.

The Application Tracker server is authoritative for validation, reference IDs,
permissions, and persistence. Never invent tool arguments, reference IDs, job
identities, or application facts.

## Preconditions

Require for every use:

- an Application Tracker MCP connection exposing `get_tracker_context`,
  `get_reference_data`, `list_applications`, and `get_application`; and
- either an email connector that can read the requested folder or email, or the
  relevant email content supplied by the user.

Also require `create_application` and `update_application` when the request
includes tracker mutations.

Tool names may be namespaced by the client. Resolve them by their final tool
name. If a required connection or tool is unavailable, identify the missing
capability and stop before claiming that anything was reconciled.

Treat requests to inspect, investigate, compare, or preview as read-only. Treat
requests to import, reconcile, create, link, or update as authorization for the
corresponding non-destructive tracker writes. Never delete an application as
part of this workflow.

Read [references/current-mcp-contract.md](references/current-mcp-contract.md)
before making tracker calls. It records the current tool constraints, field
mapping, and legacy matching behavior.

## Workflow

### 1. Establish scope and access

1. Resolve the exact mailbox and folder requested. For a general job-email
   reconciliation request, use `Inbox\Jobs`; do not expand to the whole mailbox
   without authorization.
2. Call `get_tracker_context` before other tracker operations.
3. If the request requires writes and `access` is `read_only`, continue the
   read-only analysis, then report that the administrator must enable MCP write
   access. Do not repeatedly attempt mutations.
4. Call `get_reference_data`. Use only active IDs returned by this workspace.

### 2. Read and classify emails

For every in-scope message, retain working evidence for:

- stable message identifier, when available;
- Outlook or provider web link to the message, when available;
- sender, subject, received or sent timestamp;
- company name and job title explicitly named by the message;
- direct job-posting URL and board-scoped posting ID, when safely observable;
- event type and effective date.

Classify the email as one of:

- application submitted or acknowledged;
- interview or assessment;
- recruiter conversation;
- application status or rejection;
- offer;
- job posting or saved opportunity only;
- irrelevant job alert, recommendation, marketing, security-code, or account
  notification.

Do not create an application from a digest, recommendation, marketing message,
or security-code email unless the user explicitly asks to track opportunities
rather than applications. A job-board sender is a source, not the employer.
Never infer an undisclosed employer from an agency or recruiter name.

### 3. Extract identity without guessing

Prefer a direct, canonical job-posting URL over an opaque email tracking URL.
Use a board-scoped posting ID only when it is explicitly present or can be read
from a transparent supported posting URL. Do not fetch redirects, visit links,
or decode an unknown tracking payload merely to manufacture an identity.

Normalize company and title only for comparison:

- apply Unicode-compatible case folding;
- trim and collapse whitespace;
- normalize typographic apostrophes and dashes;
- retain seniority, discipline, location qualifiers, and legal company suffixes.

Do not persist the normalized display text. Preserve the best explicit company
name and title from the evidence.

### 4. Load the complete candidate set

1. Call `list_applications` with `limit: 100` and `offset: 0`.
2. Follow every non-null `nextOffset`; never assume the first page is complete.
3. Select candidate summaries by company, title, or other explicit evidence.
4. Call `get_application` for candidates whose `sourceUrl`, `links`, notes, or
   full record are needed to decide the match.

Do not create a record until this search has completed.

### 5. Match deterministically

Use the following precedence:

1. Exact provider plus external posting ID.
2. Exact canonical job-posting URL.
3. Exact source-email URL or stable message identifier already recorded.
4. Exact normalized company plus exact normalized job title.

One unique match at the highest available level identifies the record. Lower
levels must not override conflicting higher-level evidence.

Treat the result as ambiguous and make no write when:

- two records share the same highest-confidence evidence;
- provider IDs or canonical URLs conflict;
- company or title is missing and there is no posting identity;
- only a fuzzy, partial, recruiter, or location-based similarity exists; or
- the same company and title appears in multiple applications without stronger
  evidence.

State the candidate records and the missing discriminator. Ask the user to
choose only when their choice is required for a write.

### 6. Decide create versus update

Update the unique match. Create a new record only when all of these are true:

- the message is credible evidence of an application, or the user explicitly
  asked to track a posting or opportunity;
- the complete candidate search found no match;
- company name and job title are explicit; and
- an active status ID can be selected from `get_reference_data`.

If a dedicated idempotent match or email-upsert tool is exposed by a newer
Application Tracker server, prefer it after inspecting its live schema and
description. Do not assume an undocumented input shape.

### 7. Write conservatively

For creation:

- use the active status ID matching the explicit evidence;
- use `Applied` only for clear submission or acknowledgement evidence;
- use `Prospect` for an opportunity the user explicitly asked to track;
- set `appliedOn` only when the application date is known;
- select `sourceId` from active reference data, normally `Job board` or
  `Recruiter`; and
- store the canonical posting URL in `sourceUrl` when available.

For updates:

- retrieve the full record immediately before writing;
- send only fields that genuinely change;
- never replace a newer status with an older email event;
- change status only when the email explicitly supports the transition; and
- preserve existing notes, contacts, links, source, and source URL unless the
  user explicitly requested a replacement.

`update_application` replaces `links` and `contacts` when either field is
present. To add a link or contact, merge it into the complete existing array
from `get_application` and submit the whole deduplicated array. Never submit
only the new item. The server accepts at most 10 links and 10 contacts; if the
appropriate array is full, report the constraint instead of discarding data.

Use these link labels, keeping each under 80 characters:

- `Job posting · <Provider> · <external-id>` when an ID is known;
- `Job posting · <Provider>` when only a canonical posting URL is known; and
- `Source email · YYYY-MM-DD` for the durable email web link.

Deduplicate links by canonical URL first, then by provider plus external ID.
Do not store the full email body, authentication links, unsubscribe links,
one-time codes, or tracking pixels. If no durable email URL exists, append a
short evidence line containing the stable message identifier and date to the
existing notes only when needed for traceability; never overwrite prior notes.

### 8. Handle uncertain write outcomes

`create_application` and `update_application` are not idempotent operations. If
a call times out or its outcome is unknown, repeat the complete read and match
steps before considering a retry. Never blindly repeat a creation.

### 9. Verify and report

After each successful mutation, call `get_application` and verify the intended
company, title, status, posting evidence, and source-email evidence. Report:

- matched, created, updated, skipped, ambiguous, and failed counts;
- the email subject or date and resulting application ID for every mutation;
- the matching level used;
- any evidence deliberately not stored; and
- any remaining ambiguity or read-only access blocker.

Never say an email was linked or an application was changed unless the MCP
write succeeded and the read-back confirms it.
