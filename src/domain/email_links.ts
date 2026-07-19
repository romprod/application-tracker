import { z } from "zod";

export const emailLinkExtractionInputSchema = z.strictObject({
  content: z.string().min(1).max(200_000),
});

export type EmailLinkExtractionInput = z.infer<
  typeof emailLinkExtractionInputSchema
>;
