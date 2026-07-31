import { z } from "zod";
import { outlookGraphConnectionIdSchema } from "./outlook_graph_connections.js";
import { referenceValueIdSchema } from "./reference_values.js";

export const applicationIdSchema = z.uuid();
export const workArrangementSchema = z.enum(["hybrid", "remote", "office"]);
export const salaryPeriodSchema = z.enum([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "annual",
]);

const moneyAmountSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(1_000_000_000)
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: "Salary amounts support at most two decimal places",
  });

export const salaryDetailsSchema = z
  .strictObject({
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    disclosed: z.boolean(),
    maximum: moneyAmountSchema.nullable().optional(),
    minimum: moneyAmountSchema.nullable().optional(),
    negotiable: z.boolean(),
    period: salaryPeriodSchema,
  })
  .superRefine((details, context) => {
    if (
      details.minimum !== null &&
      details.minimum !== undefined &&
      details.maximum !== null &&
      details.maximum !== undefined &&
      details.minimum > details.maximum
    ) {
      context.addIssue({
        code: "custom",
        message: "Salary minimum cannot exceed salary maximum",
        path: ["minimum"],
      });
    }
  });

export const workArrangementDetailsSchema = z
  .strictObject({
    officeDaysPerWeek: z.number().int().min(0).max(7).nullable().optional(),
    originalText: optionalText(500),
    remoteDaysPerWeek: z.number().int().min(0).max(7).nullable().optional(),
  })
  .superRefine((details, context) => {
    const office = details.officeDaysPerWeek ?? 0;
    const remote = details.remoteDaysPerWeek ?? 0;
    if (office + remote > 7) {
      context.addIssue({
        code: "custom",
        message: "Office and remote days cannot exceed seven per week",
        path: ["officeDaysPerWeek"],
      });
    }
  });

export const maximumApplicationRelations = 10;

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(maximumLength: number) {
  return z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(maximumLength).optional(),
  );
}

function blankToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

function nullableText(maximumLength: number) {
  return z.preprocess(
    blankToNull,
    z.string().trim().min(1).max(maximumLength).nullable(),
  );
}

export const applicationContactSchema = z.strictObject({
  email: z.preprocess(
    blankToUndefined,
    z.string().trim().email().max(254).optional(),
  ),
  name: z.string().trim().min(1).max(160),
  phone: optionalText(50),
  role: optionalText(160),
});

export const applicationLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  url: z
    .url({ protocol: /^https?$/ })
    .trim()
    .max(2048),
});

export const createApplicationSchema = z
  .strictObject({
    agency: optionalText(160),
    appliedOn: z.preprocess(blankToUndefined, z.iso.date().optional()),
    companyName: z.string().trim().min(1).max(160),
    contacts: z
      .array(applicationContactSchema)
      .max(maximumApplicationRelations)
      .optional(),
    links: z
      .array(applicationLinkSchema)
      .max(maximumApplicationRelations)
      .optional(),
    location: optionalText(160),
    nextAction: optionalText(500),
    nextActionDue: z.preprocess(blankToUndefined, z.iso.date().optional()),
    notes: optionalText(5000),
    outlookGraphConnectionId: outlookGraphConnectionIdSchema.optional(),
    rating: z.number().int().min(1).max(5).optional(),
    roleTypeId: referenceValueIdSchema.optional(),
    roleTitle: z.string().trim().min(1).max(160),
    salary: optionalText(160),
    salaryDetails: salaryDetailsSchema.optional(),
    sourceId: referenceValueIdSchema.optional(),
    sourceUrl: z.preprocess(
      blankToUndefined,
      z
        .url({ protocol: /^https?$/ })
        .trim()
        .max(2048)
        .optional(),
    ),
    statusId: referenceValueIdSchema,
    workArrangement: workArrangementSchema.optional(),
    workArrangementDetails: workArrangementDetailsSchema.optional(),
  })
  .superRefine((input, context) => {
    const officeDays = input.workArrangementDetails?.officeDaysPerWeek ?? 0;
    const remoteDays = input.workArrangementDetails?.remoteDaysPerWeek ?? 0;
    if (input.workArrangement === "remote" && officeDays > 0) {
      context.addIssue({
        code: "custom",
        message: "Remote roles cannot declare office days",
        path: ["workArrangementDetails", "officeDaysPerWeek"],
      });
    }
    if (input.workArrangement === "office" && remoteDays > 0) {
      context.addIssue({
        code: "custom",
        message: "Office roles cannot declare remote days",
        path: ["workArrangementDetails", "remoteDaysPerWeek"],
      });
    }
  });

const applicationUpdateFields = {
  agency: nullableText(160).optional(),
  appliedOn: z.preprocess(blankToNull, z.iso.date().nullable()).optional(),
  companyName: z.string().trim().min(1).max(160).optional(),
  contacts: z
    .array(applicationContactSchema)
    .max(maximumApplicationRelations)
    .optional(),
  links: z
    .array(applicationLinkSchema)
    .max(maximumApplicationRelations)
    .optional(),
  location: nullableText(160).optional(),
  nextAction: nullableText(500).optional(),
  nextActionDue: z.preprocess(blankToNull, z.iso.date().nullable()).optional(),
  notes: nullableText(5000).optional(),
  outlookGraphConnectionId: outlookGraphConnectionIdSchema
    .nullable()
    .optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  roleTypeId: referenceValueIdSchema.nullable().optional(),
  roleTitle: z.string().trim().min(1).max(160).optional(),
  salary: nullableText(160).optional(),
  salaryDetails: salaryDetailsSchema.nullable().optional(),
  sourceId: referenceValueIdSchema.nullable().optional(),
  sourceUrl: z
    .preprocess(
      blankToNull,
      z
        .url({ protocol: /^https?$/ })
        .trim()
        .max(2048)
        .nullable(),
    )
    .optional(),
  statusId: referenceValueIdSchema.optional(),
  workArrangement: workArrangementSchema.nullable().optional(),
  workArrangementDetails: workArrangementDetailsSchema.nullable().optional(),
};

export const applicationChangesSchema = z
  .strictObject(applicationUpdateFields)
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one application field must be supplied",
  });

export const updateApplicationSchema = z
  .strictObject({
    ...applicationUpdateFields,
    expectedUpdatedAt: z.iso.datetime(),
  })
  .refine(
    (input) =>
      Object.keys(input).some((field) => field !== "expectedUpdatedAt"),
    { message: "At least one application field must be supplied" },
  );

export const applicationMergeFieldSchema = z.enum([
  "agency",
  "appliedOn",
  "companyName",
  "location",
  "nextAction",
  "nextActionDue",
  "notes",
  "outlookGraphConnectionId",
  "rating",
  "roleTypeId",
  "roleTitle",
  "salary",
  "sourceId",
  "sourceUrl",
  "statusId",
  "workArrangement",
]);

export const applicationMergeResolutionsSchema = z.strictObject({
  contacts: z
    .array(applicationContactSchema)
    .max(maximumApplicationRelations)
    .optional(),
  fields: z
    .partialRecord(applicationMergeFieldSchema, z.enum(["source", "target"]))
    .optional(),
  links: z
    .array(applicationLinkSchema)
    .max(maximumApplicationRelations)
    .optional(),
});

const applicationMergeIdentitySchema = {
  sourceApplicationId: applicationIdSchema,
  targetApplicationId: applicationIdSchema,
};

export const mergeApplicationsSchema = z
  .discriminatedUnion("mode", [
    z.strictObject({
      ...applicationMergeIdentitySchema,
      mode: z.literal("preview"),
      resolutions: applicationMergeResolutionsSchema.optional(),
    }),
    z.strictObject({
      ...applicationMergeIdentitySchema,
      confirm: z.literal(true),
      expectedSourceUpdatedAt: z.iso.datetime(),
      expectedTargetUpdatedAt: z.iso.datetime(),
      mode: z.literal("apply"),
      resolutions: applicationMergeResolutionsSchema,
    }),
  ])
  .refine(
    ({ sourceApplicationId, targetApplicationId }) =>
      sourceApplicationId !== targetApplicationId,
    {
      message: "Source and target applications must be different",
      path: ["sourceApplicationId"],
    },
  );

export const auditDuplicateApplicationsSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
});

export const addApplicationEventSchema = z.strictObject({
  applicationId: applicationIdSchema,
  expectedUpdatedAt: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
  sourceEmailMessageId: optionalText(998),
  statusId: referenceValueIdSchema,
  statusOverride: z
    .strictObject({
      allowStaleOrRegressive: z.literal(true),
      reason: z.string().trim().min(1).max(500),
    })
    .optional(),
});

export const applicationActivityTypeSchema = z.enum([
  "recruiter_contact",
  "recruiter_screen",
  "interview_scheduled",
  "interview_completed",
  "follow_up_sent",
  "salary_discussion",
  "offer",
  "rejection",
  "withdrawal",
  "role_closed",
  "note",
  "other",
]);

export const addApplicationActivitySchema = z
  .strictObject({
    applicationId: applicationIdSchema,
    correctionReason: optionalText(500),
    idempotencyKey: optionalText(200),
    occurredAt: z.iso.datetime(),
    sourceEmailEvidenceId: applicationIdSchema.optional(),
    sourceEmailMessageId: optionalText(998),
    summary: z.string().trim().min(1).max(1000),
    supersedesEventId: applicationIdSchema.optional(),
    type: applicationActivityTypeSchema,
  })
  .superRefine((input, context) => {
    if (input.sourceEmailEvidenceId && input.sourceEmailMessageId) {
      context.addIssue({
        code: "custom",
        message:
          "Choose linked email evidence or a stable Message-ID, not both",
        path: ["sourceEmailEvidenceId"],
      });
    }
    if (Boolean(input.supersedesEventId) !== Boolean(input.correctionReason)) {
      context.addIssue({
        code: "custom",
        message:
          "supersedesEventId and correctionReason must be supplied together",
        path: input.supersedesEventId
          ? ["correctionReason"]
          : ["supersedesEventId"],
      });
    }
  });

export const listApplicationEventsSchema = z.strictObject({
  applicationId: applicationIdSchema,
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().nonnegative().default(0),
});

export const applicationFieldNameSchema = z.enum([
  "agency",
  "appliedOn",
  "companyName",
  "location",
  "roleTitle",
  "salary",
  "sourceUrl",
  "workArrangement",
]);
export const applicationFieldStateSchema = z.enum([
  "conflicting",
  "disclosed",
  "inferred",
  "not_applicable",
  "not_disclosed",
]);
export const applicationFieldProvenanceSourceSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      emailEvidenceId: applicationIdSchema,
      type: z.literal("email_evidence"),
    }),
    z.strictObject({
      documentId: applicationIdSchema,
      type: z.literal("document"),
    }),
    z.strictObject({
      jobPostingId: applicationIdSchema,
      type: z.literal("job_posting"),
    }),
    z.strictObject({ type: z.literal("imported") }),
  ],
);
const applicationFieldValueSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.union([
    z.string().min(1).max(500),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]),
);
export const recordApplicationFieldProvenanceSchema = z
  .strictObject({
    applicationId: applicationIdSchema,
    confidence: z.number().finite().min(0).max(1),
    field: applicationFieldNameSchema,
    fieldState: applicationFieldStateSchema,
    idempotencyKey: optionalText(200),
    observedAt: z.iso.datetime(),
    source: applicationFieldProvenanceSourceSchema,
    value: applicationFieldValueSchema,
  })
  .superRefine((input, context) => {
    if (input.fieldState === "disclosed" && input.value === null) {
      context.addIssue({
        code: "custom",
        message: "Disclosed provenance requires a value",
        path: ["value"],
      });
    }
  });
export const verifyApplicationFieldProvenanceSchema = z.strictObject({
  applicationId: applicationIdSchema,
  provenanceId: applicationIdSchema,
});

export type AddApplicationEventInput = z.infer<
  typeof addApplicationEventSchema
>;
export type AddApplicationActivityInput = z.infer<
  typeof addApplicationActivitySchema
>;
export type ApplicationActivityType = z.infer<
  typeof applicationActivityTypeSchema
>;
export type ApplicationContactInput = z.infer<typeof applicationContactSchema>;
export type ApplicationLinkInput = z.infer<typeof applicationLinkSchema>;
export type ApplicationChangesInput = z.infer<typeof applicationChangesSchema>;
export type ApplicationMergeField = z.infer<typeof applicationMergeFieldSchema>;
export type ApplicationMergeResolutions = z.infer<
  typeof applicationMergeResolutionsSchema
>;
export type ApplicationFieldName = z.infer<typeof applicationFieldNameSchema>;
export type ApplicationFieldState = z.infer<typeof applicationFieldStateSchema>;
export type ApplicationFieldProvenanceSource = z.infer<
  typeof applicationFieldProvenanceSourceSchema
>;
export type AuditDuplicateApplicationsInput = z.infer<
  typeof auditDuplicateApplicationsSchema
>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type MergeApplicationsInput = z.infer<typeof mergeApplicationsSchema>;
export type RecordApplicationFieldProvenanceInput = z.infer<
  typeof recordApplicationFieldProvenanceSchema
>;
export type SalaryDetails = z.infer<typeof salaryDetailsSchema>;
export type ListApplicationEventsInput = z.infer<
  typeof listApplicationEventsSchema
>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
export type VerifyApplicationFieldProvenanceInput = z.infer<
  typeof verifyApplicationFieldProvenanceSchema
>;
export type WorkArrangement = z.infer<typeof workArrangementSchema>;
export type WorkArrangementDetails = z.infer<
  typeof workArrangementDetailsSchema
>;
