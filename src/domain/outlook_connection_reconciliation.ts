import { z } from "zod";

export const reconcileOutlookGraphConnectionSchema = z.strictObject({
  connection: z.string().trim().min(1).max(254),
});

export type ReconcileOutlookGraphConnectionInput = z.infer<
  typeof reconcileOutlookGraphConnectionSchema
>;
