import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DocumentStorageQuotaExceededError,
  InvalidDocumentReferenceError,
} from "../../application/documents.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteApplicationsRepository } from "./applications_repository.js";
import { SqliteDocumentsRepository } from "./documents_repository.js";
import { SqliteDocumentPreviewsRepository } from "./document_previews_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

const createdAt = "2026-07-19T10:00:00.000Z";

function createRepository() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: createdAt,
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  const reference = (category: "document_type" | "status", label: string) => {
    const id = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = ? AND label = ?`,
      )
      .pluck()
      .get(setup.workspace.id, category, label);
    if (typeof id !== "string") throw new Error("Missing test reference");
    return id;
  };
  const application = new SqliteApplicationsRepository(
    database,
  ).createApplication({
    appliedOn: null,
    companyName: "Example Studio",
    createdAt,
    createdByUserId: setup.administrator.id,
    location: null,
    nextAction: null,
    nextActionDue: null,
    notes: null,
    roleTitle: "Product Designer",
    sourceUrl: null,
    statusId: reference("status", "Applied"),
    workspaceId: setup.workspace.id,
  });
  return {
    application,
    database,
    documentTypeId: reference("document_type", "CV"),
    repository: new SqliteDocumentsRepository(database, {
      maxInstallationBytes: 2_147_483_648,
      maxInstallationDocuments: 10_000,
      maxWorkspaceBytes: 536_870_912,
      maxWorkspaceDocuments: 2_000,
    }),
    setup,
  };
}

describe("SqliteDocumentsRepository", () => {
  it("enforces byte and document quotas atomically while charging duplicate bytes once", () => {
    const { database, documentTypeId, setup } = createRepository();
    const repository = new SqliteDocumentsRepository(database, {
      maxInstallationBytes: 10,
      maxInstallationDocuments: 2,
      maxWorkspaceBytes: 10,
      maxWorkspaceDocuments: 2,
    });
    const firstBytes = Buffer.from("123456");
    const input = {
      applicationIds: [],
      createdAt,
      documentTypeId,
      mediaType: "text/plain",
      originalFilename: "notes.txt",
      uploadedByUserId: setup.administrator.id,
      workspaceId: setup.workspace.id,
    };

    try {
      repository.createDocument({
        ...input,
        bytes: firstBytes,
        sha256: createHash("sha256").update(firstBytes).digest("hex"),
      });
      repository.createDocument({
        ...input,
        bytes: firstBytes,
        originalFilename: "duplicate.txt",
        sha256: createHash("sha256").update(firstBytes).digest("hex"),
      });

      expect(
        database
          .prepare("SELECT sum(byte_size) FROM file_objects")
          .pluck()
          .get(),
      ).toBe(6);
      expect(
        database.prepare("SELECT count(*) FROM documents").pluck().get(),
      ).toBe(2);

      const uniqueBytes = Buffer.from("abcde");
      expect(() =>
        repository.createDocument({
          ...input,
          bytes: uniqueBytes,
          originalFilename: "over-quota.txt",
          sha256: createHash("sha256").update(uniqueBytes).digest("hex"),
        }),
      ).toThrow(DocumentStorageQuotaExceededError);
      expect(
        database
          .prepare("SELECT sum(byte_size) FROM file_objects")
          .pluck()
          .get(),
      ).toBe(6);
      expect(
        database.prepare("SELECT count(*) FROM documents").pluck().get(),
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  it("deduplicates bytes while retaining distinct workspace metadata", () => {
    const { application, database, documentTypeId, repository, setup } =
      createRepository();
    const bytes = Buffer.from("synthetic-pdf-data");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    try {
      const first = repository.createDocument({
        applicationIds: [application.id],
        bytes,
        createdAt,
        documentTypeId,
        mediaType: "application/pdf",
        originalFilename: "Product CV.pdf",
        sha256,
        uploadedByUserId: setup.administrator.id,
        workspaceId: setup.workspace.id,
      });
      const second = repository.createDocument({
        applicationIds: [],
        bytes,
        createdAt: "2026-07-19T11:00:00.000Z",
        documentTypeId,
        mediaType: "application/pdf",
        originalFilename: "Product CV revised name.pdf",
        sha256,
        uploadedByUserId: setup.administrator.id,
        workspaceId: setup.workspace.id,
      });

      expect(first).toMatchObject({
        applications: [
          {
            companyName: "Example Studio",
            id: application.id,
            roleTitle: "Product Designer",
          },
        ],
        byteSize: bytes.length,
        documentType: "CV",
        originalFilename: "Product CV.pdf",
        uploadedByDisplayName: "Alex Example",
      });
      expect(repository.listDocuments(setup.workspace.id)).toEqual([
        second,
        first,
      ]);
      expect(
        database.prepare("SELECT count(*) FROM file_objects").pluck().get(),
      ).toBe(1);
      expect(
        database.prepare("SELECT count(*) FROM documents").pluck().get(),
      ).toBe(2);
      expect(
        repository.getDocumentOriginal(setup.workspace.id, first.id),
      ).toEqual({ bytes, document: first });
      expect(repository.getDocumentOriginal("other-workspace", first.id)).toBe(
        undefined,
      );
    } finally {
      database.close();
    }
  });

  it("reads only the requested document byte range with the stored digest", () => {
    const { database, documentTypeId, repository, setup } = createRepository();
    const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    try {
      const document = repository.createDocument({
        applicationIds: [],
        bytes,
        createdAt,
        documentTypeId,
        mediaType: "text/plain",
        originalFilename: "alphabet.txt",
        sha256,
        uploadedByUserId: setup.administrator.id,
        workspaceId: setup.workspace.id,
      });

      expect(
        repository.getDocumentChunk(setup.workspace.id, document.id, 10, 7),
      ).toEqual({
        bytes: Buffer.from("abcdefg"),
        document,
        sha256,
      });
      expect(
        repository.getDocumentChunk(
          setup.workspace.id,
          document.id,
          bytes.byteLength,
          7,
        ),
      ).toEqual({ bytes: Buffer.alloc(0), document, sha256 });
      expect(
        repository.getDocumentChunk("other-workspace", document.id, 0, 7),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("rejects unknown, cross-category, and removed application references", () => {
    const { application, database, documentTypeId, repository, setup } =
      createRepository();
    const bytes = Buffer.from("synthetic-pdf-data");
    const input = {
      applicationIds: [application.id],
      bytes,
      createdAt,
      documentTypeId,
      mediaType: "application/pdf",
      originalFilename: "Product CV.pdf",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedByUserId: setup.administrator.id,
      workspaceId: setup.workspace.id,
    };

    try {
      expect(() =>
        repository.createDocument({
          ...input,
          documentTypeId: "missing-document-type",
        }),
      ).toThrow(InvalidDocumentReferenceError);

      database
        .prepare(
          `UPDATE applications SET deleted_at = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(
          "2026-07-19T12:00:00.000Z",
          "2026-07-19T12:00:00.000Z",
          setup.workspace.id,
          application.id,
        );
      expect(() => repository.createDocument(input)).toThrow(
        InvalidDocumentReferenceError,
      );
      expect(
        database.prepare("SELECT count(*) FROM file_objects").pluck().get(),
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("treats SQL control text as metadata rather than executable SQL", () => {
    const { database, documentTypeId, repository, setup } = createRepository();
    const originalFilename = "CV'); DROP TABLE documents; --.pdf";
    const bytes = Buffer.from("synthetic-pdf-data");

    try {
      const created = repository.createDocument({
        applicationIds: [],
        bytes,
        createdAt,
        documentTypeId,
        mediaType: "application/pdf",
        originalFilename,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        uploadedByUserId: setup.administrator.id,
        workspaceId: setup.workspace.id,
      });

      expect(created.originalFilename).toBe(originalFilename);
      expect(repository.listDocuments(setup.workspace.id)).toHaveLength(1);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
          )
          .pluck()
          .get(),
      ).toBe("documents");
    } finally {
      database.close();
    }
  });

  it("stores bounded preview text under the document workspace", () => {
    const { database, documentTypeId, repository, setup } = createRepository();
    const bytes = Buffer.from("Preview text");

    try {
      const document = repository.createDocument({
        applicationIds: [],
        bytes,
        createdAt,
        documentTypeId,
        mediaType: "text/plain",
        originalFilename: "notes.txt",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        uploadedByUserId: setup.administrator.id,
        workspaceId: setup.workspace.id,
      });
      const previews = new SqliteDocumentPreviewsRepository(database);
      const stored = previews.saveDocumentPreview({
        documentId: document.id,
        generatedAt: "2026-07-19T12:00:00.000Z",
        mediaType: "text/plain",
        parserVersion: "plain-text-v1",
        status: "ready",
        text: "Text with SQL control: '); DROP TABLE documents; --",
        truncated: false,
        workspaceId: setup.workspace.id,
      });

      expect(
        previews.getDocumentPreview(
          setup.workspace.id,
          document.id,
          "plain-text-v1",
        ),
      ).toEqual(stored);
      expect(
        previews.getDocumentPreview(
          "other-workspace",
          document.id,
          "plain-text-v1",
        ),
      ).toBeUndefined();
      expect(() =>
        previews.saveDocumentPreview({
          ...stored,
          workspaceId: "other-workspace",
        }),
      ).toThrow();
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
          )
          .pluck()
          .get(),
      ).toBe("documents");
    } finally {
      database.close();
    }
  });
});
