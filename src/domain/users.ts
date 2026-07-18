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

export const userIdSchema = z.string().uuid();

export type CreateLocalUserInput = z.infer<typeof createLocalUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
