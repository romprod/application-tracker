# Documents

Application Tracker stores original documents in the same SQLite database as
their metadata. Signed-in workspace members can upload, list, associate, and
download originals from the Documents workspace. They can also view PDFs
inline and request bounded text or structured-email previews for explicitly
supported formats.

## Storage model

Migration 11 creates three original-storage tables:

- `file_objects` stores one byte sequence for each SHA-256 digest;
- `documents` stores the workspace, filename, media type, document type,
  uploader, and creation time; and
- `application_documents` links one document to as many as 20 active
  applications.

The server calculates the SHA-256 digest. Upload writes the file object,
metadata, and application links in one immediate transaction. If an existing
digest points to different bytes or a different size, the transaction stops
instead of accepting a collision. Identical uploads reuse one file object but
retain separate document records.

Document types must be active values from the document-type list in the same
workspace. Application links must also point to active records in that
workspace. Database foreign keys and triggers enforce both rules.

Migration 12 adds `document_previews`. Each preview belongs to a workspace and
document and records the parser version, media type, generated plain text,
truncation state, and generation time. The parser version forms part of the
primary key, so a parser upgrade creates a new cache entry instead of reusing
stale output. A workspace-scoped foreign key deletes cached previews with their
document.

Migration 19 extends that cache with a preview kind and bounded JSON email
metadata. Existing cached text remains valid as text; new MSG and EML previews
store their subject, sender, recipients, date, and inert body text alongside
the common preview fields.

## Upload policy

`DOCUMENT_MAX_UPLOAD_BYTES` sets the per-file limit. It defaults to 10 MiB and
accepts values from 1 KiB through 50 MiB. The server rejects empty files and
files above the configured limit.

The repository also enforces cumulative quotas inside the same immediate
transaction that validates references and stores bytes. Unique BLOB bytes are
charged once per installation and once per workspace; every document metadata
row is charged even when it reuses a digest. A rejected upload leaves no file
object, document, or association row.

| Variable                          | Default | Accepted range |
| --------------------------------- | ------: | -------------- |
| `DOCUMENT_MAX_WORKSPACE_BYTES`    | 512 MiB | 1 KiB–1 TiB    |
| `DOCUMENT_MAX_WORKSPACE_COUNT`    |   2,000 | 1–1,000,000    |
| `DOCUMENT_MAX_INSTALLATION_BYTES` |   2 GiB | 1 KiB–1 TiB    |
| `DOCUMENT_MAX_INSTALLATION_COUNT` |  10,000 | 1–1,000,000    |

The workspace byte quota must cover one maximum upload. Installation byte and
count quotas must be at least their workspace counterparts. Startup rejects an
invalid ordering. Quota exhaustion returns
`409 document_storage_quota_exceeded` without exposing current usage.

The multipart boundary also limits the request to one file, two metadata
fields, four parts, bounded headers, and bounded field sizes. The upload route
checks the browser's `Origin` before reading multipart data. Filenames cannot
contain path separators or control characters.

`DOCUMENT_MAX_CONCURRENT_UPLOADS` caps in-memory multipart parsing across the
process. It defaults to 2 and accepts 1–32. When every slot is active, the
server rejects another upload before reading its body with
`503 document_upload_busy` and `Retry-After`. The maximum aggregate buffered
file data is therefore the concurrency limit multiplied by the per-file limit.

The UI lists active document types and active applications. Linking a document
to an application is optional.

## Preview policy

The preview endpoint supports these formats:

- `application/pdf`
- `application/vnd.ms-outlook` (`.msg`)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  (`.docx`)
- `message/rfc822`
- `text/csv`
- `text/markdown`
- `text/plain`

Browser upload media types are not reliable for DOCX, EML, MSG, and PDF, so the
server normalizes those four types from their case-insensitive filename
extensions. PDF originals are returned only by the authenticated inline route,
with a PDF signature check, inline disposition, `nosniff`, same-origin resource
policy, and a sandbox content security policy.

DOCX parsing reads only selected Word document, header, footer, footnote, and
endnote XML entries. MSG and EML parsing returns a structured envelope and a
plain-text body. HTML-only email bodies are converted to text; message HTML and
attachments are never rendered. Email-only Unicode spacer lines are compacted
without changing the original. CSV, Markdown, and plain text are decoded as
UTF-8. All text output has normalized line endings, and nominal text files with
binary-looking controls fail closed. Other formats return an unsupported result
while their originals remain available for authorized download.

The service coalesces simultaneous cache misses for the same workspace,
document, and parser version. A distinct miss acquires process-wide capacity
before copying input or starting a disposable child process outside the HTTP
event loop. The supervisor sets a V8 heap limit, caps input, decoded DOCX
content, and output, enforces a wall-clock timeout, validates the process JSON
response, and terminates the process after success or failure. These
environment variables set the limits:

| Variable                                  | Default | Accepted range         |
| ----------------------------------------- | ------: | ---------------------- |
| `DOCUMENT_PREVIEW_MAX_CONCURRENT_WORKERS` |       2 | 1–32 process-wide      |
| `DOCUMENT_PREVIEW_MAX_INPUT_BYTES`        |   1 MiB | 1 KiB–10 MiB           |
| `DOCUMENT_PREVIEW_MAX_DECODED_BYTES`      |   8 MiB | 1 KiB–32 MiB           |
| `DOCUMENT_PREVIEW_MAX_OUTPUT_CHARACTERS`  | 100,000 | 1,000–1,000,000        |
| `DOCUMENT_PREVIEW_TIMEOUT_MS`             | 1,500ms | 100–10,000ms           |
| `DOCUMENT_PREVIEW_MAX_MEMORY_MB`          |  32 MiB | 16–128 MiB per process |

The input limit must not exceed `DOCUMENT_MAX_UPLOAD_BYTES`. A successful
text or email preview is cached in SQLite. PDF, unsupported, oversized,
timed-out, and failed previews are not cached. When all process slots are
active, a distinct miss returns `503 document_preview_busy` with `Retry-After`;
coalesced requests share the existing result instead.

## Email-link extraction

The application editor accepts pasted email content up to 200,000 characters
and local `.eml` files up to 200 KB whose decoded text fits the same character
limit. It sends the text to an authenticated, same-origin API that returns at
most 20 likely job links. The extractor makes no network requests. It recognizes
common recruitment hosts and job-like paths, unwraps Outlook Safe Links and
Google redirect links, decodes quoted-printable content when the message
declares that encoding, removes duplicates, and filters common privacy, support,
preference, terms, and unsubscribe links.

The browser selects candidates by default, but saves only the links the user
confirms. It adds them to the application's existing related-links field, which
retains its 10-link limit. Neither the browser workflow nor the server stores
the pasted message or `.eml` body. It does not fetch links or parse MIME
attachment files.

## HTTP boundary

All document routes require an active local session and scope reads to its
workspace.

| Method | Path                                  | Purpose                     |
| ------ | ------------------------------------- | --------------------------- |
| `GET`  | `/api/documents`                      | List document metadata      |
| `POST` | `/api/documents`                      | Store one multipart upload  |
| `GET`  | `/api/documents/:documentId/download` | Download the exact original |
| `GET`  | `/api/documents/:documentId/view`     | Render a validated PDF      |
| `GET`  | `/api/documents/:documentId/preview`  | Generate or read a preview  |
| `POST` | `/api/documents/email-links/extract`  | Extract job-link candidates |

Downloads use `application/octet-stream`, attachment disposition, a sandbox
content security policy, and `nosniff`. The separate PDF view route is the only
inline-original boundary. This keeps client-supplied media-type metadata from
controlling browser rendering.

## Backup and capacity

Document bytes and cached previews live inside SQLite, so the tested online
backup includes every original, association, and generated preview. This keeps
the upload transaction and backup boundary atomic. The configured quotas bound
accepted document growth, but previews and retained database free pages also
affect database and backup size.

Size persistent storage and off-host backup retention for the expected document
library. Follow [`backup-restore.md`](backup-restore.md); never copy a live WAL
database file directly.

## Current limits

The current preview implementation supports modern Word `.docx`, not legacy
`.doc`, and it does not support ODT or RTF. It does not render message HTML,
extract embedded DOCX objects or email attachments, delete documents, or create
document versions. Unsupported formats remain downloadable because download
authorization does not depend on preview support.
