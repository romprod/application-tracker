import { describe, expect, it } from "vitest";

import { documentIdSchema, documentUploadMetadataSchema } from "./documents.js";

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
});
