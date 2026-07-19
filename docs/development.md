# Development standards

## Local environment

Use Node.js 22.12 or newer. The repository contains `.nvmrc` and
`.node-version` files for compatible version managers.

```sh
cp .env.example .env
npm ci
npm run dev
```

The browser runs at `http://<server-ip>:5173`; Vite forwards `/api` requests to
the backend on port 3333. Both services bind to `0.0.0.0` so containers and
other devices on an allowed network can reach them. Use host firewall rules to
limit access. The Vite development server is not a production reverse proxy.

Useful commands:

| Command                                | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `npm run check`                        | Run formatting, lint, type, test, and build gates |
| `npm test`                             | Run the test suite once                           |
| `npm run test:watch`                   | Run tests while editing                           |
| `npm run build`                        | Compile the client and server                     |
| `npm run db:backup`                    | Create and verify an online SQLite backup         |
| `npm run db:verify`                    | Verify a standalone SQLite backup                 |
| `npm run db:restore`                   | Restore a backup into a new database path         |
| `node dist/server/server/mcp_stdio.js` | Start configured local MCP over stdio             |
| `NODE_ENV=production npm start`        | Serve a completed production build                |

The database commands and live replacement procedure are documented in
[`backup-restore.md`](backup-restore.md).
API error responses and the fields permitted in runtime logs are documented in
[`error-handling.md`](error-handling.md).
Build and client configuration for the local MCP process are documented in
[`local-mcp.md`](local-mcp.md).

## Commit discipline

Each commit represents one coherent change and leaves the repository buildable.
Use a short conventional subject such as `feat(auth): create local sessions` or
`test(db): cover workspace isolation`. Do not combine generated output,
refactoring, and product behavior in one commit.

## Test discipline

Write the failing test before implementing behavior. Test at the lowest layer
that proves the invariant, then add an adapter-level test for security or
integration boundaries.

The required quality gates will include:

- formatting and lint checks
- client and server type checks
- unit and component tests
- SQLite migration tests from an empty database and supported prior schemas
- API integration tests for authentication, authorization, validation, and CSRF
- MCP protocol tests for client credentials, OAuth, actors, limits, lifecycle,
  and tool policy
- production build and production dependency audit

Before a public release, also run browser acceptance tests, container checks,
backup and restore rehearsal, and complete reachable-history public-content
scanning. These release checks are broader than the pull-request CI workflow.

## Dependency discipline

Pin the runtime with an engines declaration and CI matrix. Commit the lockfile.
Prefer platform APIs and small dependencies. Record why a security-sensitive
dependency is required, especially parsers, authentication libraries, and
native modules.

## Configuration discipline

Commit `.env.example` with safe values and comments. Never commit `.env`, MCP
machine configuration, a database, backup, document fixture containing personal
data, credential, private hostname, or private address.

Use synthetic fixtures. Test email addresses use `example.com`; network examples
use reserved documentation domains and addresses.

## Review discipline

Review code against the product contract, architecture boundaries, and security
model. A passing test suite does not justify crossing a layer boundary or
weakening an authorization check.

## Deployment guides

Use [`local-deployment.md`](local-deployment.md) for a compiled Linux service or
[`container-deployment.md`](container-deployment.md) for Docker Compose. Both
paths use the production build and keep writable data outside the checkout.
