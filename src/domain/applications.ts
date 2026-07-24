import { z } from "zod";
import { referenceValueIdSchema } from "./reference_values.js";

export const applicationIdSchema = z.uuid();
export const workArrangementSchema = z.enum(["hybrid", "remote", "office"]);

const maximumApplicationRelations = 10;

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(maximumLength: number) {
  return z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(maximumLength).optional(),
  );
}

function blankToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

function nullableText(maximumLength: number) {
  return z.preprocess(
    blankToNull,
    z.string().trim().min(1).max(maximumLength).nullable(),
  );
}

const applicationContactSchema = z.strictObject({
  email: z.preprocess(
    blankToUndefined,
    z.string().trim().email().max(254).optional(),
  ),
  name: z.string().trim().min(1).max(160),
  phone: optionalText(50),
  role: optionalText(160),
});

const applicationLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  url: z
    .url({ protocol: /^https?$/ })
    .trim()
    .max(2048),
});

export const createApplicationSchema = z.strictObject({
  agency: optionalText(160),
  appliedOn: z.preprocess(blankToUndefined, z.iso.date().optional()),
  companyName: z.string().trim().min(1).max(160),
  contacts: z
    .array(applicationContactSchema)
    .max(maximumApplicationRelations)
    .optional(),
  links: z
    .array(applicationLinkSchema)
    .max(maximumApplicationRelations)
    .optional(),
  location: optionalText(160),
  nextAction: optionalText(500),
  nextActionDue: z.preprocess(blankToUndefined, z.iso.date().optional()),
  notes: optionalText(5000),
  rating: z.number().int().min(1).max(5).optional(),
  roleTypeId: referenceValueIdSchema.optional(),
  roleTitle: z.string().trim().min(1).max(160),
  salary: optionalText(160),
  sourceId: referenceValueIdSchema.optional(),
  sourceUrl: z.preprocess(
    blankToUndefined,
    z
      .url({ protocol: /^https?$/ })
      .trim()
      .max(2048)
      .optional(),
  ),
  statusId: referenceValueIdSchema,
  workArrangement: workArrangementSchema.optional(),
});

const applicationUpdateFields = {
  agency: nullableText(160).optional(),
  appliedOn: z.preprocess(blankToNull, z.iso.date().nullable()).optional(),
  companyName: z.string().trim().min(1).max(160).optional(),
  contacts: z
    .array(applicationContactSchema)
    .max(maximumApplicationRelations)
    .optional(),
  links: z
    .array(applicationLinkSchema)
    .max(maximumApplicationRelations)
    .optional(),
  location: nullableText(160).optional(),
  nextAction: nullableText(500).optional(),
  nextActionDue: z.preprocess(blankToNull, z.iso.date().nullable()).optional(),
  notes: nullableText(5000).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  roleTypeId: referenceValueIdSchema.nullable().optional(),
  roleTitle: z.string().trim().min(1).max(160).optional(),
  salary: nullableText(160).optional(),
  sourceId: referenceValueIdSchema.nullable().optional(),
  sourceUrl: z
    .preprocess(
      blankToNull,
      z
        .url({ protocol: /^https?$/ })
        .trim()
        .max(2048)
        .nullable(),
    )
    .optional(),
  statusId: referenceValueIdSchema.optional(),
  workArrangement: workArrangementSchema.nullable().optional(),
};

export const applicationChangesSchema = z
  .strictObject(applicationUpdateFields)
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one application field must be supplied",
  });

export const updateApplicationSchema = z
  .strictObject({
    ...applicationUpdateFields,
    expectedUpdatedAt: z.iso.datetime(),
  })
  .refine(
    (input) =>
      Object.keys(input).some((field) => field !== "expectedUpdatedAt"),
    { message: "At least one application field must be supplied" },
  );

export type ApplicationContactInput = z.infer<typeof applicationContactSchema>;
export type ApplicationLinkInput = z.infer<typeof applicationLinkSchema>;
export type ApplicationChangesInput = z.infer<typeof applicationChangesSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
export type WorkArrangement = z.infer<typeof workArrangementSchema>;
