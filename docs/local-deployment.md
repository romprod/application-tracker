# Local host deployment

This guide runs the compiled application directly on one Linux host. Use it
when Docker is unnecessary and the host already has a supported Node.js
runtime.

## Requirements

- Node.js 22.12 or newer
- A dedicated unprivileged service account
- Owner-only database, backup, and configuration directories
- A trusted HTTPS reverse proxy for Internet access

Keep the checkout, runtime configuration, database, and backups separate. The
examples use these paths:

```text
/opt/application-tracker
/etc/application-tracker/application-tracker.env
/var/lib/application-tracker/application-tracker.sqlite
/var/backups/application-tracker
```

Replace them if the host follows another filesystem layout.

Create the service account and protected writable directories:

```sh
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin application-tracker
sudo install -d -o application-tracker -g application-tracker -m 0700 \
  /var/lib/application-tracker /var/backups/application-tracker
sudo install -d -o root -g root -m 0700 /etc/application-tracker
```

Skip the `useradd` command when the account already exists.

## Install and build

Check out the chosen release under `/opt/application-tracker`, then install from
the lockfile and compile it:

```sh
cd /opt/application-tracker
npm ci
npm run build
```

The process needs read access to the checkout and write access only to its data
and backup directories.

## Configure runtime values

Install `.env.example` as an owner-only external configuration file, then edit
its deployment values:

```sh
sudo install -o root -g root -m 0600 \
  /opt/application-tracker/.env.example \
  /etc/application-tracker/application-tracker.env
sudoedit /etc/application-tracker/application-tracker.env
```

Set at least these values:

```dotenv
HOST=0.0.0.0
PORT=3333
DATABASE_PATH=/var/lib/application-tracker/application-tracker.sqlite
BACKUP_DIRECTORY=/var/backups/application-tracker
SESSION_COOKIE_SECURE=true
SETUP_TOKEN=<one-time-token>
```

Generate `SETUP_TOKEN` with `openssl rand -hex 32`. Keep the real environment
file outside Git. If a reverse proxy and the application share the host,
`HOST=127.0.0.1` narrows the listener. Containers and other LAN clients require
`0.0.0.0` plus firewall rules.

## Run under systemd

Create `/etc/systemd/system/application-tracker.service`:

```ini
[Unit]
Description=Application Tracker
After=network.target

[Service]
Type=simple
User=application-tracker
Group=application-tracker
WorkingDirectory=/opt/application-tracker
Environment=NODE_ENV=production
EnvironmentFile=/etc/application-tracker/application-tracker.env
ExecStart=/usr/bin/node dist/server/server/http.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/application-tracker /var/backups/application-tracker

[Install]
WantedBy=multi-user.target
```

Set `ExecStart` to the absolute path returned by `command -v node` on the host.
Create the data and backup directories before starting the service, and make the
service account their owner.

Load and start the unit:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now application-tracker
sudo systemctl status application-tracker
```

The health endpoint is `GET /api/health`. Runtime logs are available through:

```sh
sudo journalctl --unit application-tracker --follow
```

Complete [`initial-setup.md`](initial-setup.md), then remove `SETUP_TOKEN` from
the external environment file and restart the service.

## Reverse proxy and firewall

For Internet access, terminate HTTPS at a trusted reverse proxy, preserve the
public `Host` header, and proxy to the configured application port. Keep
`SESSION_COOKIE_SECURE=true`. Permit port 3333 only from the proxy or trusted
LAN. The application does not manage certificates.

The remote MCP endpoint shares this listener at `/mcp`. See
[`remote-mcp.md`](remote-mcp.md) before enabling it.

## Back up and upgrade

Create and verify an online backup before changing the release:

```sh
cd /opt/application-tracker
npm run db:backup
```

Follow [`backup-restore.md`](backup-restore.md) and copy the verified artifact to
protected off-host storage. Update to the chosen release, run `npm ci`, run
`npm run build`, and restart the service. Check health, login, workspace data,
and MCP status.

Migrations apply forward during startup. Reverting source does not reverse the
database. Restore a verified pre-upgrade backup during downtime when a schema
rollback is required.

## Local stdio MCP

A local MCP client can launch the compiled stdio entry point from the same
checkout. It must use the same absolute `DATABASE_PATH` and run as an account
that can access the SQLite directory. Follow [`local-mcp.md`](local-mcp.md) for
the private actor and workspace configuration.
