# Local authentication

Application Tracker always retains local password authentication. A local
administrator created during first-run setup can sign in without an external
identity provider.

## HTTP request admission

The server admits 600 requests per minute by default from each direct network
source before parsing or authorizing a request. The process-local limiter
covers website navigation, static fallback responses, API routes, and the
outer remote MCP boundary. Limited requests receive `429` with `RateLimit` and
`Retry-After` headers. Configure the bounded policy with
`HTTP_RATE_LIMIT_REQUESTS` and `HTTP_RATE_LIMIT_WINDOW_SECONDS`.

Forwarded client addresses are ignored by default. When the application is
reachable only through one fixed proxy chain, set `HTTP_TRUST_PROXY_HOPS` to
the exact number of trusted hops (range 0-8). This lets source limiters separate
clients while preventing arbitrary forwarded headers from selecting a bucket.
Keep an edge limit as a second layer, and use a shared rate-limit store if a
future deployment runs more than one Application Tracker process. Login and
remote MCP requests retain their account, source, connection, and concurrency
controls below this outer boundary.

The remote MCP router repeats the direct-source policy immediately before
bearer authorization. This is intentional: it keeps invalid-token attempts
bounded even when the router is embedded independently, while the existing
post-authentication actor limit controls authorized MCP use.

## Password verification

Passwords are stored as uniquely salted scrypt hashes. Login uses the same
bounded scrypt verification for known and unknown usernames so the response
does not disclose whether an account exists. Disabled users and incorrect
passwords receive the same `invalid_credentials` response. A process-wide
fail-fast gate allows two password verifications at once by default. Excess
requests receive `429 login_capacity_reached` with `Retry-After` before scrypt
starts; admitted unknown usernames still pay the dummy-hash verification cost.

Before starting scrypt, the server also admits at most 10 password checks per
minute for each normalized account name and direct network source. A limited
request receives `429 login_rate_limited` with `Retry-After`. Known and unknown
accounts use the same buckets and response, so this control does not disclose
whether an account exists. The in-memory tracker holds at most 10,000 keys and
resets when the process restarts.

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
the workspace without exposing the session token to JavaScript. A shared API
boundary also watches authenticated requests: `401 authentication_required`
unmounts the workspace, clears its in-memory data and forms, and returns to the
login screen with a session-expiry notice. Other validation, permission,
conflict, and network errors stay with the page that made the request. Signing
out uses `POST /api/auth/logout`, and the browser returns to the login form only
after the server has revoked the session.

Submitting another valid login while the browser already has a session rotates
the credential: the old database session is revoked and a fresh random token
is issued. The client keeps the username and password only in component memory
while the form is mounted. It does not write credentials or tokens to local or
session storage.

Configure password-verification admission with
`LOGIN_MAX_CONCURRENT_VERIFICATIONS` (range 1–32),
`LOGIN_RATE_LIMIT_ATTEMPTS` (range 1–1,000),
`LOGIN_RATE_LIMIT_WINDOW_SECONDS` (range 1–3,600), and
`LOGIN_RATE_LIMIT_MAX_KEYS` (range 100–100,000). Configure sessions with
`SESSION_IDLE_SECONDS`,
`SESSION_ABSOLUTE_SECONDS`, `SESSION_REFRESH_SECONDS`, and
`SESSION_COOKIE_SECURE`. The absolute lifetime must exceed the idle lifetime,
and the refresh interval must be shorter than the idle lifetime.

Browser and built-in MCP authorization logins use the same Express-resolved
client address. The source bucket uses the direct socket address when
`HTTP_TRUST_PROXY_HOPS=0` and the bounded trusted chain when the setting is
nonzero. Keep a proxy or edge login limit as a second layer and tune the
application threshold for the expected login volume.

## Transport boundary

Plain HTTP is acceptable only on a trusted development network. Production
must use HTTPS through a trusted reverse proxy and retain secure cookies. Do
not set `SESSION_COOKIE_SECURE=false` for an internet-facing deployment.
