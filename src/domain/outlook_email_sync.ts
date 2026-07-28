import { z } from "zod";

import { applicationIdSchema } from "./applications.js";

export const syncOutlookEmailEvidenceSchema = z.strictObject({
  applicationId: applicationIdSchema,
});

export type SyncOutlookEmailEvidenceInput = z.infer<
  typeof syncOutlookEmailEvidenceSchema
>;
