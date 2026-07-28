import { z } from "zod";

function folderPathSegments(value: string): string[] | undefined {
  const segments = value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    segments.length < 2 ||
    segments.length > 5 ||
    segments[0]?.toLocaleLowerCase("en") !== "inbox" ||
    segments.some(
      (segment) =>
        segment.length > 128 ||
        [...segment].some((character) => {
          const code = character.charCodeAt(0);
          return code <= 0x1f || code === 0x7f;
        }) ||
        segment === "." ||
        segment === "..",
    )
  ) {
    return undefined;
  }
  return ["Inbox", ...segments.slice(1)];
}

export function parseOutlookFolderPath(value: string): string[] {
  const segments = folderPathSegments(value);
  if (!segments) throw new Error("Invalid Outlook folder path");
  return segments;
}

export function canonicalOutlookFolderPath(value: string): string {
  return parseOutlookFolderPath(value).join("\\");
}

const outlookFolderPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(649)
  .refine((value) => folderPathSegments(value) !== undefined)
  .transform(canonicalOutlookFolderPath);

export const outlookGraphConnectionIdSchema = z.uuid();

const outlookGraphConnectionFields = {
  clientId: z.uuid(),
  folderPath: outlookFolderPathSchema,
  mailbox: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(80),
  tenantId: z.uuid(),
};

export const createOutlookGraphConnectionSchema = z.strictObject({
  ...outlookGraphConnectionFields,
  clientSecret: z.string().min(1).max(4096),
});

export const updateOutlookGraphConnectionSchema = z.strictObject({
  ...outlookGraphConnectionFields,
  clientSecret: z.string().min(1).max(4096).optional(),
});

export const updateOutlookGraphConnectionStateSchema = z.strictObject({
  enabled: z.boolean(),
});

export const deleteOutlookGraphConnectionSchema = z.strictObject({
  confirm: z.literal(true),
  expectedAssignedApplicationCount: z.number().int().nonnegative(),
});

export type CreateOutlookGraphConnectionInput = z.infer<
  typeof createOutlookGraphConnectionSchema
>;
export type UpdateOutlookGraphConnectionInput = z.infer<
  typeof updateOutlookGraphConnectionSchema
>;
