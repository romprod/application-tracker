import { browserApiFetch } from "./browser_api_fetch";

export interface DocumentApplicationAssociation {
  companyName: string;
  id: string;
  roleTitle: string;
}

export interface DocumentRecord {
  applications: DocumentApplicationAssociation[];
  byteSize: number;
  createdAt: string;
  documentType: string;
  documentTypeId: string;
  id: string;
  mediaType: string;
  originalFilename: string;
  uploadedByDisplayName: string;
}

export interface DocumentDirectory {
  documents: DocumentRecord[];
  maxUploadBytes: number;
}

export interface UploadDocumentInput {
  applicationIds: string[];
  documentTypeId: string;
  file: File;
}

export interface TextDocumentPreview {
  documentId: string;
  generatedAt: string;
  kind: "text";
  mediaType: string;
  parserVersion: string;
  status: "ready";
  text: string;
  truncated: boolean;
}

export interface EmailDocumentPreview {
  cc: string[];
  date: string | null;
  documentId: string;
  from: string | null;
  generatedAt: string;
  kind: "email";
  mediaType: string;
  parserVersion: string;
  status: "ready";
  subject: string | null;
  text: string;
  to: string[];
  truncated: boolean;
}

export interface PdfDocumentPreview {
  documentId: string;
  mediaType: "application/pdf";
  status: "pdf";
}

export interface UnsupportedDocumentPreview {
  documentId: string;
  mediaType: string;
  status: "unsupported";
}

export type ReadyDocumentPreview = EmailDocumentPreview | TextDocumentPreview;

export type DocumentPreview =
  PdfDocumentPreview | ReadyDocumentPreview | UnsupportedDocumentPreview;

export interface DocumentsClient {
  getDocumentPreview(documentId: string): Promise<DocumentPreview>;
  listDocuments(): Promise<DocumentDirectory>;
  uploadDocument(input: UploadDocumentInput): Promise<DocumentRecord>;
}

export class DocumentsClientError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "DocumentsClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(
      value,
    )
  );
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isSafeFilename(value: string): boolean {
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code < 32 || code === 127;
  });
}

function parseAssociation(value: unknown): DocumentApplicationAssociation {
  if (
    !isRecord(value) ||
    !isBoundedText(value.companyName, 160) ||
    !isId(value.id) ||
    !isBoundedText(value.roleTitle, 160)
  ) {
    throw new DocumentsClientError("invalid_response");
  }
  return {
    companyName: value.companyName,
    id: value.id,
    roleTitle: value.roleTitle,
  };
}

function parseDocument(value: unknown): DocumentRecord {
  if (
    !isRecord(value) ||
    !Array.isArray(value.applications) ||
    value.applications.length > 20 ||
    !Number.isSafeInteger(value.byteSize) ||
    (value.byteSize as number) < 1 ||
    (value.byteSize as number) > 52_428_800 ||
    !isBoundedText(value.createdAt, 40) ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !isBoundedText(value.documentType, 80) ||
    !isId(value.documentTypeId) ||
    !isId(value.id) ||
    !isBoundedText(value.mediaType, 255) ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value.mediaType) ||
    !isBoundedText(value.originalFilename, 255) ||
    !isSafeFilename(value.originalFilename) ||
    !isBoundedText(value.uploadedByDisplayName, 160)
  ) {
    throw new DocumentsClientError("invalid_response");
  }
  return {
    applications: value.applications.map(parseAssociation),
    byteSize: value.byteSize as number,
    createdAt: value.createdAt,
    documentType: value.documentType,
    documentTypeId: value.documentTypeId,
    id: value.id,
    mediaType: value.mediaType,
    originalFilename: value.originalFilename,
    uploadedByDisplayName: value.uploadedByDisplayName,
  };
}

function parsePreview(value: unknown): DocumentPreview {
  if (
    !isRecord(value) ||
    !isId(value.documentId) ||
    !isBoundedText(value.mediaType, 127)
  ) {
    throw new DocumentsClientError("invalid_response");
  }
  if (value.status === "unsupported") {
    return {
      documentId: value.documentId,
      mediaType: value.mediaType,
      status: "unsupported",
    };
  }
  if (value.status === "pdf" && value.mediaType === "application/pdf") {
    return {
      documentId: value.documentId,
      mediaType: "application/pdf",
      status: "pdf",
    };
  }
  if (
    value.status !== "ready" ||
    (value.kind !== "text" && value.kind !== "email") ||
    !isBoundedText(value.generatedAt, 40) ||
    Number.isNaN(Date.parse(value.generatedAt)) ||
    !isBoundedText(value.parserVersion, 64) ||
    typeof value.text !== "string" ||
    value.text.length > 1_000_000 ||
    typeof value.truncated !== "boolean"
  ) {
    throw new DocumentsClientError("invalid_response");
  }
  const base = {
    documentId: value.documentId,
    generatedAt: value.generatedAt,
    mediaType: value.mediaType,
    parserVersion: value.parserVersion,
    status: "ready" as const,
    text: value.text,
    truncated: value.truncated,
  };
  if (value.kind === "text") return { ...base, kind: "text" };
  if (
    !Array.isArray(value.cc) ||
    value.cc.length > 25 ||
    !value.cc.every((entry) => isBoundedText(entry, 500)) ||
    !(value.date === null || isBoundedText(value.date, 500)) ||
    !(value.from === null || isBoundedText(value.from, 500)) ||
    !(value.subject === null || isBoundedText(value.subject, 500)) ||
    !Array.isArray(value.to) ||
    value.to.length > 25 ||
    !value.to.every((entry) => isBoundedText(entry, 500))
  ) {
    throw new DocumentsClientError("invalid_response");
  }
  return {
    ...base,
    cc: value.cc,
    date: value.date,
    from: value.from,
    kind: "email",
    subject: value.subject,
    to: value.to,
  };
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DocumentsClientError("invalid_response");
  }
}

function errorCode(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }
  return "request_failed";
}

async function successfulBody(response: Response): Promise<unknown> {
  const body = await readResponse(response);
  if (!response.ok) throw new DocumentsClientError(errorCode(body));
  return body;
}

export const browserDocumentsClient: DocumentsClient = {
  async getDocumentPreview(documentId) {
    const response = await browserApiFetch(
      `/api/documents/${encodeURIComponent(documentId)}/preview`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
    const body = await successfulBody(response);
    if (!isRecord(body)) throw new DocumentsClientError("invalid_response");
    return parsePreview(body.preview);
  },

  async listDocuments() {
    const response = await browserApiFetch("/api/documents", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await successfulBody(response);
    if (
      !isRecord(body) ||
      !Array.isArray(body.documents) ||
      !Number.isSafeInteger(body.maxUploadBytes) ||
      (body.maxUploadBytes as number) < 1_024 ||
      (body.maxUploadBytes as number) > 52_428_800
    ) {
      throw new DocumentsClientError("invalid_response");
    }
    return {
      documents: body.documents.map(parseDocument),
      maxUploadBytes: body.maxUploadBytes as number,
    };
  },

  async uploadDocument(input) {
    const form = new FormData();
    form.append("documentTypeId", input.documentTypeId);
    form.append("applicationIds", JSON.stringify(input.applicationIds));
    form.append("file", input.file);
    const response = await browserApiFetch("/api/documents", {
      body: form,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "POST",
    });
    const body = await successfulBody(response);
    if (!isRecord(body)) throw new DocumentsClientError("invalid_response");
    return parseDocument(body.document);
  },
};
