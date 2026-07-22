# Application Tracker

Application Tracker is a self-hosted workspace for recording job applications,
documents, follow-up actions, contacts, and outcomes. It combines a responsive
web interface with optional local and authenticated remote Model Context
Protocol (MCP) access.

The application stores its data in SQLite and sends no workspace content to a
hosted service. A fresh installation contains no account, sample data, or
default password.

## Features

- Dashboard metrics, searchable applications, sortable tables, detail drawers,
  modal editing, contacts, links, due actions, and immutable history
- Configurable statuses, sources, role types, and document types
- Local administrator and member accounts with revocable sessions
- Original document storage, SHA-256 deduplication, application associations,
  inline PDF viewing, bounded DOCX and email previews, and safe downloads
- Bounded email-link extraction without server-side network requests or stored
  email bodies
- Local stdio MCP and authenticated Streamable HTTP MCP with bounded application
  and document transfer, explicit actor binding, website-controlled write
  access, and immutable audit events
- Built-in remote MCP OAuth using local accounts, plus administrator-managed
  client IDs and one-time bearer tokens and optional external token verification
- Online SQLite backup, verification, non-overwriting restore, and forward
  migrations

Application Tracker does not yet provide OpenID Connect browser login. Local
password login always remains available.

## Security model

- First-run setup requires an operator-generated one-time token.
- The project never creates `admin/admin` or another known credential.
- Passwords use salted, memory-hard scrypt hashes; random session and MCP tokens
  are stored only as hashes.
- Every application, document, user, and MCP operation preserves workspace and
  role checks in shared application services.
- Runtime secrets, databases, backups, and machine configuration remain outside
  Git and container images.

Read the [product contract](docs/product-contract.md),
[architecture](docs/architecture.md), and [security model](docs/security-model.md)
for the complete boundary.

## Requirements

- Node.js 22.12 or newer for a direct installation
- Docker Engine with the Compose plugin for a container installation
- A trusted HTTPS reverse proxy for Internet access

## Quick start for development

```sh
cp .env.example .env
npm ci
npm run dev
```

Open `http://<server-ip>:5173`, replacing `<server-ip>` with an address assigned
to the host. The development server and backend listen on all interfaces for
LAN and container access. Restrict both ports with the host firewall, and never
use Vite as a public reverse proxy.

Generate a setup token with `openssl rand -hex 32`, place it in `.env`, and
follow the [initial administrator setup](docs/initial-setup.md). Remove the token
and restart the service after setup succeeds.

Run every local quality gate with:

```sh
npm run check
```

## Deploy

Choose one supported path:

- [Run the compiled service directly on a Linux host](docs/local-deployment.md)
- [Build and run the hardened Docker Compose example](docs/container-deployment.md)

Both guides keep data and secrets outside the checkout. The container example
publishes port 3333 on loopback by default; LAN exposure requires an explicit
override. Internet exposure requires HTTPS at a trusted reverse proxy.

Before upgrades, create an online backup and follow the
[backup and restore runbook](docs/backup-restore.md). Copying a live WAL database
file is not a valid backup.

## MCP

Local clients should follow the [stdio guide](docs/local-mcp.md). Remote clients
should follow the [authenticated HTTPS guide](docs/remote-mcp.md).

Settings → MCP provides copyable templates for Claude.ai, remote Codex, local
Codex, and Claude Desktop. Remote interactive clients use the built-in OAuth
flow and the same local username and password as the website; no Authentik or
other external identity provider is required.

Fresh workspaces are read-only through MCP. An administrator can enable
**Read and write** under **Settings → MCP**. The server rechecks this policy on
every mutation, including calls made through existing sessions.

### Job-email agent skill

The repository includes the installable
[Application Tracker Job Email](.agents/skills/application-tracker-job-email/SKILL.md)
skill. It teaches compatible AI clients how to reconcile messages from an
Outlook Jobs folder with Application Tracker through the server's deterministic
match and idempotent email-upsert tools, while stopping when evidence is
ambiguous or conflicting.

This deployment uses the hosted Microsoft 365 MCP server at
`https://ms365-mcp.example.com/mcp` for mailbox reads. The workflow requires its
stable `internetMessageId`, attachment metadata, and bounded download tools.
The Outlook Email plugin is not the default connector for reconciliation, and
agents must not install or launch a local M365 server as a fallback.

Codex discovers the skill from `.agents/skills` while working in this checkout.
Other clients that support `SKILL.md` skills can install the
`.agents/skills/application-tracker-job-email` directory using their normal
skill installation flow. Connect both the Application Tracker MCP server and
the hosted `ms365` server before invoking `$application-tracker-job-email`.

## Documentation

- [Development standards](docs/development.md)
- [Database and migrations](docs/database.md)
- [Documents and previews](docs/documents.md)
- [Reference lists](docs/reference-lists.md)
- [User management](docs/user-management.md)
- [MCP status](docs/mcp-status.md)
- [MCP data transfer](docs/mcp-data-transfer.md)
- [Capability checklist](docs/parity-checklist.md)

## Contributing and security

Contributions are welcome through pull requests. Read
[the contribution guide](.github/CONTRIBUTING.md) before submitting code.
Report suspected vulnerabilities through the private process in the
[security policy](.github/SECURITY.md), not a public issue.

## License

Application Tracker is source-available under the [Elastic License 2.0](LICENSE).
You may use, modify, and redistribute it, but you may not provide the software
to third parties as a hosted or managed service that exposes a substantial set
of its features.
