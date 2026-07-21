import type Database from "better-sqlite3";

import type {
  DocumentPreviewsRepository,
  EmailDocumentPreview,
  ReadyDocumentPreviewRecord,
  SaveDocumentPreviewInput,
} from "../../application/document_previews.js";

interface StoredPreview {
  documentId: string;
  emailMetadataJson: string | null;
  generatedAt: string;
  isTruncated: number;
  mediaType: string;
  parserVersion: string;
  previewKind: "email" | "text";
  text: string;
}

type EmailMetadata = Pick<
  EmailDocumentPreview,
  "cc" | "date" | "from" | "subject" | "to"
>;

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.length <= 500;
}

function stringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length <= 25 && value.every(boundedString)
  );
}

function emailMetadata(value: string | null): EmailMetadata {
  if (value === null)
    throw new Error("Stored email preview metadata is missing");
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Stored email preview metadata is invalid");
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    !stringList(candidate.cc) ||
    !(candidate.date === null || boundedString(candidate.date)) ||
    !(candidate.from === null || boundedString(candidate.from)) ||
    !(candidate.subject === null || boundedString(candidate.subject)) ||
    !stringList(candidate.to)
  ) {
    throw new Error("Stored email preview metadata is invalid");
  }
  return {
    cc: candidate.cc,
    date: candidate.date,
    from: candidate.from,
    subject: candidate.subject,
    to: candidate.to,
  };
}

function previewRecord(stored: StoredPreview): ReadyDocumentPreviewRecord {
  const base = {
    documentId: stored.documentId,
    generatedAt: stored.generatedAt,
    mediaType: stored.mediaType,
    parserVersion: stored.parserVersion,
    status: "ready" as const,
    text: stored.text,
    truncated: stored.isTruncated === 1,
  };
  if (stored.previewKind === "email") {
    return {
      ...base,
      ...emailMetadata(stored.emailMetadataJson),
      kind: "email",
    };
  }
  if (stored.emailMetadataJson !== null) {
    throw new Error("Stored text preview metadata is invalid");
  }
  return { ...base, kind: "text" };
}

function serializedEmailMetadata(
  input: SaveDocumentPreviewInput,
): string | null {
  if (input.kind !== "email") return null;
  return JSON.stringify({
    cc: input.cc,
    date: input.date,
    from: input.from,
    subject: input.subject,
    to: input.to,
  } satisfies EmailMetadata);
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
           email_metadata_json AS emailMetadataJson,
           generated_at AS generatedAt,
           is_truncated AS isTruncated,
           media_type AS mediaType,
           parser_version AS parserVersion,
           preview_kind AS previewKind,
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
            plain_text, is_truncated, generated_at, preview_kind,
            email_metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, document_id, parser_version) DO UPDATE SET
           media_type = excluded.media_type,
           plain_text = excluded.plain_text,
           is_truncated = excluded.is_truncated,
           generated_at = excluded.generated_at,
           preview_kind = excluded.preview_kind,
           email_metadata_json = excluded.email_metadata_json`,
      )
      .run(
        input.workspaceId,
        input.documentId,
        input.parserVersion,
        input.mediaType,
        input.text,
        input.truncated ? 1 : 0,
        input.generatedAt,
        input.kind,
        serializedEmailMetadata(input),
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
