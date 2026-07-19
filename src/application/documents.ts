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

export interface DocumentOriginal {
  bytes: Uint8Array;
  document: DocumentRecord;
}

export interface DocumentsRepository {
  createDocument(input: CreateDocumentRecord): DocumentRecord;
  getDocumentOriginal(
    workspaceId: string,
    documentId: string,
  ): DocumentOriginal | undefined;
  listDocuments(workspaceId: string): DocumentRecord[];
}

export interface DocumentUploadPolicy {
  maxUploadBytes: number;
}

export type UploadDocumentInput = DocumentUploadMetadata & {
  bytes: Uint8Array;
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

  public listDocuments(actor: AuthenticatedActor): DocumentRecord[] {
    return this.repository.listDocuments(actor.workspaceId);
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
