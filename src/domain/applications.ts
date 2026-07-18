import { z } from "zod";

export const applicationStatusSchema = z.enum([
  "prospect",
  "applied",
  "interview",
  "offer",
  "closed",
]);

export const applicationIdSchema = z.uuid();

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

export const createApplicationSchema = z.strictObject({
  appliedOn: z.preprocess(blankToUndefined, z.iso.date().optional()),
  companyName: z.string().trim().min(1).max(160),
  location: optionalText(160),
  notes: optionalText(5000),
  roleTitle: z.string().trim().min(1).max(160),
  sourceUrl: z.preprocess(
    blankToUndefined,
    z
      .url({ protocol: /^https?$/ })
      .trim()
      .max(2048)
      .optional(),
  ),
  status: applicationStatusSchema.default("prospect"),
});

export const updateApplicationSchema = z
  .strictObject({
    appliedOn: z.preprocess(blankToNull, z.iso.date().nullable()).optional(),
    companyName: z.string().trim().min(1).max(160).optional(),
    location: nullableText(160).optional(),
    notes: nullableText(5000).optional(),
    roleTitle: z.string().trim().min(1).max(160).optional(),
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
    status: applicationStatusSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one application field must be supplied",
  });

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
