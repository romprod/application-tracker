import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  DocumentContentConflictError,
  DocumentStorageQuotaExceededError,
  InvalidDocumentReferenceError,
  type CreateDocumentRecord,
  type DocumentApplicationAssociation,
  type DocumentContentChunk,
  type EquivalentDocumentInput,
  type DocumentOriginal,
  type DocumentRecord,
  type DocumentStoragePolicy,
  type DocumentsRepository,
} from "../../application/documents.js";

type StoredDocument = Omit<DocumentRecord, "applications">;

interface StoredAssociation extends DocumentApplicationAssociation {
  documentId: string;
}

interface StoredFileObject {
  byteSize: number;
  content: Buffer;
}

interface StoredDocumentChunk {
  content: Buffer;
  sha256: string;
}

interface StoredUsage {
  bytes: number;
  documents: number;
}

const publicDocumentSelect = `
  SELECT
    documents.id,
    documents.original_filename AS originalFilename,
    documents.media_type AS mediaType,
    documents.created_at AS createdAt,
    reference_values.id AS documentTypeId,
    reference_values.label AS documentType,
    file_objects.byte_size AS byteSize,
    users.display_name AS uploadedByDisplayName
  FROM documents
  JOIN reference_values
    ON reference_values.id = documents.document_type_reference_id
  JOIN file_objects
    ON file_objects.sha256 = documents.file_sha256
  JOIN users
    ON users.id = documents.uploaded_by_user_id`;

export class SqliteDocumentsRepository implements DocumentsRepository {
  public constructor(
    private readonly database: Database.Database,
    private readonly storagePolicy: DocumentStoragePolicy,
  ) {
    if (
      !Number.isSafeInteger(storagePolicy.maxInstallationBytes) ||
      !Number.isSafeInteger(storagePolicy.maxInstallationDocuments) ||
      !Number.isSafeInteger(storagePolicy.maxWorkspaceBytes) ||
      !Number.isSafeInteger(storagePolicy.maxWorkspaceDocuments) ||
      storagePolicy.maxInstallationBytes < storagePolicy.maxWorkspaceBytes ||
      storagePolicy.maxInstallationDocuments <
        storagePolicy.maxWorkspaceDocuments ||
      storagePolicy.maxWorkspaceBytes < 1 ||
      storagePolicy.maxWorkspaceDocuments < 1
    ) {
      throw new Error("Invalid document storage policy");
    }
  }

  private associations(
    workspaceId: string,
    documentId?: string,
  ): StoredAssociation[] {
    return this.database
      .prepare(
        `SELECT
           application_documents.document_id AS documentId,
           applications.id,
           applications.company_name AS companyName,
           applications.role_title AS roleTitle
         FROM application_documents
         JOIN applications
           ON applications.workspace_id = application_documents.workspace_id
          AND applications.id = application_documents.application_id
         WHERE application_documents.workspace_id = ?
           AND (? IS NULL OR application_documents.document_id = ?)
         ORDER BY applications.company_name COLLATE NOCASE,
                  applications.role_title COLLATE NOCASE,
                  applications.id`,
      )
      .all(
        workspaceId,
        documentId ?? null,
        documentId ?? null,
      ) as StoredAssociation[];
  }

  private hydrate(
    workspaceId: string,
    stored: StoredDocument[],
  ): DocumentRecord[] {
    const documents = stored.map((document) => ({
      ...document,
      applications: [] as DocumentApplicationAssociation[],
    }));
    const byId = new Map(documents.map((document) => [document.id, document]));
    for (const { documentId, ...association } of this.associations(
      workspaceId,
    )) {
      byId.get(documentId)?.applications.push(association);
    }
    return documents;
  }

  private findStoredDocument(
    workspaceId: string,
    documentId: string,
  ): StoredDocument | undefined {
    return this.database
      .prepare(
        `${publicDocumentSelect}
         WHERE documents.workspace_id = ? AND documents.id = ?`,
      )
      .get(workspaceId, documentId) as StoredDocument | undefined;
  }

  public createDocument(input: CreateDocumentRecord): DocumentRecord {
    const id = randomUUID();
    const create = this.database.transaction(() => {
      const documentType = this.database
        .prepare(
          `SELECT 1 FROM reference_values
           WHERE workspace_id = ? AND id = ?
             AND category = 'document_type' AND is_active = 1`,
        )
        .pluck()
        .get(input.workspaceId, input.documentTypeId);
      if (documentType === undefined) {
        throw new InvalidDocumentReferenceError();
      }
      for (const applicationId of input.applicationIds) {
        const application = this.database
          .prepare(
            `SELECT 1 FROM applications
             WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
          )
          .pluck()
          .get(input.workspaceId, applicationId);
        if (application === undefined) {
          throw new InvalidDocumentReferenceError();
        }
      }

      const existingObject = this.database
        .prepare(
          `SELECT byte_size AS byteSize, content
           FROM file_objects WHERE sha256 = ?`,
        )
        .get(input.sha256) as StoredFileObject | undefined;
      if (
        existingObject &&
        (existingObject.byteSize !== input.bytes.byteLength ||
          !existingObject.content.equals(Buffer.from(input.bytes)))
      ) {
        throw new DocumentContentConflictError();
      }
      const workspaceUsage = this.database
        .prepare(
          `SELECT
             (SELECT COALESCE(SUM(file_objects.byte_size), 0)
                FROM file_objects
               WHERE file_objects.sha256 IN (
                 SELECT documents.file_sha256
                   FROM documents
                  WHERE documents.workspace_id = ?
                  GROUP BY documents.file_sha256
               )) AS bytes,
             (SELECT COUNT(*) FROM documents WHERE workspace_id = ?) AS documents`,
        )
        .get(input.workspaceId, input.workspaceId) as StoredUsage;
      const installationUsage = this.database
        .prepare(
          `SELECT
             COALESCE(SUM(file_objects.byte_size), 0) AS bytes,
             (SELECT COUNT(*) FROM documents) AS documents
           FROM file_objects`,
        )
        .get() as StoredUsage;
      const workspaceAlreadyUsesObject =
        this.database
          .prepare(
            `SELECT 1 FROM documents
             WHERE workspace_id = ? AND file_sha256 = ? LIMIT 1`,
          )
          .pluck()
          .get(input.workspaceId, input.sha256) !== undefined;
      const addedWorkspaceBytes = workspaceAlreadyUsesObject
        ? 0
        : input.bytes.byteLength;
      const addedInstallationBytes = existingObject
        ? 0
        : input.bytes.byteLength;
      if (
        workspaceUsage.bytes + addedWorkspaceBytes >
          this.storagePolicy.maxWorkspaceBytes ||
        workspaceUsage.documents + 1 >
          this.storagePolicy.maxWorkspaceDocuments ||
        installationUsage.bytes + addedInstallationBytes >
          this.storagePolicy.maxInstallationBytes ||
        installationUsage.documents + 1 >
          this.storagePolicy.maxInstallationDocuments
      ) {
        throw new DocumentStorageQuotaExceededError();
      }

      this.database
        .prepare(
          `INSERT INTO file_objects
             (sha256, byte_size, content, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(sha256) DO NOTHING`,
        )
        .run(
          input.sha256,
          input.bytes.byteLength,
          Buffer.from(input.bytes),
          input.createdAt,
        );
      const storedObject = this.database
        .prepare(
          `SELECT byte_size AS byteSize, content
           FROM file_objects WHERE sha256 = ?`,
        )
        .get(input.sha256) as StoredFileObject | undefined;
      if (
        !storedObject ||
        storedObject.byteSize !== input.bytes.byteLength ||
        !storedObject.content.equals(Buffer.from(input.bytes))
      ) {
        throw new DocumentContentConflictError();
      }

      this.database
        .prepare(
          `INSERT INTO documents
             (id, workspace_id, file_sha256, document_type_reference_id,
              original_filename, media_type, uploaded_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.workspaceId,
          input.sha256,
          input.documentTypeId,
          input.originalFilename,
          input.mediaType,
          input.uploadedByUserId,
          input.createdAt,
        );
      const insertAssociation = this.database.prepare(
        `INSERT INTO application_documents
           (workspace_id, application_id, document_id,
            associated_by_user_id, associated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const applicationId of input.applicationIds) {
        insertAssociation.run(
          input.workspaceId,
          applicationId,
          id,
          input.uploadedByUserId,
          input.createdAt,
        );
      }

      const stored = this.findStoredDocument(input.workspaceId, id);
      if (!stored) throw new Error("Created document could not be read");
      const [created] = this.hydrate(input.workspaceId, [stored]);
      if (!created) throw new Error("Created document could not be hydrated");
      return created;
    });
    return create.immediate();
  }

  public findEquivalentDocument(
    input: EquivalentDocumentInput,
  ): DocumentRecord | undefined {
    const applicationIds = [...input.applicationIds].sort();
    const candidates = this.database
      .prepare(
        `SELECT documents.id
           FROM documents
          WHERE documents.workspace_id = ?
            AND documents.file_sha256 = ?
            AND documents.document_type_reference_id = ?
            AND documents.original_filename = ?
            AND documents.media_type = ?
          ORDER BY documents.created_at, documents.id`,
      )
      .pluck()
      .all(
        input.workspaceId,
        input.sha256,
        input.documentTypeId,
        input.originalFilename,
        input.mediaType,
      ) as string[];
    for (const documentId of candidates) {
      const stored = this.findStoredDocument(input.workspaceId, documentId);
      if (!stored) continue;
      const [document] = this.hydrate(input.workspaceId, [stored]);
      if (
        document &&
        JSON.stringify(document.applications.map(({ id }) => id).sort()) ===
          JSON.stringify(applicationIds)
      ) {
        return document;
      }
    }
    return undefined;
  }

  public listDocuments(workspaceId: string): DocumentRecord[] {
    const stored = this.database
      .prepare(
        `${publicDocumentSelect}
         WHERE documents.workspace_id = ?
         ORDER BY documents.created_at DESC, documents.id DESC`,
      )
      .all(workspaceId) as StoredDocument[];
    return this.hydrate(workspaceId, stored);
  }

  public getDocumentChunk(
    workspaceId: string,
    documentId: string,
    offset: number,
    maxBytes: number,
  ): DocumentContentChunk | undefined {
    const stored = this.findStoredDocument(workspaceId, documentId);
    if (!stored) return undefined;
    const chunk = this.database
      .prepare(
        `SELECT
           file_objects.sha256,
           substr(file_objects.content, ?, ?) AS content
         FROM documents
         JOIN file_objects ON file_objects.sha256 = documents.file_sha256
         WHERE documents.workspace_id = ? AND documents.id = ?`,
      )
      .get(offset + 1, maxBytes, workspaceId, documentId) as
      StoredDocumentChunk | undefined;
    if (!chunk || !Buffer.isBuffer(chunk.content)) return undefined;
    const [document] = this.hydrate(workspaceId, [stored]);
    if (!document) return undefined;
    return { bytes: chunk.content, document, sha256: chunk.sha256 };
  }

  public getDocumentOriginal(
    workspaceId: string,
    documentId: string,
  ): DocumentOriginal | undefined {
    const stored = this.findStoredDocument(workspaceId, documentId);
    if (!stored) return undefined;
    const content = this.database
      .prepare(
        `SELECT file_objects.content
         FROM documents
         JOIN file_objects ON file_objects.sha256 = documents.file_sha256
         WHERE documents.workspace_id = ? AND documents.id = ?`,
      )
      .pluck()
      .get(workspaceId, documentId);
    if (!Buffer.isBuffer(content)) return undefined;
    const [document] = this.hydrate(workspaceId, [stored]);
    if (!document) return undefined;
    return { bytes: content, document };
  }
}
