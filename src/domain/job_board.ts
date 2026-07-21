import { z } from "zod";

export const jobBoardProviders = [
  "linkedin",
  "cv_library",
  "indeed",
  "totaljobs",
  "michael_page",
  "hackajob",
  "cord",
  "talent",
  "generic",
] as const;

export const jobBoardProviderSchema = z.enum(jobBoardProviders);

export type JobBoardProvider = (typeof jobBoardProviders)[number];
