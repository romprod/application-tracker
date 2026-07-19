import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  DocumentContentConflictError,
  InvalidDocumentReferenceError,
  type CreateDocumentRecord,
  type DocumentApplicationAssociation,
  type DocumentOriginal,
  type DocumentRecord,
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
  public constructor(private readonly database: Database.Database) {}

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
