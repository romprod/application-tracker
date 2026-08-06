import { z } from "zod";

export const reviewNewOutlookJobDigestsSchema = z.strictObject({
  connection: z.string().trim().min(1).max(254),
});

export type ReviewNewOutlookJobDigestsInput = z.infer<
  typeof reviewNewOutlookJobDigestsSchema
>;
