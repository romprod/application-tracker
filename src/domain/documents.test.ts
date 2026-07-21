import { describe, expect, it } from "vitest";

import {
  documentIdSchema,
  documentUploadMetadataSchema,
  normalizeDocumentMediaType,
} from "./documents.js";

const documentTypeId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";

describe("document schemas", () => {
  it("normalizes bounded upload metadata", () => {
    expect(
      documentUploadMetadataSchema.parse({
        applicationIds: [applicationId],
        documentTypeId,
        mediaType: "application/pdf",
        originalFilename: "  Product CV.pdf  ",
      }),
    ).toEqual({
      applicationIds: [applicationId],
      documentTypeId,
      mediaType: "application/pdf",
      originalFilename: "Product CV.pdf",
    });
  });

  it("rejects unsafe filenames, duplicate associations, and invalid media types", () => {
    expect(
      documentUploadMetadataSchema.safeParse({
        applicationIds: [],
        documentTypeId,
        mediaType: "application/pdf",
        originalFilename: "../private.pdf",
      }).success,
    ).toBe(false);
    expect(
      documentUploadMetadataSchema.safeParse({
        applicationIds: [applicationId, applicationId],
        documentTypeId,
        mediaType: "application/pdf",
        originalFilename: "Product CV.pdf",
      }).success,
    ).toBe(false);
    expect(
      documentUploadMetadataSchema.safeParse({
        applicationIds: [],
        documentTypeId,
        mediaType: "text/html\r\nX-Unsafe: yes",
        originalFilename: "notes.txt",
      }).success,
    ).toBe(false);
  });

  it("requires UUID document identifiers", () => {
    expect(documentIdSchema.safeParse(documentTypeId).success).toBe(true);
    expect(documentIdSchema.safeParse("../document").success).toBe(false);
  });

  it("normalizes browser upload types from supported filename extensions", () => {
    expect(normalizeDocumentMediaType("reply.MSG", "")).toBe(
      "application/vnd.ms-outlook",
    );
    expect(
      normalizeDocumentMediaType("reply.eml", "application/octet-stream"),
    ).toBe("message/rfc822");
    expect(normalizeDocumentMediaType("cover.docx", "application/zip")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(
      normalizeDocumentMediaType("cv.pdf", "application/octet-stream"),
    ).toBe("application/pdf");
    expect(normalizeDocumentMediaType("notes.txt", "text/plain")).toBe(
      "text/plain",
    );
  });
});
