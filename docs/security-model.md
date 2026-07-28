# Security model

## Assets

- Application records, notes, contacts, events, due actions, posting identities,
  and bounded source-email evidence
- Uploaded CVs, cover letters, and email files
- Local password verifiers, sessions, setup tokens, MCP bearer tokens, and OAuth
  tokens
- Optional Microsoft Graph tenant, client, and mailbox configuration and the
  short-lived app-only access tokens obtained at runtime
- Workspace membership and administrative settings
- SQLite integrity, backups, and migration state
- MCP availability, actor identity, tool authority, and audit events

## Trust boundaries

- Browser to HTTP server through session, CSRF, origin, and authorization checks
- Remote MCP client to bearer verification, protocol validation, and tool policy
- Local MCP process to operating-system identity and explicit actor configuration
- HTTP and MCP adapters to shared application use cases
- Application use cases to workspace-scoped repositories and SQLite transactions
- Optional Outlook synchronization to Microsoft identity and Graph over HTTPS
- Uploaded bytes to content storage and isolated document parsers
- Runtime environment to typed configuration and secret handling
- Private operator configuration to public source and release artifacts

## Required controls

### Authentication and sessions

- No default password or open first-user race
- Memory-hard, versioned password verification parameters
- High-entropy one-time setup token and transactional first-user closure
- Fail-fast login-verification concurrency and bounded attempt-rate admission
- Random session tokens stored only as hashes
- Secure, HTTP-only, same-site cookies with idle and absolute expiry
- Session rotation after authentication and privilege changes
- CSRF protection on state-changing browser requests
- Administrative session revocation and account disablement

### Authorization

- Workspace membership checked inside each application use case
- Administrator role checked for users, identity, MCP, and settings operations
- Object lookup includes workspace scope instead of checking ownership afterward
- MCP actor context cannot be selected through tool arguments
- Audit events record actor, action, target type, result, and timestamp without
  recording secrets or document content
- Application removal records its workspace, actor, and timestamp without
  deleting immutable stage history
- Contact and related-link rows inherit application workspace scope through
  composite foreign keys; relation writes share the parent transaction

### Local MCP

- Stdio opens no network listener and runs only as a client-spawned child process
- Private configuration selects one username and one workspace slug
- Tool schemas contain no actor or workspace selector
- Every tool call rechecks active account status and workspace membership
- Seventeen read-only tools and fourteen mutation-capable tools are bounded; new
  connections block all mutations by default
- Job-link resolution requests only exact allowlisted tracking hosts, while
  posting inspection accepts only provider-registry-recognized canonical URLs;
  both use HTTPS-only credential-free requests, public DNS validation and
  address pinning, bounded redirects, response sizes, timeouts, and outbound
  concurrency
- Local stdio permissions are fixed per process by `MCP_LOCAL_ACCESS_MODE`
- Every mutation rechecks the connection-bound policy
- Deletion requires explicit tool confirmation and uses the ledger's audited
  soft-delete path
- Every accepted tool invocation records an append-only outcome event; audit
  storage failure prevents the tool from returning workspace data
- Successful mutations and their audit events share one immediate transaction,
  so an audit failure rolls the application change back
- Stdout carries JSON-RPC only; redacted lifecycle diagnostics use stderr

### Microsoft Graph and Outlook

- Disabled by default with strict all-or-nothing runtime configuration
- Dedicated Entra application with `Mail.Read` application permission only
- External Exchange Application RBAC or application access policy restricts
  the service principal to the configured mailbox
- Client credentials remain only in the protected runtime environment; access
  tokens are held in memory and are never stored in SQLite
- Requests are limited to `https://graph.microsoft.com/v1.0`, use app-only
  tokens, immutable item IDs, credential-free redirects, fixed timeouts,
  bounded retries, capped concurrency, and fixed response-size limits
- Folder traversal begins at the well-known Inbox and follows only the
  configured bounded child path
- Existing evidence validation uses the stable RFC Message-ID and received
  timestamp; Outlook item IDs are retrieval handles only
- Search retains at most 20 candidates and full content for at most five
  shortlisted messages
- Deterministic, versioned scoring requires a transactional classification, a
  strong identity anchor, no ambiguity or cross-application conflict, and the
  configured confidence threshold
- Graph reads complete outside SQLite transactions; the evidence link,
  read-back verification, and successful MCP audit row commit atomically
- Mailbox state is never changed, and SQLite never stores Graph tokens,
  credentials, subjects, senders, headers, previews, or message bodies
- Graph response bodies and credential details never enter structured logs;
  callers receive stable operational error codes

The application-level `Mail.Read` grant is tenant-wide until Exchange resource
scoping is applied. Operators must test the mailbox restriction before enabling
the feature. See [`outlook-email-sync.md`](outlook-email-sync.md).

### Remote MCP

- High-entropy native bearer secrets stored only as SHA-256 hashes
- Administrator-controlled client creation, actor binding, rotation, and
  revocation, with an independent permission on every credential
- Built-in OAuth authorization with local password authentication and explicit
  user consent for that grant's read-only or read-and-write permission
- Public PKCE clients, strict redirect allowlisting, exact resource binding,
  short-lived authorization codes, and rotating refresh-token families
- OAuth authorization codes, access tokens, and refresh tokens stored only as
  SHA-256 hashes
- Exact credential, actor, and workspace binding for every session
- Signature algorithm, issuer, audience, expiry, scope, and subject verification
  when the optional external verifier is configured
- Configurable group or claim policy mapped to a local membership
- Host and origin allowlists
- Per-actor and global session limits
- Idle timeout, absolute lifetime, explicit close, and shutdown cleanup
- Request size, concurrency, and rate limits
- One size-limited `application/json` parser and single-message JSON-RPC policy
- Sanitized status that omits tokens, subjects, hostnames, and internal errors

The built-in authorization server is installed with the remote MCP endpoint. It
uses the website's local login controls, requires consent, dynamically registers
only trusted public redirect URIs, and stores only hashes of issued credentials.
An optional external verifier can also validate signed JWT access tokens against
a configured HTTPS JWKS with a fixed algorithm, issuer, audience, expiry,
subject, and exact scope. It maps the verified issuer-subject pair through
`external_identities` to an active local user and fixed workspace membership.
External configuration is all-or-nothing, and the JWKS URL must share the
issuer's origin. The verifier does not log or store tokens.

The remote adapter exposes one authenticated Streamable HTTP route after all
network settings pass startup validation. It checks the Host and optional
Origin, verifies a native bearer token, built-in OAuth token, or optional
external OAuth token, resolves an active local membership, and then admits a
session. The remote endpoint always publishes OAuth discovery metadata.
Initializing reservations consume capacity before asynchronous setup begins.
The request boundary caps JSON size, global concurrent work, and requests per
resolved actor. It rejects unsupported media types and JSON-RPC batches before
protocol dispatch so envelope accounting and tool accounting cannot diverge.
Sessions use idle and absolute expiry and remain bound to their original
credential, actor, and workspace.

The administrator-only MCP status endpoint reports protocol readiness, remote
registry counts, and policy values. It never reports addresses, identity
claims, secret material, database paths, or internal errors. See
[`mcp-status.md`](mcp-status.md).

### Documents

- Session and workspace authorization for metadata and original bytes
- Same-host origin checks before multipart parsing
- One bounded file, bounded metadata fields, and a configurable size limit
- Transactional workspace and installation byte and document-count quotas
- Server-calculated SHA-256 digests and transactional deduplication
- Attachment-only downloads with sandbox and `nosniff` headers
- Signature-checked, authenticated PDF-only inline route
- Original download independent from preview support
- Exact allowlist of text, PDF, DOCX, MSG, and EML preview media types
- Preview input, decoded-content, output, memory, and wall-clock limits
- Same-key preview coalescing and process-wide process admission
- Preview parsing in disposable child processes outside the HTTP event loop
- Parser-versioned, workspace-scoped text and email preview cache
- Bounded, no-network email-link extraction with explicit user selection
- Dedicated tracking-link resolution and structured posting inspection instead
  of agent-controlled arbitrary URL browsing
- Workspace-unique posting IDs, canonical URLs, and email Message-IDs without
  persisted email subjects, senders, or bodies

The preview process decodes an exact allowlist. It rejects binary-looking text,
limits selected DOCX expansion, validates MSG container allocation before
parsing, and returns text that the browser renders without HTML interpretation.
HTML-only email is reduced to inert text. The supervisor terminates the process
on completion, invalid output, runtime failure, or timeout. PDF parsing, legacy
Office formats, arbitrary archive traversal, active HTML, embedded objects, and
attachment parsing remain outside this boundary.

### Data and operations

- Parameterized SQL and allowlisted dynamic identifiers
- Foreign keys, constraints, transactions, and migration checks
- Owner-only database, backup, and secret permissions
- Online backups with integrity verification and documented restore testing
- Stable API error codes and server-generated request correlation identifiers
- Structured runtime logs that omit content, credentials, identity, and topology
- Dependency lockfile, automated audit, and reproducible production build
- Release scanner for credentials, databases, private paths, and infrastructure

## Security posture

The server binds to all interfaces by default for LAN and container access. The
host firewall must limit who can reach it. Internet exposure requires a
supported authentication mode and HTTPS at a trusted reverse proxy. The Vite
development server must never be used as the public reverse proxy. A deployment
with missing security-sensitive configuration fails closed rather than falling
back to an unauthenticated public service.
