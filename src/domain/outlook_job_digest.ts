import { z } from "zod";

export const processOutlookJobDigestSchema = z.strictObject({
  connection: z.string().trim().min(1).max(254),
  messageId: z.string().trim().min(1).max(998),
  offset: z.number().int().min(0).max(19).default(0),
});

export type ProcessOutlookJobDigestInput = z.infer<
  typeof processOutlookJobDigestSchema
>;
