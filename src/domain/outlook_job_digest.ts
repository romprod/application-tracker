import { z } from "zod";

export const processOutlookJobDigestSchema = z.strictObject({
  connection: z.string().trim().min(1).max(254),
  messageId: z.string().trim().min(1).max(998),
  offset: z.number().int().min(0).max(19).default(0),
});

export type ProcessOutlookJobDigestInput = z.infer<
  typeof processOutlookJobDigestSchema
>;

export const maximumHistoricalDigestSearchBatchMessages = 500;
export const maximumHistoricalDigestSearchMessages = 100_000;
const maximumHistoricalDigestSearchWindowMs = 31 * 24 * 60 * 60 * 1_000;

const historicalDigestSearchCursorPayloadSchema = z.strictObject({
  after: z.iso.datetime(),
  before: z.iso.datetime(),
  connection: z.string().trim().min(1).max(254),
  limit: z.number().int().min(1).max(20),
  startOffset: z
    .number()
    .int()
    .min(maximumHistoricalDigestSearchBatchMessages)
    .max(
      maximumHistoricalDigestSearchMessages -
        maximumHistoricalDigestSearchBatchMessages,
    )
    .multipleOf(maximumHistoricalDigestSearchBatchMessages),
  version: z.literal(1),
});

export type HistoricalDigestSearchCursorPayload = z.infer<
  typeof historicalDigestSearchCursorPayloadSchema
>;

export function encodeHistoricalDigestSearchCursor(
  payload: HistoricalDigestSearchCursorPayload,
): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeHistoricalDigestSearchCursor(
  cursor: string,
): HistoricalDigestSearchCursorPayload | null {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const parsed = historicalDigestSearchCursorPayloadSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const searchOutlookJobDigestsSchema = z
  .strictObject({
    after: z.iso.datetime(),
    before: z.iso.datetime(),
    connection: z.string().trim().min(1).max(254),
    cursor: z.string().min(1).max(2_048).optional(),
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
  });

export type SearchOutlookJobDigestsInput = z.infer<
  typeof searchOutlookJobDigestsSchema
>;
