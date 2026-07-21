import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  DocumentPreviewService,
  type DocumentPreviewGenerator,
  type DocumentPreviewsRepository,
  type ReadyDocumentPreviewRecord,
} from "./document_previews.js";
import {
  DocumentNotFoundError,
  type DocumentsRepository,
} from "./documents.js";

const actor = { workspaceId: "workspace-1" } as AuthenticatedActor;
const documentId = "22222222-2222-4222-8222-222222222222";
const ready: ReadyDocumentPreviewRecord = {
  documentId,
  generatedAt: "2026-07-19T12:00:00.000Z",
  kind: "text",
  mediaType: "text/plain",
  parserVersion: "document-preview-v3",
  status: "ready",
  text: "Preview text",
  truncated: false,
};

function dependencies(cached?: ReadyDocumentPreviewRecord) {
  const getDocumentOriginal = vi.fn<DocumentsRepository["getDocumentOriginal"]>(
    () => ({
      bytes: Buffer.from("Preview text"),
      document: {
        applications: [],
        byteSize: 12,
        createdAt: "2026-07-19T10:00:00.000Z",
        documentType: "Other",
        documentTypeId: "11111111-1111-4111-8111-111111111111",
        id: documentId,
        mediaType: "text/plain",
        originalFilename: "notes.txt",
        uploadedByDisplayName: "Alex",
      },
    }),
  );
  const getDocumentPreview = vi.fn<
    DocumentPreviewsRepository["getDocumentPreview"]
  >((_workspaceId, _documentId, parserVersion) =>
    cached?.parserVersion === parserVersion ? cached : undefined,
  );
  const saveDocumentPreview = vi.fn<
    DocumentPreviewsRepository["saveDocumentPreview"]
  >((input) => {
    const { workspaceId, ...record } = input;
    void workspaceId;
    return record;
  });
  const generate = vi.fn<DocumentPreviewGenerator["generate"]>(() =>
    Promise.resolve({
      kind: "text",
      mediaType: "text/plain",
      status: "ready",
      text: "Preview text",
      truncated: false,
    }),
  );
  return {
    documents: { getDocumentOriginal } as DocumentsRepository,
    generate,
    generator: { generate },
    getDocumentOriginal,
    getDocumentPreview,
    previews: { getDocumentPreview, saveDocumentPreview },
    saveDocumentPreview,
  };
}

describe("DocumentPreviewService", () => {
  it("coalesces simultaneous cache misses for the same workspace document", async () => {
    const values = dependencies();
    let finishGeneration:
      | ((
          value: Awaited<ReturnType<DocumentPreviewGenerator["generate"]>>,
        ) => void)
      | undefined;
    values.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishGeneration = resolve;
        }),
    );
    const service = new DocumentPreviewService(
      values.documents,
      values.previews,
      values.generator,
      "document-preview-v3",
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    const first = service.getPreview(actor, documentId);
    const second = service.getPreview(actor, documentId);
    await vi.waitFor(() => expect(values.generate).toHaveBeenCalledTimes(1));
    finishGeneration?.({
      kind: "text",
      mediaType: "text/plain",
      status: "ready",
      text: "Preview text",
      truncated: false,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([ready, ready]);
    expect(values.getDocumentOriginal).toHaveBeenCalledTimes(1);
    expect(values.saveDocumentPreview).toHaveBeenCalledTimes(1);
  });

  it("returns a workspace-scoped cached result without reparsing bytes", async () => {
    const values = dependencies(ready);
    const service = new DocumentPreviewService(
      values.documents,
      values.previews,
      values.generator,
      "document-preview-v3",
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    await expect(service.getPreview(actor, documentId)).resolves.toEqual(ready);
    expect(values.getDocumentPreview).toHaveBeenCalledWith(
      "workspace-1",
      documentId,
      "document-preview-v3",
    );
    expect(values.getDocumentOriginal).not.toHaveBeenCalled();
    expect(values.generate).not.toHaveBeenCalled();
  });

  it("regenerates previews cached by an older parser version", async () => {
    const values = dependencies({
      ...ready,
      parserVersion: "document-preview-v2",
      text: "Stale preview text",
    });
    const service = new DocumentPreviewService(
      values.documents,
      values.previews,
      values.generator,
      "document-preview-v3",
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    await expect(service.getPreview(actor, documentId)).resolves.toEqual(ready);
    expect(values.getDocumentPreview).toHaveBeenCalledWith(
      "workspace-1",
      documentId,
      "document-preview-v3",
    );
    expect(values.generate).toHaveBeenCalledTimes(1);
    expect(values.saveDocumentPreview).toHaveBeenCalledWith({
      ...ready,
      workspaceId: "workspace-1",
    });
  });

  it("generates and stores a bounded preview with parser provenance", async () => {
    const values = dependencies();
    const service = new DocumentPreviewService(
      values.documents,
      values.previews,
      values.generator,
      "document-preview-v3",
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    await expect(service.getPreview(actor, documentId)).resolves.toEqual(ready);
    expect(values.generate).toHaveBeenCalledWith(Buffer.from("Preview text"), {
      mediaType: "text/plain",
      originalFilename: "notes.txt",
    });
    expect(values.saveDocumentPreview).toHaveBeenCalledWith({
      ...ready,
      workspaceId: "workspace-1",
    });
  });

  it("reports inline PDFs without caching content", async () => {
    const values = dependencies();
    values.generate.mockResolvedValue({
      mediaType: "application/pdf",
      status: "pdf",
    });
    values.getDocumentOriginal.mockReturnValue({
      bytes: Buffer.from("pdf-data"),
      document: {
        applications: [],
        byteSize: 8,
        createdAt: "2026-07-19T10:00:00.000Z",
        documentType: "CV",
        documentTypeId: "11111111-1111-4111-8111-111111111111",
        id: documentId,
        mediaType: "application/pdf",
        originalFilename: "cv.pdf",
        uploadedByDisplayName: "Alex",
      },
    });
    const service = new DocumentPreviewService(
      values.documents,
      values.previews,
      values.generator,
    );

    await expect(service.getPreview(actor, documentId)).resolves.toEqual({
      documentId,
      mediaType: "application/pdf",
      status: "pdf",
    });
    expect(values.saveDocumentPreview).not.toHaveBeenCalled();
  });

  it("hides missing and cross-workspace documents behind one error", async () => {
    const values = dependencies();
    values.getDocumentOriginal.mockReturnValue(undefined);
    const service = new DocumentPreviewService(
      values.documents,
      values.previews,
      values.generator,
    );

    await expect(service.getPreview(actor, documentId)).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
  });
});
