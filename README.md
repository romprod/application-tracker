# Application Tracker

Application Tracker is a self-hosted, local-first workspace for recording job
applications, documents, follow-up actions, and outcomes. It will provide a web
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
- Untrusted document parsing runs behind strict resource limits.
- Public source contains no deployment identity, credentials, or private
  infrastructure details.

The product contract lives in
[`docs/product-contract.md`](docs/product-contract.md). The architecture and
security boundaries are documented before implementation so each feature can
be added in a small, testable commit.

## Planned capabilities

- Application pipeline, events, contacts, links, notes, and due actions
- Versioned CV and cover-letter records with application associations
- Configurable statuses, sources, role types, and document types
- Local users with administrator and member roles
- Optional OpenID Connect login and account linking
- Settings sections for Lists, Users, and MCP status
- Local and remote MCP tools with explicit actor context and audit events
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
application intake and ledger. It supports application creation and listing but
does not yet support editing, deletion, search, history, actions, or outcomes.
It also does not run an MCP server. Automated tests and CI cover each completed
boundary.

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

## License

Application Tracker is source-available under the [Elastic License 2.0](LICENSE).
You may use, modify, and redistribute it, but you may not provide the software
to third parties as a hosted or managed service that exposes a substantial set
of its features.
