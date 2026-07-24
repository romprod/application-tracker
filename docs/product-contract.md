# Product contract

## Purpose

Application Tracker helps an individual or small team manage a shared job
application workspace. It records applications, actions, events, documents,
and configurable reference values without sending that data to a hosted
service.

## Installation and identity

A fresh installation starts in a closed setup state. Health and setup routes
remain available, but application data and administrative APIs stay closed
until the first administrator is created.

The installer supplies a high-entropy, one-time setup token. The setup flow
accepts that token once, creates the first local administrator, and permanently
invalidates the token. The project will never ship `admin/admin` or another
known default credential.

Local password authentication is always available. The built-in remote MCP
OAuth flow authenticates these local accounts directly and requires explicit
consent. An administrator may additionally link an external identity to an
existing user for remote MCP access. Optional OpenID Connect website login and
claim-based account creation remain separate future capabilities. External
identity configuration must never disable recovery through a deliberately
retained local administrator.

## Authorization model

Every domain record belongs to a workspace. Users access a workspace through a
membership with one of two initial roles:

- `admin`: manages users, authentication, reference lists, MCP configuration,
  backups, and all workspace data.
- `member`: reads and changes workspace application data but cannot administer
  identities or security-sensitive settings.

The first release supports one workspace per installation. The schema still
stores workspace ownership explicitly so authorization is enforced at every
HTTP, MCP, document, dashboard, and search boundary.

## Settings

Settings uses stable subsections:

- **Lists**: statuses, sources, role types, and document types.
- **Users**: local accounts, roles, sessions, external identities, and account
  disablement.
- **MCP**: enablement, sanitized health, session counts, limits, and recent
  audit events.

Only administrators may open or modify Users and MCP settings. Members may view
Lists but cannot change them.

## MCP contract

Local stdio MCP runs only when an operator starts it and receives an explicit
workspace and actor configuration. Remote MCP accepts either a named bearer
credential or a built-in OAuth grant bound to an active local workspace member.
Administrators create, rotate, revoke, regenerate, and delete bearer
credentials in Settings → MCP. Built-in OAuth uses public PKCE clients, local
login and consent, exact resource binding, rotating refresh tokens, and
hash-only token storage. Optional external OAuth tokens require issuer and
audience binding, the configured scope, and an authorized workspace membership.

MCP tools use the same application services, schemas, authorization checks,
and transactions as HTTP requests. MCP mutations are disabled by default and
can be enabled per connection by a workspace administrator. Application
deletion is a soft delete, is advertised as destructive, and requires explicit
confirmation in the tool input. A successful mutation and its audit event
commit atomically.

## Duplicate application contract

Duplicate audits are read-only, bounded, paginated, and explain every candidate
with deterministic evidence and a confidence band. A merge always names one
source and one surviving target. Preview changes nothing and exposes every
field decision, relationship addition, retained event, and item that cannot be
kept.

Apply requires explicit confirmation, both previewed record versions, and a
source-or-target choice for every unresolved field. The server does not infer a
"most advanced" status from labels. It consolidates relationships in one
transaction, records immutable lineage, preserves the source's immutable events
under their original application ID, and marks the source merged only after all
steps succeed. An exact retry returns the existing lineage without duplicating
relationships.

## Document contract

Original document bytes may be stored and downloaded. Preview support is a
separate capability. A format is previewable only when parsing runs outside the
web event loop with input, decoded-size, memory, and time limits. Unsupported or
unsafe formats remain available for download without server-side preview.

## Non-goals for the first release

- Hosted multi-tenant service operation
- Public user registration
- Email delivery or password-reset mail
- Background résumé scoring or automated hiring decisions
- MCP access that bypasses normal user and workspace authorization
