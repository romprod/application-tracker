import { z } from "zod";
import { referenceValueIdSchema } from "./reference_values.js";

export const applicationIdSchema = z.uuid();
export const workArrangementSchema = z.enum(["hybrid", "remote", "office"]);

export const maximumApplicationRelations = 10;

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

export const applicationContactSchema = z.strictObject({
  email: z.preprocess(
    blankToUndefined,
    z.string().trim().email().max(254).optional(),
  ),
  name: z.string().trim().min(1).max(160),
  phone: optionalText(50),
  role: optionalText(160),
});

export const applicationLinkSchema = z.strictObject({
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

export const applicationMergeFieldSchema = z.enum([
  "agency",
  "appliedOn",
  "companyName",
  "location",
  "nextAction",
  "nextActionDue",
  "notes",
  "rating",
  "roleTypeId",
  "roleTitle",
  "salary",
  "sourceId",
  "sourceUrl",
  "statusId",
  "workArrangement",
]);

export const applicationMergeResolutionsSchema = z.strictObject({
  contacts: z
    .array(applicationContactSchema)
    .max(maximumApplicationRelations)
    .optional(),
  fields: z
    .partialRecord(applicationMergeFieldSchema, z.enum(["source", "target"]))
    .optional(),
  links: z
    .array(applicationLinkSchema)
    .max(maximumApplicationRelations)
    .optional(),
});

const applicationMergeIdentitySchema = {
  sourceApplicationId: applicationIdSchema,
  targetApplicationId: applicationIdSchema,
};

export const mergeApplicationsSchema = z
  .discriminatedUnion("mode", [
    z.strictObject({
      ...applicationMergeIdentitySchema,
      mode: z.literal("preview"),
      resolutions: applicationMergeResolutionsSchema.optional(),
    }),
    z.strictObject({
      ...applicationMergeIdentitySchema,
      confirm: z.literal(true),
      expectedSourceUpdatedAt: z.iso.datetime(),
      expectedTargetUpdatedAt: z.iso.datetime(),
      mode: z.literal("apply"),
      resolutions: applicationMergeResolutionsSchema,
    }),
  ])
  .refine(
    ({ sourceApplicationId, targetApplicationId }) =>
      sourceApplicationId !== targetApplicationId,
    {
      message: "Source and target applications must be different",
      path: ["sourceApplicationId"],
    },
  );

export const auditDuplicateApplicationsSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
});

export type ApplicationContactInput = z.infer<typeof applicationContactSchema>;
export type ApplicationLinkInput = z.infer<typeof applicationLinkSchema>;
export type ApplicationChangesInput = z.infer<typeof applicationChangesSchema>;
export type ApplicationMergeField = z.infer<typeof applicationMergeFieldSchema>;
export type ApplicationMergeResolutions = z.infer<
  typeof applicationMergeResolutionsSchema
>;
export type AuditDuplicateApplicationsInput = z.infer<
  typeof auditDuplicateApplicationsSchema
>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type MergeApplicationsInput = z.infer<typeof mergeApplicationsSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
export type WorkArrangement = z.infer<typeof workArrangementSchema>;
