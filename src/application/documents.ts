import { createHash } from "node:crypto";

import type { DocumentUploadMetadata } from "../domain/documents.js";
import type { AuthenticatedActor } from "./auth.js";

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

export interface CreateDocumentRecord extends DocumentUploadMetadata {
  bytes: Uint8Array;
  createdAt: string;
  sha256: string;
  uploadedByUserId: string;
  workspaceId: string;
}

export interface EquivalentDocumentInput extends DocumentUploadMetadata {
  sha256: string;
  workspaceId: string;
}

export interface DocumentOriginal {
  bytes: Uint8Array;
  document: DocumentRecord;
}

export interface DocumentContentChunk {
  bytes: Uint8Array;
  document: DocumentRecord;
  sha256: string;
}

export interface DocumentsRepository {
  createDocument(input: CreateDocumentRecord): DocumentRecord;
  findEquivalentDocument(
    input: EquivalentDocumentInput,
  ): DocumentRecord | undefined;
  getDocumentChunk(
    workspaceId: string,
    documentId: string,
    offset: number,
    maxBytes: number,
  ): DocumentContentChunk | undefined;
  getDocumentOriginal(
    workspaceId: string,
    documentId: string,
  ): DocumentOriginal | undefined;
  listDocuments(workspaceId: string): DocumentRecord[];
}

export interface DocumentUploadPolicy {
  maxUploadBytes: number;
}

export interface DocumentStoragePolicy {
  maxInstallationBytes: number;
  maxInstallationDocuments: number;
  maxWorkspaceBytes: number;
  maxWorkspaceDocuments: number;
}

export type UploadDocumentInput = DocumentUploadMetadata & {
  bytes: Uint8Array;
};

export type ImportDocumentInput = UploadDocumentInput & {
  sha256: string;
};

export class InvalidDocumentContentError extends Error {
  public constructor() {
    super("Document content is empty or exceeds the upload limit");
    this.name = "InvalidDocumentContentError";
  }
}

export class InvalidDocumentReferenceError extends Error {
  public constructor() {
    super("Document reference is invalid");
    this.name = "InvalidDocumentReferenceError";
  }
}

export class DocumentNotFoundError extends Error {
  public constructor() {
    super("Document not found");
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentContentConflictError extends Error {
  public constructor() {
    super("Stored document content does not match its digest");
    this.name = "DocumentContentConflictError";
  }
}

export class DocumentStorageQuotaExceededError extends Error {
  public constructor() {
    super("Document storage quota has been reached");
    this.name = "DocumentStorageQuotaExceededError";
  }
}

export class DocumentLibraryService {
  public constructor(
    private readonly repository: DocumentsRepository,
    private readonly policy: DocumentUploadPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public uploadDocument(
    actor: AuthenticatedActor,
    input: UploadDocumentInput,
  ): DocumentRecord {
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > this.policy.maxUploadBytes
    ) {
      throw new InvalidDocumentContentError();
    }
    return this.repository.createDocument({
      ...input,
      createdAt: this.clock().toISOString(),
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      uploadedByUserId: actor.userId,
      workspaceId: actor.workspaceId,
    });
  }

  public importDocument(
    actor: AuthenticatedActor,
    input: ImportDocumentInput,
  ): DocumentRecord {
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > this.policy.maxUploadBytes ||
      createHash("sha256").update(input.bytes).digest("hex") !== input.sha256
    ) {
      throw new InvalidDocumentContentError();
    }
    const record = {
      ...input,
      createdAt: this.clock().toISOString(),
      uploadedByUserId: actor.userId,
      workspaceId: actor.workspaceId,
    };
    return (
      this.repository.findEquivalentDocument(record) ??
      this.repository.createDocument(record)
    );
  }

  public listDocuments(actor: AuthenticatedActor): DocumentRecord[] {
    return this.repository.listDocuments(actor.workspaceId);
  }

  public getDocumentChunk(
    actor: AuthenticatedActor,
    documentId: string,
    offset: number,
    maxBytes: number,
  ): DocumentContentChunk {
    const chunk = this.repository.getDocumentChunk(
      actor.workspaceId,
      documentId,
      offset,
      maxBytes,
    );
    if (!chunk) throw new DocumentNotFoundError();
    return chunk;
  }

  public getDocumentOriginal(
    actor: AuthenticatedActor,
    documentId: string,
  ): DocumentOriginal {
    const original = this.repository.getDocumentOriginal(
      actor.workspaceId,
      documentId,
    );
    if (!original) throw new DocumentNotFoundError();
    return original;
  }
}
