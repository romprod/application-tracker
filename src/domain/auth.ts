import { z } from "zod";

export const loginSchema = z.strictObject({
  password: z.string().min(1).max(128),
  username: z.string().trim().min(3).max(64),
});

export type LoginInput = z.infer<typeof loginSchema>;
