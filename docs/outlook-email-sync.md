# Server-side Outlook email evidence sync

Application Tracker can locate, verify, and link Outlook email evidence for one
existing application through a single MCP call:

```json
{
  "name": "sync_outlook_email_evidence",
  "arguments": {
    "applicationId": "11111111-1111-4111-8111-111111111111"
  }
}
```

The MCP client does not call a separate Outlook or Microsoft 365 connector for
this workflow. The Application Tracker server:

1. reads the application and its existing evidence;
2. validates up to 20 stored RFC Message-IDs through Microsoft Graph;
3. resolves the configured folder below Inbox;
4. runs at most two searches and retains at most 20 candidates;
5. retrieves full content and metadata for at most five messages;
6. classifies and scores each message with the versioned deterministic policy;
7. links only one unambiguous candidate at or above the confidence threshold;
8. re-reads the application and evidence; and
9. commits the evidence link and successful MCP audit event atomically.

All Graph work completes before the SQLite transaction begins. The integration
is read-only from Outlook's perspective: it does not mark mail read, move,
categorize, send, or delete messages.

## Microsoft configuration

Create a dedicated Microsoft Entra application for Application Tracker. The
runtime currently supports a client secret and app-only client-credential
authentication.

1. Add the Microsoft Graph **application** permission `Mail.Read`.
2. Grant tenant administrator consent.
3. Restrict each service principal to its configured mailbox with
   [Exchange Online Application RBAC](https://learn.microsoft.com/exchange/permissions-exo/application-rbac),
   which is Microsoft's preferred resource-scoping mechanism.
4. If the tenant still uses application access policies, apply a restrictive
   mailbox policy and verify it with
   [`Test-ApplicationAccessPolicy`](https://learn.microsoft.com/powershell/module/exchange/test-applicationaccesspolicy).
5. Confirm that the mailbox contains the configured `Inbox\Jobs` folder.

Graph's `Mail.Read` application permission is tenant-wide until Exchange
resource scoping is applied. Do not enable the integration before the mailbox
restriction has been tested. Use a dedicated application registration, rotate
its secret under the operator's normal schedule, and remove old credentials
after cutover.

## Web-managed connections

Generate one installation-level encryption key and add it to the server's
private runtime environment:

```dotenv
OUTLOOK_CONNECTION_ENCRYPTION_KEY=<64 lowercase or uppercase hexadecimal characters>
```

Generate it with `openssl rand -hex 32`. This key is not a Microsoft credential:
it encrypts workspace connection secrets at rest. Keep it in the deployment
secret store, back it up separately from SQLite, and do not change it while
saved connections exist. If it is lost, an administrator must delete and
recreate each connection with a new client secret.

After restarting the server, an administrator opens **Settings →
Connections**. The page links to Entra app registrations, the Graph `Mail.Read`
permission reference, the Exchange admin centre, and Application RBAC guidance.
For each named connection, the administrator enters a tenant ID, application
ID, client secret, mailbox, and Inbox child-folder path. **Test and connect**
checks the token, mailbox, and folder before saving. The server never returns
the secret to the browser.

The same screen supports:

- **Add connection**, which creates another independently enabled mailbox
  route;
- **Test connection**, which verifies the saved configuration without changing
  its enabled state;
- **Edit details**, which retains the encrypted secret when tenant and
  application IDs are unchanged;
- **Disable**, which pauses synchronization for assigned applications but
  retains the encrypted configuration and assignments;
- **Enable**, which performs a successful live verification first; and
- two-step **Delete**, which shows the assigned-application count before it
  permanently removes the connection and secret ciphertext.

Hard deletion preserves applications and existing email evidence. It clears
each affected application's Graph assignment, so those records cannot
synchronize again until a user selects another connection. Existing backup
artifacts can still contain the old encrypted ciphertext and remain subject to
the normal backup retention policy.

The folder path must start at Inbox and contain between two and five bounded
path segments. `Inbox\Jobs` is the default. Administrators can manage only
their workspace's connections.

Each opportunity and application has a nullable Graph origin. Records created
from Graph-backed email processing must store the connection they came from.
Users must assign existing or manually created records explicitly before
synchronizing them. The application editor lists safe connection names,
mailboxes, and enabled states; it never receives tenant IDs, application IDs,
or secrets through that options endpoint.

The web-hosted and local stdio MCP servers resolve the application's assigned
connection for every call. A local stdio process must use the same SQLite
database and receive the same `OUTLOOK_CONNECTION_ENCRYPTION_KEY` in its private
process environment.

Each connection also stores a nullable `lastReconciledAt` cursor. It is
separate from connection verification: `verifiedAt` and `lastTestedAt`
describe credential and route checks, while `lastReconciledAt` means every
bounded message through that instant was processed successfully. Settings
displays it as **Last reconciled**. Changing the tenant, application, mailbox,
or folder resets the cursor; renaming the connection or rotating its secret
for the same route preserves it.

## MCP behavior

Once secure web storage is configured at the server, the tool remains
discoverable when an application is unassigned or its connection is disabled,
so the MCP schema remains stable. It requires the MCP connection's `read_write`
permission because a successful match may create evidence. For this
one-application path:

- call only `sync_outlook_email_evidence` with the known application ID;
- do not call `get_tracker_context` or `get_application` as preflight or
  verification;
- do not invoke a separate MS365 or Outlook MCP; and
- do not fall back to client-side matching after a no-match or error result.

The result reports the scoring version and threshold, bounded candidate
assessments, existing-evidence validation, link outcome, application read-back,
and exact stored Message-ID verification. A valid existing evidence row yields
`already_linked`; the bounded folder search and scoring still run, but no second
evidence row is added.

For an incremental connection-wide pass, call only
`reconcile_outlook_graph_connection` with `connection` set to the exact
connection ID, name, or mailbox:

```json
{ "connection": "russ@sargeson.co.uk" }
```

The first run starts at the connection's creation time. Later runs start after
the last successful cursor. The server reads at most 50 new messages, scores
them against applications assigned to that connection, links only unique
high-confidence Message-IDs, and stores the new cursor in the same transaction
as the evidence and MCP audit event. Ambiguous, conflicting, marketing, and
unmatched messages are reported without being linked. The mailbox remains
read-only.

For a bounded historical search before processing older digests, call
`search_outlook_job_digests` with the same exact connection selector, a fixed
`after` / `before` window no longer than 31 days, `offset: 0`, and a limit no
greater than 20. Follow `page.nextOffset` without changing the window. The
server scans at most 500 messages, classifies each message inside Application
Tracker, and returns bounded metadata and exact RFC Message-IDs without
returning bodies. It does not change mailbox, application, or evidence state,
or the reconciliation cursor. Only messages returned as
`marketing_or_digest` with a non-null Message-ID may be sent to
`process_outlook_job_digest`.

For one exact job-alert or digest message, call
`process_outlook_job_digest` with the same exact connection selector and the
RFC Message-ID:

```json
{
  "connection": "russ@sargeson.co.uk",
  "messageId": "<digest-message-id>",
  "offset": 0
}
```

This path accepts `read_only` or `read_write` connector access. The server
queries only the configured folder for that exact Message-ID, confirms that
exactly one message exists and classifies as `marketing_or_digest`, resolves up
to 20 canonical candidates, and inspects at most five candidates from the
requested offset. Each posting includes its deterministic tracker match. A
structured description is capped at 4,000 characters in this batch result and
reports `descriptionTruncated` when clipped. Follow `page.nextOffset` to inspect
another page. Each posting also reports `inspectionSource`. Provider JSON-LD is
preferred. If a provider challenge blocks inspection, the server may use
`digest_email` only when one bounded card explicitly and unambiguously pairs
the exact supported posting link, employer, and title. `digestFallback`
reports whether that fallback was attempted and a stable unavailable reason
when it failed. It returns no card or message body, and incomplete or ambiguous
cards remain unavailable.

Fallback reasons are `card_elements_exceeded`, `card_text_exceeded`,
`employer_ambiguous`, `employer_missing`, `matching_card_not_found`,
`multiple_posting_links`, `title_ambiguous`, and `title_missing`.

The outcomes are `processed`, `not_digest`, `not_found`, and `ambiguous`.
`verification.mailboxReadOnly` is always true and
`verification.messageBodyReturned` is always false. The tool does not advance
the reconciliation cursor, create evidence, or create or update an
application. It never marks, moves, categorizes, sends, or deletes mail.

Stable operational errors include:

| Code                                    | Meaning                                        |
| --------------------------------------- | ---------------------------------------------- |
| `outlook_graph_connection_unassigned`   | Application has no Graph origin                |
| `outlook_email_sync_unavailable`        | Assigned connection is disabled                |
| `outlook_folder_not_found`              | Configured child folder cannot be resolved     |
| `outlook_mailbox_unavailable`           | Configured mailbox cannot be resolved          |
| `outlook_graph_authentication_failed`   | Tenant, client, or secret was rejected         |
| `outlook_graph_forbidden`               | Graph or Exchange policy denied mail access    |
| `outlook_graph_throttled`               | Bounded Graph retries exhausted after `429`    |
| `outlook_graph_unavailable`             | Graph/network response was invalid or failed   |
| `outlook_graph_connection_not_found`    | No exact ID, name, or mailbox matched          |
| `outlook_graph_connection_ambiguous`    | Selector matched more than one connection      |
| `outlook_graph_reconciliation_conflict` | Connection or cursor changed during the run    |
| `outlook_reconcile_message_limit`       | More than 50 new messages were found           |
| `outlook_existing_evidence_limit`       | Application exceeds the validation bound       |
| `outlook_email_verification_failed`     | Stored evidence failed transactional read-back |

`application_not_found`, `application_conflict`, `write_access_disabled`, and
`actor_unavailable` retain their normal MCP meanings.

## Data and logging boundary

The evidence tables store only the established bounded evidence fields: RFC
Message-ID, received time, optional Outlook web URL, and persistence timestamps.
The connection table stores names, tenant and application IDs, mailboxes,
folders, lifecycle timestamps, the successful reconciliation cursor, enabled
state, and client secrets encrypted with AES-256-GCM. Additional authenticated
data binds each new ciphertext to its
workspace, connection, tenant, and application IDs. The encryption key remains
in the server environment. The server never stores Graph access tokens, message
subjects, senders, headers, previews, or bodies. The cursor is only an ISO
timestamp, never a Graph token or message identifier. Candidate subject and sender
values exist only in the tool result for the authorized invocation. Digest
processing returns bounded subject and sender metadata plus structured posting
data, but never returns or stores the source message body.

Graph response bodies and credential failures are converted to stable error
codes rather than logged. Requests use only `https://graph.microsoft.com/v1.0`,
immutable Outlook item IDs, fixed response-size limits, fixed timeouts, capped
concurrency, and bounded retries. Successful evidence storage and its audit row
share one SQLite transaction; either both commit or neither does.
