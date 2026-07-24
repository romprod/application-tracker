# Container deployment

Application Tracker includes a multi-stage Docker image and a Compose example.
The runtime image contains the compiled application and production
dependencies. It runs as the unprivileged `node` user and keeps the root
filesystem read-only.

## Requirements

- Docker Engine with the Compose plugin
- A checked-out Application Tracker release
- A trusted HTTPS reverse proxy for Internet access
- Protected storage for the database and backups

The Compose example uses named volumes. Do not bake `.env`, databases, backups,
or MCP client configuration into an image.

## Configure the service

Copy the public template and generate a one-time setup token:

```sh
cp .env.example .env
openssl rand -hex 32
```

Place the generated value in `SETUP_TOKEN`. Review the document, session, and
MCP limits before starting the container. Compose overrides the database and
backup paths with these persistent container paths:

```text
/app/data/application-tracker.sqlite
/app/backups
```

The example publishes the application on `127.0.0.1:3333`. This default suits a
reverse proxy running on the Docker host and avoids unintended LAN exposure.

## Build and start

```sh
docker compose -f deploy/compose.yml up --detach --build
docker compose -f deploy/compose.yml ps
```

The image health check calls `GET /api/health`. Inspect sanitized JSON logs with:

```sh
docker compose -f deploy/compose.yml logs --follow application-tracker
```

Open `http://127.0.0.1:3333` on the Docker host or use the configured HTTPS
reverse proxy. Complete the closed first-run flow described in
[`initial-setup.md`](initial-setup.md).

After creating the administrator, remove `SETUP_TOKEN` from `.env` and recreate
the container so the process no longer receives it:

```sh
docker compose -f deploy/compose.yml up --detach --force-recreate
```

## Network exposure

Keep the published port on loopback when a reverse proxy runs on the host. The
proxy must terminate HTTPS, preserve the public `Host` header, and pass requests
to `http://127.0.0.1:3333`. Set `SESSION_COOKIE_SECURE=true` before serving the
site over HTTPS. Set `HTTP_TRUST_PROXY_HOPS` to the exact number of proxies
between the client and Application Tracker only when the application has no
shorter direct route. Leave it at `0` for direct access.

To allow direct access from a trusted LAN, publish the port on every host
interface explicitly:

```sh
APPLICATION_TRACKER_BIND_ADDRESS=0.0.0.0 \
  docker compose -f deploy/compose.yml up --detach
```

Restrict port 3333 with the host firewall. Direct cleartext access is unsuitable
for an untrusted network. Never publish the Vite development server.

If the reverse proxy runs in Docker, attach it and Application Tracker to a
private Docker network and route to `application-tracker:3333`. Remove the
host port mapping unless the host also needs it.

Remote MCP uses the same HTTPS listener at `/mcp`. Follow
[`remote-mcp.md`](remote-mcp.md) for its URL, Host, Origin, credential, and
streaming requirements.

## Persistent data and permissions

The example mounts two named volumes:

- `application-tracker-data` contains SQLite, WAL, stored documents, and preview
  data.
- `application-tracker-backups` contains backups created by the operator
  command.

Docker initializes new named volumes from directories owned by the image's
unprivileged user. If you replace them with host bind mounts, make both
directories writable by container user ID 1000 and inaccessible to other host
users.

Treat both volumes as sensitive. A backup volume on the same host does not
protect against host or disk failure; copy verified backups to protected
off-host storage.

## Back up and verify

Run the compiled maintenance commands inside the container:

```sh
docker compose -f deploy/compose.yml exec application-tracker npm run db:backup
```

List or copy the resulting artifact through an operator-controlled process that
mounts the backup volume. Do not copy the live SQLite file from the data volume.
The complete procedure and restore constraints are in
[`backup-restore.md`](backup-restore.md).

## Upgrade

Create and verify an online backup before an upgrade. Then update the checkout
to the chosen release and rebuild:

```sh
docker compose -f deploy/compose.yml build --pull
docker compose -f deploy/compose.yml up --detach
docker compose -f deploy/compose.yml ps
```

Direct MCP deployment depends on a current generated schema manifest, which is
enforced by `npm run check`; it does not depend on registration or publication
through OpenAI. `npm run mcp:schema:release-check` may be used as a
non-blocking report of optional managed-distribution drift.

Only when an OpenAI-managed distribution release is explicitly in scope, run
`npm run mcp:schema:publication-check` and follow
[`mcp-schema-publication.md`](mcp-schema-publication.md). Keep prior published
contracts available throughout that optional sequence.

Startup applies forward migrations before the HTTP listener opens. Check health,
login, workspace data, and MCP status after the container becomes healthy.

Database migrations are forward-only. Reverting an image does not reverse a
schema change. A database rollback requires downtime and restoration of the
verified pre-upgrade backup to an absent destination. Rehearse that procedure
before relying on it in production.

## Stop or remove

Stop the service without deleting data:

```sh
docker compose -f deploy/compose.yml down
```

Do not add `--volumes` unless you intend to delete the database and backup
volumes. Removing those volumes destroys application data unless a separate
verified backup exists.
