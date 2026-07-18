# Local user management

Application Tracker administrators can manage local accounts inside their
current workspace. Public registration is not available, and the installation
still creates no default credentials.

## Account creation

An administrator creates a user with a display name, unique username, role,
and password. Usernames are compared case-insensitively and accept 3 to 64
letters, numbers, dots, underscores, or hyphens. New passwords require 12 to
128 characters.

The password is hashed before the repository receives the account operation.
The user, local credential, and workspace membership are then inserted in one
immediate SQLite transaction. A conflict returns the stable
`username_unavailable` code without exposing database details.

## Roles and status

The first release has two workspace roles:

- `admin` can manage users and other security-sensitive settings.
- `member` can use the application workspace but cannot administer users.

Disabling an account immediately revokes its active workspace sessions. An
administrator cannot disable the account backing their current session, which
prevents an accidental self-lockout. Re-enabling an account permits a new
login but does not restore revoked sessions.

All list and mutation queries include the authenticated workspace identifier.
Responses include user identity, role, status, creation time, and whether a
local credential exists. They never include password hashes or session tokens.

## HTTP boundary

The browser uses these administrator-only routes:

- `GET /api/settings/users`
- `POST /api/settings/users`
- `PATCH /api/settings/users/:userId/status`

An absent or expired session receives `authentication_required`; an active
member session receives `forbidden`. Responses are marked `no-store`.

State-changing requests also require a browser `Origin` whose host matches the
request host. Missing or cross-host origins receive `csrf_rejected` before the
mutation is processed. A production reverse proxy must preserve the public
`Host` header. The development proxy explicitly does the same so this check is
exercised during local use.

## Browser interface

Administrators open **Settings → Users** to see account, active, and admin
counts; inspect every workspace account; create a local user; or enable and
disable another account. The current account is visibly marked and protected
from disablement. Password fields are cleared after every account-creation
response.

The Settings submenu also reserves stable positions for Lists and MCP. Those
labels are intentionally non-interactive until their underlying capabilities
are implemented.
