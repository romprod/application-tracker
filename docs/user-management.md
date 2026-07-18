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
