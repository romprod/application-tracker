import {
  DocumentNotFoundError,
  type DocumentsRepository,
} from "./documents.js";
import { normalizeDocumentMediaType } from "../domain/documents.js";

export const supportedDocumentPreviewMediaTypes = [
  "application/json",
  "application/pdf",
  "application/vnd.ms-outlook",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "message/rfc822",
  "text/csv",
  "text/markdown",
  "text/plain",
] as const;

export type SupportedDocumentPreviewMediaType =
  (typeof supportedDocumentPreviewMediaTypes)[number];

export interface TextDocumentPreview {
  kind: "text";
  mediaType: string;
  status: "ready";
  text: string;
  truncated: boolean;
}

export interface EmailDocumentPreview {
  cc: string[];
  date: string | null;
  from: string | null;
  kind: "email";
  mediaType: string;
  status: "ready";
  subject: string | null;
  text: string;
  to: string[];
  truncated: boolean;
}

export type ReadyDocumentPreview = EmailDocumentPreview | TextDocumentPreview;

export interface PdfDocumentPreview {
  mediaType: "application/pdf";
  status: "pdf";
}

export interface UnsupportedDocumentPreview {
  mediaType: string;
  status: "unsupported";
}

export type GeneratedDocumentPreview =
  ReadyDocumentPreview | UnsupportedDocumentPreview;

export interface DocumentPreviewSource {
  mediaType: string;
  originalFilename: string;
}

export interface DocumentPreviewGenerator {
  generate(
    bytes: Uint8Array,
    source: DocumentPreviewSource,
  ): Promise<GeneratedDocumentPreview | PdfDocumentPreview>;
}

export type ReadyDocumentPreviewRecord = ReadyDocumentPreview & {
  documentId: string;
  generatedAt: string;
  parserVersion: string;
};

export type PdfDocumentPreviewResult = PdfDocumentPreview & {
  documentId: string;
};

export type DocumentPreviewResult =
  | ReadyDocumentPreviewRecord
  | PdfDocumentPreviewResult
  | (UnsupportedDocumentPreview & { documentId: string });

export type SaveDocumentPreviewInput = ReadyDocumentPreviewRecord & {
  workspaceId: string;
};

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
  maxConcurrentWorkers: number;
  maxDecodedBytes: number;
  maxInputBytes: number;
  maxMemoryMb: number;
  maxOutputCharacters: number;
  timeoutMs: number;
}

export class DocumentPreviewCapacityError extends Error {
  public constructor() {
    super("Document preview capacity is temporarily full");
    this.name = "DocumentPreviewCapacityError";
  }
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
  private readonly inFlight = new Map<string, Promise<DocumentPreviewResult>>();

  public constructor(
    private readonly documents: DocumentsRepository,
    private readonly previews: DocumentPreviewsRepository,
    private readonly generator: DocumentPreviewGenerator,
    private readonly parserVersion = "document-preview-v2",
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

    const key = `${actor.workspaceId}\u0000${documentId}\u0000${this.parserVersion}`;
    const current = this.inFlight.get(key);
    if (current) return await current;

    const operation = this.generatePreview(actor.workspaceId, documentId);
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    }
  }

  private async generatePreview(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentPreviewResult> {
    const original = this.documents.getDocumentOriginal(
      workspaceId,
      documentId,
    );
    if (!original) throw new DocumentNotFoundError();
    const generated = await this.generator.generate(original.bytes, {
      mediaType: normalizeDocumentMediaType(
        original.document.originalFilename,
        original.document.mediaType,
      ),
      originalFilename: original.document.originalFilename,
    });
    if (generated.status === "pdf" || generated.status === "unsupported") {
      return { ...generated, documentId };
    }
    return this.previews.saveDocumentPreview({
      ...generated,
      documentId,
      generatedAt: this.clock().toISOString(),
      parserVersion: this.parserVersion,
      workspaceId,
    });
  }
}
