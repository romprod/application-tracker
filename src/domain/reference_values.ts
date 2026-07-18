import { z } from "zod";

export const referenceCategorySchema = z.enum([
  "status",
  "source",
  "role_type",
  "document_type",
]);

export const referenceValueIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i,
  );

export const createReferenceValueSchema = z
  .strictObject({
    category: referenceCategorySchema,
    isTerminal: z.boolean().default(false),
    label: z.string().trim().min(1).max(80),
  })
  .refine((input) => input.category === "status" || !input.isTerminal, {
    message: "Only statuses can be terminal",
    path: ["isTerminal"],
  });

export const updateReferenceValueSchema = z
  .strictObject({
    isActive: z.boolean().optional(),
    isTerminal: z.boolean().optional(),
    label: z.string().trim().min(1).max(80).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one reference value field must be supplied",
  });

export type ReferenceCategory = z.infer<typeof referenceCategorySchema>;
export type CreateReferenceValueInput = z.infer<
  typeof createReferenceValueSchema
>;
export type UpdateReferenceValueInput = z.infer<
  typeof updateReferenceValueSchema
>;
