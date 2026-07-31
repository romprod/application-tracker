import { z } from "zod";

import { applicationIdSchema } from "./applications.js";

export const applicationAttentionLifecycleSchema = z.enum([
  "active",
  "all",
  "terminal",
]);
export const applicationAttentionNextActionSchema = z.enum([
  "missing",
  "overdue",
]);
export const applicationAttentionMissingFieldSchema = z.enum([
  "applied_date",
  "contacts",
  "email_evidence",
  "location",
  "salary",
  "source_url",
  "work_arrangement",
]);
export const applicationAttentionMissingEvidenceSchema = z.enum([
  "application_confirmation",
  "original_advert",
]);
export const applicationAttentionFieldStateSchema = z.enum([
  "conflicting",
  "inferred_unverified",
  "missing",
  "not_applicable",
  "not_disclosed",
  "stale",
]);
export const applicationAttentionReasonCodeSchema = z.enum([
  "next_action_overdue",
  "next_action_missing",
  "salary_missing",
  "location_missing",
  "work_arrangement_missing",
  "source_url_missing",
  "applied_date_missing",
  "contacts_missing",
  "email_evidence_missing",
  "original_advert_missing",
  "application_confirmation_missing",
  "duplicate_risk",
  "field_not_disclosed",
  "field_not_applicable",
  "field_conflicting",
  "field_stale",
  "field_inferred_unverified",
]);

function uniqueArray<Schema extends z.ZodType>(
  schema: Schema,
  maximum: number,
) {
  return z
    .array(schema)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, {
      message: "Filter values must be unique",
    });
}

export const applicationAttentionQuerySchema = z
  .strictObject({
    appliedFrom: z.iso.date().optional(),
    appliedTo: z.iso.date().optional(),
    attentionOnly: z.boolean().default(true),
    duplicateRisk: z.boolean().optional(),
    fieldStates: uniqueArray(
      applicationAttentionFieldStateSchema,
      6,
    ).optional(),
    lifecycle: applicationAttentionLifecycleSchema.default("all"),
    limit: z.number().int().min(1).max(100).default(25),
    missingEvidence: uniqueArray(
      applicationAttentionMissingEvidenceSchema,
      2,
    ).optional(),
    missingFields: uniqueArray(
      applicationAttentionMissingFieldSchema,
      7,
    ).optional(),
    nextAction: applicationAttentionNextActionSchema.optional(),
    offset: z.number().int().nonnegative().max(1_000_000).default(0),
    query: z.string().trim().min(1).max(160).optional(),
    reasonCodes: uniqueArray(
      applicationAttentionReasonCodeSchema,
      17,
    ).optional(),
    statusIds: uniqueArray(applicationIdSchema, 20).optional(),
    updatedFrom: z.iso.datetime().optional(),
    updatedTo: z.iso.datetime().optional(),
  })
  .superRefine((input, context) => {
    if (
      input.appliedFrom !== undefined &&
      input.appliedTo !== undefined &&
      input.appliedFrom > input.appliedTo
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied date range is inverted",
        path: ["appliedFrom"],
      });
    }
    if (
      input.updatedFrom !== undefined &&
      input.updatedTo !== undefined &&
      input.updatedFrom > input.updatedTo
    ) {
      context.addIssue({
        code: "custom",
        message: "Updated date range is inverted",
        path: ["updatedFrom"],
      });
    }
  });

export type ApplicationAttentionFieldState = z.infer<
  typeof applicationAttentionFieldStateSchema
>;
export type ApplicationAttentionMissingEvidence = z.infer<
  typeof applicationAttentionMissingEvidenceSchema
>;
export type ApplicationAttentionMissingField = z.infer<
  typeof applicationAttentionMissingFieldSchema
>;
export type ApplicationAttentionQueryInput = z.infer<
  typeof applicationAttentionQuerySchema
>;
export type ApplicationAttentionReasonCode = z.infer<
  typeof applicationAttentionReasonCodeSchema
>;
