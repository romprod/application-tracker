import { describe, expect, it, vi } from "vitest";

import {
  browserDocumentsClient,
  DocumentsClientError,
} from "./documents_client";

const document = {
  applications: [
    {
      companyName: "Example Studio",
      id: "11111111-1111-4111-8111-111111111111",
      roleTitle: "Product Designer",
    },
  ],
  byteSize: 8,
  createdAt: "2026-07-19T10:00:00.000Z",
  documentType: "CV",
  documentTypeId: "22222222-2222-4222-8222-222222222222",
  id: "33333333-3333-4333-8333-333333333333",
  mediaType: "application/pdf",
  originalFilename: "Product CV.pdf",
  uploadedByDisplayName: "Alex Example",
};

describe("browserDocumentsClient", () => {
  it("lists and validates document metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            documents: [document],
            maxUploadBytes: 10_485_760,
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(browserDocumentsClient.listDocuments()).resolves.toEqual({
      documents: [document],
      maxUploadBytes: 10_485_760,
    });
    expect(fetch).toHaveBeenCalledWith("/api/documents", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("uploads a file with bounded metadata and no manual content-type header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ document }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["pdf-data"], "Product CV.pdf", {
      type: "application/pdf",
    });

    await expect(
      browserDocumentsClient.uploadDocument({
        applicationIds: [document.applications[0]!.id],
        documentTypeId: document.documentTypeId,
        file,
      }),
    ).resolves.toEqual(document);
    const call = fetchMock.mock.calls[0] as unknown[] | undefined;
    const options = call?.[1] as RequestInit | undefined;
    expect(call?.[0]).toBe("/api/documents");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({ Accept: "application/json" });
    expect(options?.body).toBeInstanceOf(FormData);
    const form = options?.body as FormData;
    expect(form.get("documentTypeId")).toBe(document.documentTypeId);
    expect(form.get("applicationIds")).toBe(
      JSON.stringify([document.applications[0]!.id]),
    );
    expect(form.get("file")).toBe(file);
  });

  it("reports stable request errors and rejects malformed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { code: "document_too_large" } }),
            { status: 413 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              documents: [{ ...document, byteSize: -1 }],
              maxUploadBytes: 10_485_760,
            }),
            { status: 200 },
          ),
        ),
    );

    await expect(
      browserDocumentsClient.uploadDocument({
        applicationIds: [],
        documentTypeId: document.documentTypeId,
        file: new File(["too-large"], "large.pdf"),
      }),
    ).rejects.toEqual(new DocumentsClientError("document_too_large"));
    await expect(browserDocumentsClient.listDocuments()).rejects.toEqual(
      new DocumentsClientError("invalid_response"),
    );
  });
});
