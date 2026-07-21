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

export type JobBoardProvider = (typeof jobBoardProviders)[number];
