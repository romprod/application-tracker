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
3. Restrict the service principal to the one configured mailbox with
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

## Runtime configuration

Set all values together in the service's private environment:

```dotenv
OUTLOOK_EMAIL_SYNC_ENABLED=true
MICROSOFT_GRAPH_TENANT_ID=<tenant UUID>
MICROSOFT_GRAPH_CLIENT_ID=<application UUID>
MICROSOFT_GRAPH_CLIENT_SECRET=<client secret>
OUTLOOK_EMAIL_SYNC_MAILBOX=jobs@example.com
OUTLOOK_EMAIL_SYNC_FOLDER_PATH=Inbox\Jobs
```

`OUTLOOK_EMAIL_SYNC_FOLDER_PATH` must start at Inbox and contain between two and
five bounded path segments. `Inbox\Jobs` is the default. Startup rejects a
partial configuration and also rejects Graph credentials while the feature is
disabled, preventing an accidental half-enabled deployment.

The same settings apply to the web-hosted remote MCP server and to a local stdio
process. For stdio, put them in the private MCP process environment. For the web
service, put them in its runtime secret store or protected `.env`, then restart
the process.

## MCP behavior

The tool is discoverable even when the integration is disabled so the MCP
schema remains stable. It requires the connection's `read_write` permission
because a successful match may create evidence. For this one-application path:

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

Stable operational errors include:

| Code                                  | Meaning                                        |
| ------------------------------------- | ---------------------------------------------- |
| `outlook_email_sync_unavailable`      | Integration is disabled or unconfigured        |
| `outlook_folder_not_found`            | Configured child folder cannot be resolved     |
| `outlook_mailbox_unavailable`         | Configured mailbox cannot be resolved          |
| `outlook_graph_authentication_failed` | Tenant, client, or secret was rejected         |
| `outlook_graph_forbidden`             | Graph or Exchange policy denied mail access    |
| `outlook_graph_throttled`             | Bounded Graph retries exhausted after `429`    |
| `outlook_graph_unavailable`           | Graph/network response was invalid or failed   |
| `outlook_existing_evidence_limit`     | Application exceeds the validation bound       |
| `outlook_email_verification_failed`   | Stored evidence failed transactional read-back |

`application_not_found`, `application_conflict`, `write_access_disabled`, and
`actor_unavailable` retain their normal MCP meanings.

## Data and logging boundary

SQLite stores only the established bounded evidence fields: RFC Message-ID,
received time, optional Outlook web URL, and persistence timestamps. The server
does not store Graph access tokens, tenant or client secrets, message subjects,
senders, headers, previews, or bodies. Candidate subject and sender values exist
only in the tool result for the authorized invocation.

Graph response bodies and credential failures are converted to stable error
codes rather than logged. Requests use only `https://graph.microsoft.com/v1.0`,
immutable Outlook item IDs, fixed response-size limits, fixed timeouts, capped
concurrency, and bounded retries. Successful evidence storage and its audit row
share one SQLite transaction; either both commit or neither does.
