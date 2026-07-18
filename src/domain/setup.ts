import { z } from "zod";

export const initialSetupSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
  setupToken: z.string().min(32).max(512),
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  workspaceName: z.string().trim().min(1).max(120),
});

export type InitialSetupInput = z.infer<typeof initialSetupSchema>;
