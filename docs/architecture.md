# Architecture

## Components

Application Tracker uses one TypeScript project with four explicit layers:

```text
src/
  client/       React interface and browser API client
  server/       HTTP, authentication, MCP, workers, and runtime entry points
  application/  Use cases, authorization, and transaction boundaries
  domain/       Schemas, entities, value objects, and domain errors
  infrastructure/
    database/   SQLite connection, migrations, and repositories
    documents/  Content storage and isolated preview adapters
```

The domain and application layers do not import Express, React, SQLite, or the
MCP SDK. HTTP and MCP adapters translate external input into the same use cases.
Repositories implement interfaces owned by the application layer.

## Runtime topology

```mermaid
flowchart LR
  Browser["Browser"] -->|"HTTPS + session"| HTTP["HTTP adapter"]
  RemoteMCP["Remote MCP client"] -->|"HTTPS + OAuth"| MCPHTTP["MCP HTTP adapter"]
  LocalMCP["Local MCP client"] -->|"stdio + operator config"| MCPStdio["MCP stdio adapter"]
  HTTP --> UseCases["Application use cases"]
  MCPHTTP --> UseCases
  MCPStdio --> UseCases
  UseCases --> Repositories["Repository interfaces"]
  Repositories --> SQLite[("SQLite")]
  UseCases --> PreviewQueue["Preview supervisor"]
  PreviewQueue --> Worker["Resource-limited parser worker"]
```

## Database contract

SQLite runs with foreign keys enabled, WAL mode, a busy timeout, and owner-only
file permissions. All migrations are ordered, transactional where SQLite
allows, and recorded in `schema_migrations`. Tests create a database from zero
and migrate representative prior schemas forward.

The implementation and migration policy are described in
[`database.md`](database.md).

Local password verification and session lifecycle are described in
[`authentication.md`](authentication.md).
Administrator account creation, roles, and disablement are described in
[`user-management.md`](user-management.md).
The sanitized MCP status boundary and future session policy are described in
[`mcp-status.md`](mcp-status.md).
The first application-record slice is described in
[`application-ledger.md`](application-ledger.md).

The schema separates:

- workspaces, users, credentials, memberships, sessions, and external identities
- applications, audited deletion state, and immutable creation or
  stage-transition events, with reference values planned in later migrations
- file objects, document metadata, and application-document associations
- administrative settings and security audit events

Every query that returns workspace data accepts a workspace identifier. Dynamic
sort fields use code-owned allowlists; values always use bound parameters.

## Configuration contract

Runtime configuration is parsed once at startup through a typed schema. Invalid
or incomplete production configuration stops startup with a concise error.
`.env.example` contains safe examples, while `.env` and machine-specific MCP
configuration remain ignored.

Configuration is grouped into server, database, session, setup, OIDC, MCP,
document processing, and proxy settings. Secret values never appear in health
responses or logs.

## Delivery contract

Each commit must preserve a buildable repository and add the narrowest tests
that prove its behavior. Database, API, UI, MCP, and deployment slices land as
separate commits. Public releases come from signed tags after CI, migration,
backup/restore, accessibility, and security checks pass.
