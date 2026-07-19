import { z } from "zod";

export const createLocalUserSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
  role: z.enum(["admin", "member"]),
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
});

export const updateUserStatusSchema = z.strictObject({
  status: z.enum(["active", "disabled"]),
});

export const createExternalIdentitySchema = z.strictObject({
  subject: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => value.trim().length > 0),
});

export const externalIdentityIdSchema = z.string().uuid();
export const userIdSchema = z.string().uuid();

export type CreateLocalUserInput = z.infer<typeof createLocalUserSchema>;
export type CreateExternalIdentityInput = z.infer<
  typeof createExternalIdentitySchema
>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
