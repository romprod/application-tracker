import { z } from "zod";

export const processOutlookJobDigestSchema = z.strictObject({
  connection: z.string().trim().min(1).max(254),
  messageId: z.string().trim().min(1).max(998),
  offset: z.number().int().min(0).max(19).default(0),
});

export type ProcessOutlookJobDigestInput = z.infer<
  typeof processOutlookJobDigestSchema
>;

const maximumHistoricalDigestSearchMessages = 500;
const maximumHistoricalDigestSearchWindowMs = 31 * 24 * 60 * 60 * 1_000;

export const searchOutlookJobDigestsSchema = z
  .strictObject({
    after: z.iso.datetime(),
    before: z.iso.datetime(),
    connection: z.string().trim().min(1).max(254),
    limit: z.number().int().min(1).max(20).default(20),
    offset: z.number().int().min(0).max(499).default(0),
  })
  .superRefine((input, context) => {
    const after = Date.parse(input.after);
    const before = Date.parse(input.before);
    if (after >= before) {
      context.addIssue({
        code: "custom",
        message: "after must be earlier than before",
        path: ["before"],
      });
    }
    if (before - after > maximumHistoricalDigestSearchWindowMs) {
      context.addIssue({
        code: "custom",
        message: "The historical digest search window cannot exceed 31 days",
        path: ["after"],
      });
    }
    if (input.offset + input.limit > maximumHistoricalDigestSearchMessages) {
      context.addIssue({
        code: "custom",
        message:
          "The historical digest search cannot scan more than 500 messages",
        path: ["offset"],
      });
    }
  });

export type SearchOutlookJobDigestsInput = z.infer<
  typeof searchOutlookJobDigestsSchema
>;
