# Capability checklist

This checklist defines the minimum public release. Each checked item must have
tests and user documentation.

## Foundation

- [x] TypeScript toolchain, formatting, linting, tests, and CI
- [x] Typed runtime configuration with safe local defaults
- [ ] Versioned SQLite migrations, online backup, and verified restore
- [ ] Structured error handling and redacted logging

## Identity and administration

- [x] Closed first-run setup with one-time administrator creation
- [ ] Local login, logout, session rotation, expiry, and revocation
- [ ] Administrator and member workspace roles
- [ ] Optional OpenID Connect login and identity linking
- [ ] Settings navigation with Lists, Users, and MCP sections

## Application tracking

- [ ] Application create, read, update, delete, search, and sorting
- [ ] Status transitions, timeline events, contacts, links, and next actions
- [ ] Dashboard metrics scoped to the active workspace
- [ ] Configurable statuses, sources, role types, and document types

## Documents

- [ ] Content-addressed storage and deduplication
- [ ] Document metadata and application associations
- [ ] Original upload and download with authorization
- [ ] Resource-limited preview workers for explicitly supported formats
- [ ] Safe email-link extraction from bounded input

## MCP

- [ ] Local stdio server with explicit workspace and actor context
- [ ] Remote HTTPS server with strict OAuth verification
- [ ] Tool schemas, authorization, transactions, and audit events
- [ ] Global and per-actor session limits, expiry, and cleanup
- [ ] Administrator-only sanitized MCP status

## Release

- [ ] Responsive and keyboard-accessible interface
- [ ] Complete local and container deployment documentation
- [ ] Database migration and rollback rehearsal
- [ ] Dependency, security, and public-content audits
- [ ] No credentials, private topology, personal data, or private Git objects
