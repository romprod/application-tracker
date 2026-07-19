# Documents

Application Tracker stores original documents in the same SQLite database as
their metadata. Signed-in workspace members can upload, list, associate, and
download originals from the Documents workspace.

Preview generation and email-link extraction are separate capabilities. The
server does not parse uploaded files in the current release.

## Storage model

Migration 11 creates three tables:

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

## Upload policy

`DOCUMENT_MAX_UPLOAD_BYTES` sets the per-file limit. It defaults to 10 MiB and
accepts values from 1 KiB through 50 MiB. The server rejects empty files and
files above the configured limit.

The multipart boundary also limits the request to one file, two metadata
fields, four parts, bounded headers, and bounded field sizes. The upload route
checks the browser's `Origin` before reading multipart data. Filenames cannot
contain path separators or control characters.

The UI lists active document types and active applications. Linking a document
to an application is optional.

## HTTP boundary

All document routes require an active local session and scope reads to its
workspace.

| Method | Path                                  | Purpose                     |
| ------ | ------------------------------------- | --------------------------- |
| `GET`  | `/api/documents`                      | List document metadata      |
| `POST` | `/api/documents`                      | Store one multipart upload  |
| `GET`  | `/api/documents/:documentId/download` | Download the exact original |

Downloads use `application/octet-stream`, attachment disposition, a sandbox
content security policy, and `nosniff`. This keeps client-supplied media-type
metadata from controlling browser rendering.

## Backup and capacity

Document bytes live inside SQLite, so the tested online backup includes every
original and association. This keeps the upload transaction and backup
boundary atomic, but each unique file increases the database and backup size.

Size persistent storage and off-host backup retention for the expected document
library. Follow [`backup-restore.md`](backup-restore.md); never copy a live WAL
database file directly.

## Current limits

The current document library preserves originals only. It does not generate
previews, inspect archives, extract links from email files, delete documents,
or create document versions. Unsupported formats remain downloadable because
download authorization does not depend on preview support.
