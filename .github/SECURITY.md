# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting feature for this repository. Include the affected
version, reproduction steps, impact, and any suggested mitigation.

Do not include real credentials, access tokens, private documents, or personal
application data in a report. Use a minimal synthetic fixture.

## Supported versions

No public version is supported while the initial implementation is underway.
After the first release, the latest stable version will receive security fixes.

## Security expectations

- The backend listens on all interfaces by default for LAN and container use.
  Restrict the port with the host firewall. A container deployment should
  publish it on loopback unless direct LAN access is required.
- Terminate Internet traffic with HTTPS at a trusted reverse proxy. Preserve the
  public `Host` header, set secure cookies, and never expose Vite publicly.
- Keep real `.env`, `.mcp.json`, databases, backups, and uploaded documents out
  of Git.
- Place secrets in runtime configuration or a secret store.
- Back up SQLite with the online backup API instead of copying a live file.
- Report dependency vulnerabilities that are reachable through product code,
  even when a package manager classifies them as low severity.
