import { z } from "zod";

export const applicationStatusSchema = z.enum([
  "prospect",
  "applied",
  "interview",
  "offer",
  "closed",
]);

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(maximumLength: number) {
  return z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(maximumLength).optional(),
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

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
