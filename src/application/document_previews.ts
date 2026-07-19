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
