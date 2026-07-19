# Capability checklist

This checklist defines the minimum public release. Each checked item must have
tests and user documentation.

## Foundation

- [x] TypeScript toolchain, formatting, linting, tests, and CI
- [x] Typed runtime configuration with safe local defaults
- [x] Versioned SQLite migrations, online backup, and verified restore
- [x] Structured error handling and redacted logging

## Identity and administration

- [x] Closed first-run setup with one-time administrator creation
- [x] Local login, logout, session rotation, expiry, and revocation
- [x] Administrator and member workspace roles
- [ ] Optional OpenID Connect login and identity linking
- [x] Settings navigation with Lists, Users, and MCP sections

## Application tracking

- [x] Workspace-scoped application creation and chronological listing
- [x] Application field updates
- [x] Audited application deletion
- [x] Application search, filtering, and sorting controls
- [x] Creation and status transition timeline events
- [x] Current next action and optional due date
- [x] Contacts and additional links
- [x] Dashboard metrics scoped to the active workspace
- [x] Configurable statuses, sources, role types, and document types

## Documents

- [ ] Content-addressed storage and deduplication
- [ ] Document metadata and application associations
- [ ] Original upload and download with authorization
- [ ] Resource-limited preview workers for explicitly supported formats
- [ ] Safe email-link extraction from bounded input

## MCP

- [x] Local stdio server with explicit workspace and actor context
- [ ] Remote HTTPS server with strict OAuth verification
- [x] Strict OAuth token verification and local membership mapping prerequisite
- [x] Read-only tool schemas, per-call authorization, and audit events
- [ ] Mutating tool approval, transactions, and rollback tests
- [x] Global and per-actor session limits, expiry, and cleanup
- [x] Administrator-only sanitized MCP status

## Release

- [x] Responsive and keyboard-accessible interface
- [ ] Complete local and container deployment documentation
- [ ] Database migration and rollback rehearsal
- [ ] Dependency, security, and public-content audits
- [ ] No credentials, private topology, personal data, or private Git objects
