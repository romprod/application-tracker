# Application Tracker

Application Tracker is a self-hosted, local-first workspace for recording job
applications, documents, follow-up actions, and outcomes. It provides a web
interface and optional Model Context Protocol (MCP) integrations over local
stdio and authenticated HTTPS.

> This repository is being built in public-ready stages. The foundation is
> runnable, but it is not yet a feature-complete release.

## Product principles

- A fresh installation contains no sample or personal data.
- Installation never creates a known default password.
- Local accounts work without an external identity provider.
- Optional OpenID Connect integrates with standards-compliant providers.
- All application data belongs to an explicit workspace.
- Administrative settings require an administrator role.
- MCP clients receive the same validation and authorization as the website.
- Document parsing runs outside the HTTP event loop with strict resource limits.
- Public source contains no deployment identity, credentials, or private
  infrastructure details.

The product contract lives in
[`docs/product-contract.md`](docs/product-contract.md). The architecture and
security boundaries are documented before implementation so each feature can
be added in a small, testable commit.

## Planned capabilities

- Application pipeline, events, contacts, links, notes, and due actions
- Original document records with application associations and deduplication
- Resource-limited plain-text previews and bounded email-link extraction
- Configurable statuses, sources, role types, and document types
- Local users with administrator and member roles
- Administrator-managed external identity linking for remote MCP
- Optional OpenID Connect browser login
- Settings sections for Lists, Users, and MCP status
- Local and remote MCP tools with explicit actor context, administrator-gated
  writes, and audit events
- Online SQLite backup, verified restore, and migration tooling

## Repository status

Development standards are defined in
[`docs/development.md`](docs/development.md). Feature parity is tracked in
[`docs/parity-checklist.md`](docs/parity-checklist.md).

The current foundation includes a typed configuration boundary, a sanitized
health endpoint, a responsive application shell, a migration-backed workspace
identity schema, closed administrator setup, local browser login and logout,
revocable sessions, administrator-managed local users, a Settings shell,
an administrator-only sanitized MCP status page, and a workspace-scoped
application workspace. The responsive interface includes a metrics dashboard,
searchable and sortable application table, modal intake and editing, a detail
drawer, ordered recruiter and hiring contacts, labeled related links, current
next actions with optional due dates, and an immutable timeline for creation
and stage changes. Application removal is workspace-scoped and audited without
erasing that timeline. Workspace administrators can configure statuses,
sources, role types, and document types. A document library stores exact
originals, deduplicates their bytes by SHA-256, links them to applications, and
serves authorized attachment downloads. It generates cached plain-text
previews for five explicitly supported media types in isolated worker threads,
coalesces duplicate work, and applies process-wide worker admission. Cumulative
workspace and installation quotas bound document bytes and record counts.
Application editors can extract likely job links from bounded pasted email
content or a local `.eml` file, review the candidates, and add selected links;
the server does not store the email body. Operator commands provide online
SQLite backup, verification, and non-overwriting restore. API failures use
stable error codes and server-generated request IDs; structured runtime logs
redact credentials, content, identity, and private topology. A local stdio MCP
server exposes five read tools and three application mutation tools through an
explicit actor and workspace binding. Fresh workspaces block mutations until an
administrator enables read-write access in Settings → MCP. Every tool outcome
is recorded in an immutable audit ledger, and successful mutations commit with
their audit event in one transaction. An optional Streamable HTTP endpoint
exposes the same tools over HTTPS. It
validates OAuth tokens, maps external identities to active local memberships,
binds each session to its actor and workspace, and enforces network, session,
request-size, concurrency, and rate limits. The endpoint stays absent until the
operator supplies every remote and OAuth setting, accepts only size-limited
`application/json`, and rejects JSON-RPC batches before tool dispatch.
Administrators link an exact
provider subject to an existing local user from Settings → Users; removing the
link immediately prevents that identity from resolving for new remote requests.
The app does not yet provide OpenID Connect browser login.
Automated tests and CI cover each completed boundary.

## Run the foundation

Application Tracker requires Node.js 22.12 or newer.

```sh
cp .env.example .env
npm ci
npm run dev
```

Open `http://<server-ip>:5173` from another device, replacing `<server-ip>` with
an address assigned to the host. Both development services listen on all
interfaces; Vite forwards API requests to the backend on port 3333. A new
database opens the documented
[`closed first-run setup`](docs/initial-setup.md) before exposing the application
login screen. The installation does not create an `admin/admin` account or any
other default credentials.

To exercise the production build locally:

```sh
npm run build
NODE_ENV=production npm start
```

Run every local quality gate with `npm run check`.

Database operators should follow the tested
[`backup and restore runbook`](docs/backup-restore.md); copying a live WAL
database file is not a valid backup procedure.

Document operators should review the
[storage and upload policy](docs/documents.md).

Local MCP clients should follow the [stdio configuration guide](docs/local-mcp.md).
Remote operators should start with the
[authenticated HTTPS guide](docs/remote-mcp.md).

## License

Application Tracker is source-available under the [Elastic License 2.0](LICENSE).
You may use, modify, and redistribute it, but you may not provide the software
to third parties as a hosted or managed service that exposes a substantial set
of its features.
