# Local authentication

Application Tracker always retains local password authentication. A local
administrator created during first-run setup can sign in without an external
identity provider.

## Password verification

Passwords are stored as uniquely salted scrypt hashes. Login uses the same
bounded scrypt verification for known and unknown usernames so the response
does not disclose whether an account exists. Disabled users and incorrect
passwords receive the same `invalid_credentials` response. A process-wide
fail-fast gate allows two password verifications at once by default. Excess
requests receive `429 login_capacity_reached` with `Retry-After` before scrypt
starts; admitted unknown usernames still pay the dummy-hash verification cost.

The password and setup token never appear in URLs, response bodies, database
logs, or application logs.

## Browser sessions

Successful login creates a 32-byte random token. Only its SHA-256 hash is stored
in SQLite; the raw token is sent in an `HttpOnly`, `SameSite=Strict`, host-only
cookie with path `/`. Production enables the `Secure` attribute by default.

The default session policy is:

- 30-minute idle lifetime
- 24-hour absolute lifetime
- idle-expiry refresh no more than once per minute

The idle lifetime can never extend beyond the absolute lifetime. Logout revokes
the database session before expiring the browser cookie. Disabled users,
expired sessions, and users without a current workspace membership cannot
authenticate. Expired rows are cleaned up during login.

The browser checks `GET /api/auth/session` when it opens. An unauthenticated
visitor sees the local login form; a successful `POST /api/auth/login` opens
the workspace without exposing the session token to JavaScript. Signing out
uses `POST /api/auth/logout`, and the browser returns to the login form only
after the server has revoked the session.

Submitting another valid login while the browser already has a session rotates
the credential: the old database session is revoked and a fresh random token
is issued. The client keeps the username and password only in component memory
while the form is mounted. It does not write credentials or tokens to local or
session storage.

Configure password-verification admission with
`LOGIN_MAX_CONCURRENT_VERIFICATIONS` (range 1–32). Configure sessions with
`SESSION_IDLE_SECONDS`,
`SESSION_ABSOLUTE_SECONDS`, `SESSION_REFRESH_SECONDS`, and
`SESSION_COOKIE_SECURE`. The absolute lifetime must exceed the idle lifetime,
and the refresh interval must be shorter than the idle lifetime.

## Transport boundary

Plain HTTP is acceptable only on a trusted development network. Production
must use HTTPS through a trusted reverse proxy and retain secure cookies. Do
not set `SESSION_COOKIE_SECURE=false` for an internet-facing deployment.
