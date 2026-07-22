import { z } from "zod";

import {
  createApplicationSchema,
  applicationChangesSchema,
} from "./applications.js";
import { jobBoardProviderSchema } from "./job_board.js";

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalHttpUrlSchema = z.preprocess(
  blankToUndefined,
  z
    .url({ protocol: /^https?$/ })
    .trim()
    .max(2048)
    .optional(),
);

const optionalIdentityText = (maximumLength: number) =>
  z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(maximumLength).optional(),
  );

export const jobPostingEvidenceSchema = z
  .strictObject({
    externalPostingId: optionalIdentityText(256),
    provider: jobBoardProviderSchema.optional(),
    url: optionalHttpUrlSchema,
  })
  .superRefine((input, context) => {
    if (!input.url && !(input.provider && input.externalPostingId)) {
      context.addIssue({
        code: "custom",
        message:
          "A posting URL or a provider with an external posting ID is required",
      });
    }
    if (Boolean(input.provider) !== Boolean(input.externalPostingId)) {
      context.addIssue({
        code: "custom",
        message: "Provider and external posting ID must be supplied together",
      });
    }
    if (input.provider === "generic" && input.externalPostingId) {
      context.addIssue({
        code: "custom",
        message: "Generic postings cannot claim an external posting ID",
      });
    }
  });

export const jobEmailEvidenceSchema = z.strictObject({
  messageId: z.string().trim().min(1).max(998),
  receivedAt: z.iso.datetime(),
  webUrl: optionalHttpUrlSchema,
});

export const matchJobApplicationEmailSchema = z
  .strictObject({
    companyName: optionalIdentityText(160),
    emailMessageId: optionalIdentityText(998),
    posting: jobPostingEvidenceSchema.optional(),
    roleTitle: optionalIdentityText(160),
  })
  .superRefine((input, context) => {
    if (Boolean(input.companyName) !== Boolean(input.roleTitle)) {
      context.addIssue({
        code: "custom",
        message: "Company name and role title must be supplied together",
      });
    }
    if (!input.posting && !input.emailMessageId && !input.companyName) {
      context.addIssue({
        code: "custom",
        message: "At least one job or email identity is required",
      });
    }
  });

export const upsertApplicationFromEmailSchema = z.strictObject({
  application: createApplicationSchema,
  email: jobEmailEvidenceSchema,
  posting: jobPostingEvidenceSchema.optional(),
  update: applicationChangesSchema.optional(),
});

export type JobPostingEvidenceInput = z.infer<typeof jobPostingEvidenceSchema>;
export type JobEmailEvidenceInput = z.infer<typeof jobEmailEvidenceSchema>;
export type MatchJobApplicationEmailInput = z.infer<
  typeof matchJobApplicationEmailSchema
>;
export type UpsertApplicationFromEmailInput = z.infer<
  typeof upsertApplicationFromEmailSchema
>;
