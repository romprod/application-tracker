import {
  DocumentNotFoundError,
  type DocumentsRepository,
} from "./documents.js";

export const supportedDocumentPreviewMediaTypes = [
  "application/json",
  "message/rfc822",
  "text/csv",
  "text/markdown",
  "text/plain",
] as const;

export type SupportedDocumentPreviewMediaType =
  (typeof supportedDocumentPreviewMediaTypes)[number];

export interface ReadyDocumentPreview {
  mediaType: string;
  status: "ready";
  text: string;
  truncated: boolean;
}

export interface UnsupportedDocumentPreview {
  mediaType: string;
  status: "unsupported";
}

export type GeneratedDocumentPreview =
  ReadyDocumentPreview | UnsupportedDocumentPreview;

export interface DocumentPreviewGenerator {
  generate(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<GeneratedDocumentPreview>;
}

export interface ReadyDocumentPreviewRecord extends ReadyDocumentPreview {
  documentId: string;
  generatedAt: string;
  parserVersion: string;
}

export type DocumentPreviewResult =
  | ReadyDocumentPreviewRecord
  | (UnsupportedDocumentPreview & { documentId: string });

export interface SaveDocumentPreviewInput extends ReadyDocumentPreviewRecord {
  workspaceId: string;
}

export interface DocumentPreviewsRepository {
  getDocumentPreview(
    workspaceId: string,
    documentId: string,
    parserVersion: string,
  ): ReadyDocumentPreviewRecord | undefined;
  saveDocumentPreview(
    input: SaveDocumentPreviewInput,
  ): ReadyDocumentPreviewRecord;
}

export interface DocumentPreviewPolicy {
  maxInputBytes: number;
  maxMemoryMb: number;
  maxOutputCharacters: number;
  timeoutMs: number;
}

export class DocumentPreviewInputLimitError extends Error {
  public constructor() {
    super("Document exceeds the preview input limit");
    this.name = "DocumentPreviewInputLimitError";
  }
}

export class DocumentPreviewParseError extends Error {
  public constructor() {
    super("Document could not be converted to a safe preview");
    this.name = "DocumentPreviewParseError";
  }
}

export class DocumentPreviewTimeoutError extends Error {
  public constructor() {
    super("Document preview generation timed out");
    this.name = "DocumentPreviewTimeoutError";
  }
}

export class DocumentPreviewService {
  public constructor(
    private readonly documents: DocumentsRepository,
    private readonly previews: DocumentPreviewsRepository,
    private readonly generator: DocumentPreviewGenerator,
    private readonly parserVersion = "plain-text-v1",
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async getPreview(
    actor: { workspaceId: string },
    documentId: string,
  ): Promise<DocumentPreviewResult> {
    const cached = this.previews.getDocumentPreview(
      actor.workspaceId,
      documentId,
      this.parserVersion,
    );
    if (cached) return cached;

    const original = this.documents.getDocumentOriginal(
      actor.workspaceId,
      documentId,
    );
    if (!original) throw new DocumentNotFoundError();
    const generated = await this.generator.generate(
      original.bytes,
      original.document.mediaType,
    );
    if (generated.status === "unsupported") {
      return { ...generated, documentId };
    }
    return this.previews.saveDocumentPreview({
      ...generated,
      documentId,
      generatedAt: this.clock().toISOString(),
      parserVersion: this.parserVersion,
      workspaceId: actor.workspaceId,
    });
  }
}
