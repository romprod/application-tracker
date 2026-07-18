# Security model

## Assets

- Application records, notes, contacts, events, and due actions
- Uploaded CVs, cover letters, and email files
- Local password verifiers, sessions, setup tokens, and OAuth tokens
- Workspace membership and administrative settings
- SQLite integrity, backups, and migration state
- MCP availability, actor identity, tool authority, and audit events

## Trust boundaries

- Browser to HTTP server through session, CSRF, origin, and authorization checks
- Remote MCP client to OAuth verification, protocol validation, and tool policy
- Local MCP process to operating-system identity and explicit actor configuration
- HTTP and MCP adapters to shared application use cases
- Application use cases to workspace-scoped repositories and SQLite transactions
- Uploaded bytes to content storage and isolated document parsers
- Runtime environment to typed configuration and secret handling
- Private operator configuration to public source and release artifacts

## Required controls

### Authentication and sessions

- No default password or open first-user race
- Memory-hard, versioned password verification parameters
- Rate limits for setup and login attempts
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

### Remote MCP

- Signature algorithm, issuer, audience, expiry, scope, and subject verification
- Configurable group or claim policy mapped to a local membership
- Host and origin allowlists
- Per-actor and global session limits
- Idle timeout, absolute lifetime, explicit close, and shutdown cleanup
- Request size, concurrency, and rate limits
- Sanitized status that omits tokens, subjects, hostnames, and internal errors

The administrator-only MCP status endpoint implements this disclosure boundary
before either MCP transport exists. It reports protocol readiness, counts, and
policy values. It never reports addresses, identity claims, secret material,
database paths, or internal errors. See [`mcp-status.md`](mcp-status.md).

### Documents

- Input and decoded-output size limits
- Archive entry, nesting, and compression-ratio limits
- Cycle-aware compound-file traversal
- Parser execution outside the HTTP event loop
- Wall-clock and memory budgets with worker termination
- Plain-text and HTML output limits with safe HTML handling
- Original download remains independent from preview support

### Data and operations

- Parameterized SQL and allowlisted dynamic identifiers
- Foreign keys, constraints, transactions, and migration checks
- Owner-only database, backup, and secret permissions
- Online backups with integrity verification and documented restore testing
- Dependency lockfile, automated audit, and reproducible production build
- Release scanner for credentials, databases, private paths, and infrastructure

## Security posture

The server binds to all interfaces by default for LAN and container access. The
host firewall must limit who can reach it. Internet exposure requires a
supported authentication mode and HTTPS at a trusted reverse proxy. The Vite
development server must never be used as the public reverse proxy. A deployment
with missing security-sensitive configuration fails closed rather than falling
back to an unauthenticated public service.
