import { z } from "zod";

export const applicationStatusSchema = z.enum([
  "prospect",
  "applied",
  "interview",
  "offer",
  "closed",
]);

export const applicationIdSchema = z.uuid();

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
    nextActionDue: z
      .preprocess(blankToNull, z.iso.date().nullable())
      .optional(),
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
export type ApplicationContactInput = z.infer<typeof applicationContactSchema>;
export type ApplicationLinkInput = z.infer<typeof applicationLinkSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
