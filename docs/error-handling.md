# Error handling and logs

Application Tracker returns stable JSON errors and writes one JSON object per
runtime log line. These boundaries give operators enough detail to correlate a
failure without recording request content or credentials.

## API errors

API errors use this envelope:

```json
{ "error": { "code": "invalid_json" } }
```

Route handlers map expected domain failures to documented codes such as
`authentication_required`, `forbidden`, or `application_not_found`. The final
HTTP boundary handles errors that occur before or outside a route:

| Status | Code                     | Meaning                               |
| -----: | ------------------------ | ------------------------------------- |
|    400 | `invalid_json`           | The JSON body could not be parsed     |
|    400 | `invalid_request`        | The request body could not be read    |
|    404 | `not_found`              | No API route matched                  |
|    413 | `payload_too_large`      | The body exceeded the 256 KiB limit   |
|    415 | `unsupported_media_type` | The body used an unsupported encoding |
|    500 | `internal_error`         | An unexpected server failure occurred |

The server adds `X-Request-Id` to every API response. It generates this value
instead of trusting a client-supplied identifier. Clients may report it to an
operator, but error responses never expose exception messages or stack traces.
Error responses also use `Cache-Control: no-store`.

## Runtime logs

Runtime logs contain a timestamp, severity, event name, and allowlisted
operational fields. API completion events may contain the request ID, method,
code-owned route template, status, and elapsed milliseconds. Lifecycle events
record startup, shutdown, and listener failures without printing the configured
host or database path.

The logger redacts fields that can contain:

- authorization headers, cookies, tokens, passwords, and setup secrets;
- request bodies, query strings, URLs, and filesystem paths;
- usernames, display names, email addresses, and phone numbers; and
- exception messages, stacks, and causes.

Unexpected errors record only a safe error class name. The server never logs
request or response bodies. JSON serialization also bounds string length and
handles circular values without failing the request.

Database maintenance commands print successful artifact reports to standard
output because the path and digest are part of their operator interface. Their
failure logs follow the redacted runtime contract.

Application logs do not replace security audit events. MCP tool outcomes use a
separate append-only database schema with an actor, workspace, action, target
type, result, transport, and timestamp. See [`local-mcp.md`](local-mcp.md).
Reverse proxies and container platforms need their own redaction policy because
this code cannot control their access logs.
