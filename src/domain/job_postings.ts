import { z } from "zod";

export const jobPostingInspectionInputSchema = z.strictObject({
  url: z
    .url({ protocol: /^https$/ })
    .trim()
    .max(2048),
});

export type JobPostingInspectionInput = z.infer<
  typeof jobPostingInspectionInputSchema
>;
