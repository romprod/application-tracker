import type Database from "better-sqlite3";

import type {
  DocumentPreviewsRepository,
  ReadyDocumentPreviewRecord,
  SaveDocumentPreviewInput,
} from "../../application/document_previews.js";

interface StoredPreview {
  documentId: string;
  generatedAt: string;
  isTruncated: number;
  mediaType: string;
  parserVersion: string;
  text: string;
}

function previewRecord(stored: StoredPreview): ReadyDocumentPreviewRecord {
  return {
    documentId: stored.documentId,
    generatedAt: stored.generatedAt,
    mediaType: stored.mediaType,
    parserVersion: stored.parserVersion,
    status: "ready",
    text: stored.text,
    truncated: stored.isTruncated === 1,
  };
}

export class SqliteDocumentPreviewsRepository implements DocumentPreviewsRepository {
  public constructor(private readonly database: Database.Database) {}

  public getDocumentPreview(
    workspaceId: string,
    documentId: string,
    parserVersion: string,
  ): ReadyDocumentPreviewRecord | undefined {
    const stored = this.database
      .prepare(
        `SELECT
           document_id AS documentId,
           generated_at AS generatedAt,
           is_truncated AS isTruncated,
           media_type AS mediaType,
           parser_version AS parserVersion,
           plain_text AS text
         FROM document_previews
         WHERE workspace_id = ? AND document_id = ? AND parser_version = ?`,
      )
      .get(workspaceId, documentId, parserVersion) as StoredPreview | undefined;
    return stored ? previewRecord(stored) : undefined;
  }

  public saveDocumentPreview(
    input: SaveDocumentPreviewInput,
  ): ReadyDocumentPreviewRecord {
    this.database
      .prepare(
        `INSERT INTO document_previews
           (workspace_id, document_id, parser_version, media_type,
            plain_text, is_truncated, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, document_id, parser_version) DO UPDATE SET
           media_type = excluded.media_type,
           plain_text = excluded.plain_text,
           is_truncated = excluded.is_truncated,
           generated_at = excluded.generated_at`,
      )
      .run(
        input.workspaceId,
        input.documentId,
        input.parserVersion,
        input.mediaType,
        input.text,
        input.truncated ? 1 : 0,
        input.generatedAt,
      );
    const stored = this.getDocumentPreview(
      input.workspaceId,
      input.documentId,
      input.parserVersion,
    );
    if (!stored) throw new Error("Stored document preview could not be read");
    return stored;
  }
}
