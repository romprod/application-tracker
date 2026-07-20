import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  DocumentLibraryService,
  DocumentNotFoundError,
  InvalidDocumentContentError,
  type DocumentsRepository,
} from "./documents.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "member", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};
const documentTypeId = "11111111-1111-4111-8111-111111111111";

function documentRecord() {
  return {
    applications: [],
    byteSize: 7,
    createdAt: "2026-07-19T10:00:00.000Z",
    documentType: "CV",
    documentTypeId,
    id: "22222222-2222-4222-8222-222222222222",
    mediaType: "application/pdf",
    originalFilename: "Product CV.pdf",
    uploadedByDisplayName: "Alex",
  };
}

function repository() {
  const createDocument = vi.fn<DocumentsRepository["createDocument"]>(() =>
    documentRecord(),
  );
  const getDocumentOriginal = vi.fn<DocumentsRepository["getDocumentOriginal"]>(
    () => ({ bytes: Buffer.from("pdf-data"), document: documentRecord() }),
  );
  const findEquivalentDocument = vi.fn<
    DocumentsRepository["findEquivalentDocument"]
  >(() => undefined);
  const listDocuments = vi.fn<DocumentsRepository["listDocuments"]>(() => [
    documentRecord(),
  ]);
  return {
    createDocument,
    findEquivalentDocument,
    getDocumentOriginal,
    listDocuments,
    repository: {
      createDocument,
      findEquivalentDocument,
      getDocumentOriginal,
      listDocuments,
    },
  };
}

describe("DocumentLibraryService", () => {
  it("hashes content and stores metadata inside the actor's workspace", () => {
    const store = repository();
    const service = new DocumentLibraryService(
      store.repository,
      { maxUploadBytes: 1024 },
      () => new Date("2026-07-19T10:00:00.000Z"),
    );
    const bytes = Buffer.from("pdf-data");

    expect(
      service.uploadDocument(actor, {
        applicationIds: [],
        bytes,
        documentTypeId,
        mediaType: "application/pdf",
        originalFilename: "Product CV.pdf",
      }),
    ).toEqual(documentRecord());
    expect(store.createDocument).toHaveBeenCalledWith({
      applicationIds: [],
      bytes,
      createdAt: "2026-07-19T10:00:00.000Z",
      documentTypeId,
      mediaType: "application/pdf",
      originalFilename: "Product CV.pdf",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedByUserId: "user-1",
      workspaceId: "workspace-1",
    });
  });

  it("rejects empty and oversized content before storage", () => {
    const store = repository();
    const service = new DocumentLibraryService(store.repository, {
      maxUploadBytes: 8,
    });
    const input = {
      applicationIds: [],
      documentTypeId,
      mediaType: "application/pdf",
      originalFilename: "Product CV.pdf",
    };

    expect(() =>
      service.uploadDocument(actor, { ...input, bytes: Buffer.alloc(0) }),
    ).toThrow(InvalidDocumentContentError);
    expect(() =>
      service.uploadDocument(actor, { ...input, bytes: Buffer.alloc(9) }),
    ).toThrow(InvalidDocumentContentError);
    expect(store.createDocument).not.toHaveBeenCalled();
  });

  it("imports hash-verified documents idempotently", () => {
    const store = repository();
    const service = new DocumentLibraryService(
      store.repository,
      { maxUploadBytes: 1024 },
      () => new Date("2026-07-19T10:00:00.000Z"),
    );
    const bytes = Buffer.from("pdf-data");
    const input = {
      applicationIds: [],
      bytes,
      documentTypeId,
      mediaType: "application/pdf",
      originalFilename: "Product CV.pdf",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };

    store.findEquivalentDocument.mockReturnValue(documentRecord());
    expect(service.importDocument(actor, input)).toEqual(documentRecord());
    expect(store.createDocument).not.toHaveBeenCalled();

    store.findEquivalentDocument.mockReturnValue(undefined);
    expect(service.importDocument(actor, input)).toEqual(documentRecord());
    expect(store.createDocument).toHaveBeenCalledOnce();
    expect(() =>
      service.importDocument(actor, { ...input, sha256: "0".repeat(64) }),
    ).toThrow(InvalidDocumentContentError);
  });

  it("lists and downloads only through the actor's workspace scope", () => {
    const store = repository();
    const service = new DocumentLibraryService(store.repository, {
      maxUploadBytes: 1024,
    });

    expect(service.listDocuments(actor)).toEqual([documentRecord()]);
    expect(store.listDocuments).toHaveBeenCalledWith("workspace-1");
    expect(
      service.getDocumentOriginal(
        actor,
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toMatchObject({ bytes: Buffer.from("pdf-data") });
    expect(store.getDocumentOriginal).toHaveBeenCalledWith(
      "workspace-1",
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("hides missing and cross-workspace originals behind one error", () => {
    const store = repository();
    store.getDocumentOriginal.mockReturnValue(undefined);
    const service = new DocumentLibraryService(store.repository, {
      maxUploadBytes: 1024,
    });

    expect(() =>
      service.getDocumentOriginal(
        actor,
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toThrow(DocumentNotFoundError);
  });
});
