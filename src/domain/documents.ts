import { z } from "zod";

import { applicationIdSchema } from "./applications.js";
import { referenceValueIdSchema } from "./reference_values.js";

export const documentIdSchema = z.uuid();

const previewMediaTypeByExtension: Readonly<Record<string, string>> = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
  ".pdf": "application/pdf",
};

export function normalizeDocumentMediaType(
  originalFilename: string,
  declaredMediaType: string,
): string {
  const normalizedDeclared = declaredMediaType.trim().toLowerCase();
  const extensionIndex = originalFilename.lastIndexOf(".");
  const extension =
    extensionIndex >= 0
      ? originalFilename.slice(extensionIndex).toLowerCase()
      : "";
  return previewMediaTypeByExtension[extension] ?? normalizedDeclared;
}

const safeFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      }),
  );

const mediaTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(127)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/);

export const documentUploadMetadataSchema = z.strictObject({
  applicationIds: z
    .array(applicationIdSchema)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  documentTypeId: referenceValueIdSchema,
  mediaType: mediaTypeSchema,
  originalFilename: safeFilenameSchema,
});

export type DocumentUploadMetadata = z.infer<
  typeof documentUploadMetadataSchema
>;
