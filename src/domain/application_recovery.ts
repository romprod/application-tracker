import { z } from "zod";

import { applicationIdSchema } from "./applications.js";

const deletionReasonSchema = z.string().trim().min(3).max(500);

export const deleteApplicationSchema = z.strictObject({
  applicationId: applicationIdSchema,
  reason: deletionReasonSchema,
});

export const listDeletedApplicationsSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().nonnegative().max(1_000_000).default(0),
});

export const previewApplicationRestoreSchema = z.strictObject({
  applicationId: applicationIdSchema,
});

export const restoreApplicationSchema = z.strictObject({
  applicationId: applicationIdSchema,
  confirm: z.literal(true),
  expectedDeletedAt: z.iso.datetime(),
  expectedUpdatedAt: z.iso.datetime(),
});

export const recoverApplicationMergeSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("preview"),
    sourceApplicationId: applicationIdSchema,
  }),
  z.strictObject({
    confirm: z.literal(true),
    expectedSourceUpdatedAt: z.iso.datetime(),
    expectedTargetUpdatedAt: z.iso.datetime(),
    mode: z.literal("apply"),
    sourceApplicationId: applicationIdSchema,
  }),
]);

export type DeleteApplicationInput = z.infer<typeof deleteApplicationSchema>;
export type ListDeletedApplicationsInput = z.infer<
  typeof listDeletedApplicationsSchema
>;
export type PreviewApplicationRestoreInput = z.infer<
  typeof previewApplicationRestoreSchema
>;
export type RecoverApplicationMergeInput = z.infer<
  typeof recoverApplicationMergeSchema
>;
export type RestoreApplicationInput = z.infer<typeof restoreApplicationSchema>;
