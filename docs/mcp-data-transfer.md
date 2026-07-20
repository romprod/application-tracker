# MCP data transfer

Application Tracker exposes bounded document export and import tools over local
stdio and authenticated Streamable HTTP. These tools support controlled data
migrations without adding file paths, actor selection, or workspace selection
to MCP input.

## Document import

Call `get_tracker_context` first. The bound workspace must be in `read_write`
mode. Then:

1. Call `get_reference_data` and `list_applications` to resolve target IDs.
2. Call `get_document_import_capabilities` to read the file and chunk limits.
3. Call `begin_document_import` with metadata, application IDs, the exact byte
   size, the whole-file SHA-256 digest, and a caller-chosen idempotency key.
4. Call `append_document_chunk` in offset order. Each request carries canonical
   base64 and the chunk's SHA-256 digest.
5. Call `complete_document_import` after the returned progress reports
   `complete=true`.
6. Call `cancel_document_import` after successful completion to release the
   transient chunks. This does not delete the stored document.

An exact retry of `begin_document_import`, `append_document_chunk`, or
`complete_document_import` is safe. Completion rechecks the whole-file digest,
document type, application associations, upload limit, and storage quotas. It
stores the document and its audit event in one transaction.

Transient imports expire after 15 minutes of inactivity and do not survive a
process restart. Restart an expired transfer with the same idempotency key.
Persistent completion remains idempotent because the document library matches
the digest, filename, media type, document type, and exact application set.

The process accepts at most eight active imports, including at most two for one
actor. Remote sessions share this capacity. Each chunk contains at most 12 KiB,
which stays below the default remote JSON request limit after base64 and
protocol framing.

## Document export

`list_documents` returns bounded pages of metadata and associations.
`export_document_chunk` returns one bounded base64 chunk with whole-file and
chunk SHA-256 digests. Start at offset zero and follow `nextOffset` until
`complete=true`.

`list_applications` also accepts `limit` and `offset`. Use the returned
`nextOffset`, then call `get_application` for each full record and its stage
events. `get_reference_data` supplies the workspace's stable reference IDs.

## Whole-workspace datasets

The document tools are transfer primitives, not a database-restore protocol.
The existing SQLite backup remains the exact installation backup and includes
accounts, credentials, audit history, documents, previews, and every workspace.
MCP must never expose that artifact to a workspace-scoped client.

A native MCP whole-workspace format should be a separate feature. Its contract
must define these points before implementation:

- a versioned, workspace-scoped envelope and explicit included entity types;
- a consistent export snapshot across every page and document chunk;
- reference-value mapping and stable source-to-target entity IDs;
- actor attribution for imported history without importing credentials;
- dry-run validation, quota preflight, and conflict policy;
- durable staging followed by one atomic commit or a complete rollback;
- resumable chunks, whole-artifact integrity, and replay-safe completion;
- audit records that identify the transfer without storing its content; and
- round-trip, interrupted-transfer, upgrade, and rollback tests.

Until that contract exists, clients should use the current application and
document tools for logical migrations and the verified SQLite backup workflow
for exact installation recovery.
