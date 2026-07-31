import { Router, type Request } from "express";

import {
  ApplicationActivityCorrectionError,
  ApplicationActivityEvidenceError,
  ApplicationActivityIdempotencyConflictError,
  ApplicationConflictError,
  ApplicationFieldProvenanceIdempotencyConflictError,
  ApplicationFieldProvenanceSourceError,
  ApplicationFieldProvenanceVerificationConflictError,
  ApplicationMergeNotFoundError,
  ApplicationMergeRecoveryUnsafeError,
  ApplicationMergeStateError,
  ApplicationMergeUnsafeError,
  ApplicationMergeVersionConflictError,
  ApplicationNotFoundError,
  ApplicationRecoveryNotFoundError,
  ApplicationRecoveryStateError,
  ApplicationRecoveryVersionConflictError,
  ApplicationRestoreUnsafeError,
  InvalidApplicationReferenceError,
  InvalidOutlookGraphConnectionAssignmentError,
  type ApplicationLedgerService,
} from "../application/applications.js";
import type { AuthService } from "../application/auth.js";
import {
  JobEmailEvidenceConflictError,
  type JobEmailReconciliationService,
} from "../application/job_email_reconciliation.js";
import { applicationAttentionQuerySchema } from "../domain/application_attention.js";
import {
  deleteApplicationSchema,
  listDeletedApplicationsSchema,
  previewApplicationRestoreSchema,
  recoverApplicationMergeSchema,
  restoreApplicationSchema,
} from "../domain/application_recovery.js";
import {
  addApplicationActivitySchema,
  applicationIdSchema,
  auditDuplicateApplicationsSchema,
  createApplicationSchema,
  listApplicationEventsSchema,
  mergeApplicationsSchema,
  recordApplicationFieldProvenanceSchema,
  updateApplicationSchema,
  verifyApplicationFieldProvenanceSchema,
} from "../domain/applications.js";
import { linkEmailEvidencePayloadSchema } from "../domain/job_email_reconciliation.js";
import { requestSessionToken } from "./auth_routes.js";

function hasSameHostOrigin(request: Request): boolean {
  const host = request.get("Host");
  const origin = request.get("Origin");
  if (!host || !origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function queryList(value: unknown): unknown {
  if (typeof value === "string") return value.split(",").filter(Boolean);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.flatMap((item) => item.split(",")).filter(Boolean);
  }
  return value;
}

function queryBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function queryNumber(value: unknown): unknown {
  return typeof value === "string" ? Number(value) : value;
}

export function createApplicationsRouter(
  authService: AuthService,
  applicationsService: ApplicationLedgerService,
  jobEmailReconciliationService?: JobEmailReconciliationService,
): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use((request, response, next) => {
    if (
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS"
    ) {
      next();
      return;
    }
    if (!hasSameHostOrigin(request)) {
      response.status(403).json({ error: { code: "csrf_rejected" } });
      return;
    }
    next();
  });

  router.get("/", (request, response) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    response.json({
      applications: applicationsService.listApplications(actor),
    });
  });

  router.get("/attention", (request, response) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = applicationAttentionQuerySchema.safeParse({
      ...(request.query.appliedFrom === undefined
        ? {}
        : { appliedFrom: request.query.appliedFrom }),
      ...(request.query.appliedTo === undefined
        ? {}
        : { appliedTo: request.query.appliedTo }),
      ...(request.query.attentionOnly === undefined
        ? {}
        : { attentionOnly: queryBoolean(request.query.attentionOnly) }),
      ...(request.query.duplicateRisk === undefined
        ? {}
        : { duplicateRisk: queryBoolean(request.query.duplicateRisk) }),
      ...(request.query.fieldStates === undefined
        ? {}
        : { fieldStates: queryList(request.query.fieldStates) }),
      ...(request.query.lifecycle === undefined
        ? {}
        : { lifecycle: request.query.lifecycle }),
      ...(request.query.limit === undefined
        ? {}
        : { limit: queryNumber(request.query.limit) }),
      ...(request.query.missingEvidence === undefined
        ? {}
        : { missingEvidence: queryList(request.query.missingEvidence) }),
      ...(request.query.missingFields === undefined
        ? {}
        : { missingFields: queryList(request.query.missingFields) }),
      ...(request.query.nextAction === undefined
        ? {}
        : { nextAction: request.query.nextAction }),
      ...(request.query.offset === undefined
        ? {}
        : { offset: queryNumber(request.query.offset) }),
      ...(request.query.query === undefined
        ? {}
        : { query: request.query.query }),
      ...(request.query.reasonCodes === undefined
        ? {}
        : { reasonCodes: queryList(request.query.reasonCodes) }),
      ...(request.query.statusIds === undefined
        ? {}
        : { statusIds: queryList(request.query.statusIds) }),
      ...(request.query.updatedFrom === undefined
        ? {}
        : { updatedFrom: request.query.updatedFrom }),
      ...(request.query.updatedTo === undefined
        ? {}
        : { updatedTo: request.query.updatedTo }),
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    response.json(
      applicationsService.queryApplicationAttention(actor, parsed.data),
    );
  });

  router.get("/deleted", (request, response) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = listDeletedApplicationsSchema.safeParse({
      ...(request.query.limit === undefined
        ? {}
        : { limit: queryNumber(request.query.limit) }),
      ...(request.query.offset === undefined
        ? {}
        : { offset: queryNumber(request.query.offset) }),
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    response.json(
      applicationsService.listDeletedApplications(actor, parsed.data),
    );
  });

  router.post("/", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = createApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.status(201).json({
        application: applicationsService.createApplication(actor, parsed.data),
      });
    } catch (error) {
      if (error instanceof InvalidApplicationReferenceError) {
        response
          .status(400)
          .json({ error: { code: "invalid_application_reference" } });
        return;
      }
      if (error instanceof InvalidOutlookGraphConnectionAssignmentError) {
        response.status(400).json({
          error: { code: "invalid_outlook_graph_connection_assignment" },
        });
        return;
      }
      next(error);
    }
  });

  router.get("/duplicates", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = auditDuplicateApplicationsSchema.safeParse({
      ...(request.query.limit === undefined
        ? {}
        : { limit: Number(request.query.limit) }),
      ...(request.query.offset === undefined
        ? {}
        : { offset: Number(request.query.offset) }),
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        audit: applicationsService.auditDuplicateApplications(
          actor,
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/merge", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = mergeApplicationsSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        merge: applicationsService.mergeApplications(actor, parsed.data),
      });
    } catch (error) {
      if (error instanceof ApplicationMergeNotFoundError) {
        response
          .status(404)
          .json({ error: { code: "application_merge_not_found" } });
        return;
      }
      if (error instanceof ApplicationMergeStateError) {
        response.status(409).json({ error: { code: error.code } });
        return;
      }
      if (error instanceof ApplicationMergeVersionConflictError) {
        response.status(409).json({
          error: { code: "application_merge_conflict" },
          source: error.source,
          target: error.target,
        });
        return;
      }
      if (error instanceof ApplicationMergeUnsafeError) {
        response.status(409).json({
          error: { code: "application_merge_unresolved_conflicts" },
          preview: error.preview,
        });
        return;
      }
      if (error instanceof InvalidApplicationReferenceError) {
        response
          .status(400)
          .json({ error: { code: "invalid_application_reference" } });
        return;
      }
      if (error instanceof InvalidOutlookGraphConnectionAssignmentError) {
        response.status(400).json({
          error: { code: "invalid_outlook_graph_connection_assignment" },
        });
        return;
      }
      next(error);
    }
  });

  router.post("/merge-recovery", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = recoverApplicationMergeSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        mergeRecovery: applicationsService.recoverApplicationMerge(
          actor,
          parsed.data,
        ),
      });
    } catch (error) {
      if (error instanceof ApplicationRecoveryNotFoundError) {
        response
          .status(404)
          .json({ error: { code: "application_recovery_not_found" } });
        return;
      }
      if (error instanceof ApplicationRecoveryStateError) {
        response.status(409).json({ error: { code: error.code } });
        return;
      }
      if (error instanceof ApplicationRecoveryVersionConflictError) {
        response
          .status(409)
          .json({ error: { code: "application_recovery_conflict" } });
        return;
      }
      if (error instanceof ApplicationMergeRecoveryUnsafeError) {
        response.status(409).json({
          error: { code: "application_merge_recovery_unsafe" },
          preview: error.preview,
        });
        return;
      }
      if (error instanceof InvalidOutlookGraphConnectionAssignmentError) {
        response.status(409).json({
          error: { code: "application_merge_recovery_unsafe" },
        });
        return;
      }
      next(error);
    }
  });

  router.get("/:applicationId/restore-preview", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = previewApplicationRestoreSchema.safeParse({
      applicationId: request.params.applicationId,
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        preview: applicationsService.previewApplicationRestore(
          actor,
          parsed.data.applicationId,
        ),
      });
    } catch (error) {
      if (error instanceof ApplicationRecoveryNotFoundError) {
        response
          .status(404)
          .json({ error: { code: "application_recovery_not_found" } });
        return;
      }
      if (error instanceof ApplicationRecoveryStateError) {
        response.status(409).json({ error: { code: error.code } });
        return;
      }
      next(error);
    }
  });

  router.post("/:applicationId/restore", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = restoreApplicationSchema.safeParse({
      ...request.body,
      applicationId: request.params.applicationId,
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        restoration: applicationsService.restoreApplication(actor, parsed.data),
      });
    } catch (error) {
      if (error instanceof ApplicationRecoveryNotFoundError) {
        response
          .status(404)
          .json({ error: { code: "application_recovery_not_found" } });
        return;
      }
      if (error instanceof ApplicationRecoveryStateError) {
        response.status(409).json({ error: { code: error.code } });
        return;
      }
      if (error instanceof ApplicationRecoveryVersionConflictError) {
        response
          .status(409)
          .json({ error: { code: "application_recovery_conflict" } });
        return;
      }
      if (error instanceof ApplicationRestoreUnsafeError) {
        response.status(409).json({
          error: { code: "application_restore_unsafe" },
          preview: error.preview,
        });
        return;
      }
      next(error);
    }
  });

  router.get("/:applicationId/evidence", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsedId = applicationIdSchema.safeParse(
      request.params.applicationId,
    );
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      const applicationExists = applicationsService
        .listApplications(actor)
        .some(({ id }) => id === parsedId.data);
      if (!applicationExists) throw new ApplicationNotFoundError();
      response.json(
        jobEmailReconciliationService?.getApplicationEvidence(
          actor,
          parsedId.data,
        ) ?? { emailEvidence: [], jobPostings: [] },
      );
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      next(error);
    }
  });

  router.post("/:applicationId/evidence", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsedId = applicationIdSchema.safeParse(
      request.params.applicationId,
    );
    const parsedInput = linkEmailEvidencePayloadSchema.safeParse(request.body);
    if (!parsedId.success || !parsedInput.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    if (!jobEmailReconciliationService) {
      response
        .status(503)
        .json({ error: { code: "job_email_reconciliation_unavailable" } });
      return;
    }
    try {
      const result = jobEmailReconciliationService.linkEvidence(actor, {
        applicationId: parsedId.data,
        ...parsedInput.data,
      });
      response.status(result.emailEvidenceLinked ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      if (error instanceof JobEmailEvidenceConflictError) {
        response.status(409).json({ error: { code: "job_email_conflict" } });
        return;
      }
      next(error);
    }
  });

  router.get("/:applicationId/provenance", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsedId = applicationIdSchema.safeParse(
      request.params.applicationId,
    );
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        assessments: applicationsService.listApplicationFieldProvenance(
          actor,
          parsedId.data,
        ),
      });
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      next(error);
    }
  });

  router.post("/:applicationId/provenance", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = recordApplicationFieldProvenanceSchema.safeParse({
      ...request.body,
      applicationId: request.params.applicationId,
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.status(201).json({
        provenance: applicationsService.recordApplicationFieldProvenance(
          actor,
          parsed.data,
        ),
      });
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      if (error instanceof ApplicationFieldProvenanceSourceError) {
        response
          .status(400)
          .json({ error: { code: "invalid_provenance_source" } });
        return;
      }
      if (error instanceof ApplicationFieldProvenanceIdempotencyConflictError) {
        response
          .status(409)
          .json({ error: { code: "provenance_idempotency_conflict" } });
        return;
      }
      next(error);
    }
  });

  router.post(
    "/:applicationId/provenance/:provenanceId/verify",
    (request, response, next) => {
      const actor = authService.getActor(requestSessionToken(request));
      if (!actor) {
        response
          .status(401)
          .json({ error: { code: "authentication_required" } });
        return;
      }
      const parsed = verifyApplicationFieldProvenanceSchema.safeParse({
        applicationId: request.params.applicationId,
        provenanceId: request.params.provenanceId,
      });
      if (!parsed.success) {
        response.status(400).json({ error: { code: "validation_error" } });
        return;
      }
      try {
        response.json({
          provenance: applicationsService.verifyApplicationFieldProvenance(
            actor,
            parsed.data,
          ),
        });
      } catch (error) {
        if (error instanceof ApplicationNotFoundError) {
          response
            .status(404)
            .json({ error: { code: "provenance_not_found" } });
          return;
        }
        if (
          error instanceof ApplicationFieldProvenanceVerificationConflictError
        ) {
          response
            .status(409)
            .json({ error: { code: "provenance_verification_conflict" } });
          return;
        }
        next(error);
      }
    },
  );

  router.get("/:applicationId/events", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsedId = applicationIdSchema.safeParse(
      request.params.applicationId,
    );
    const parsedPage = listApplicationEventsSchema.safeParse({
      applicationId: request.params.applicationId,
      ...(request.query.limit === undefined
        ? {}
        : { limit: Number(request.query.limit) }),
      ...(request.query.offset === undefined
        ? {}
        : { offset: Number(request.query.offset) }),
    });
    if (!parsedId.success || !parsedPage.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json(
        applicationsService.listApplicationEventsPage(actor, parsedId.data, {
          limit: parsedPage.data.limit,
          offset: parsedPage.data.offset,
        }),
      );
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      next(error);
    }
  });

  router.post("/:applicationId/events", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = addApplicationActivitySchema.safeParse({
      ...request.body,
      applicationId: request.params.applicationId,
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.status(201).json({
        event: applicationsService.addApplicationActivity(actor, parsed.data),
      });
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      if (error instanceof ApplicationActivityEvidenceError) {
        response
          .status(400)
          .json({ error: { code: "invalid_application_activity_evidence" } });
        return;
      }
      if (error instanceof ApplicationActivityIdempotencyConflictError) {
        response.status(409).json({
          error: { code: "application_activity_idempotency_conflict" },
        });
        return;
      }
      if (error instanceof ApplicationActivityCorrectionError) {
        response.status(409).json({ error: { code: error.code } });
        return;
      }
      next(error);
    }
  });

  router.patch("/:applicationId", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsedId = applicationIdSchema.safeParse(
      request.params.applicationId,
    );
    const parsedInput = updateApplicationSchema.safeParse(request.body);
    if (!parsedId.success || !parsedInput.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        application: applicationsService.updateApplication(
          actor,
          parsedId.data,
          parsedInput.data,
        ),
      });
    } catch (error) {
      if (error instanceof ApplicationConflictError) {
        response.status(409).json({
          application: error.application,
          error: { code: "application_conflict" },
        });
        return;
      }
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      if (error instanceof InvalidApplicationReferenceError) {
        response
          .status(400)
          .json({ error: { code: "invalid_application_reference" } });
        return;
      }
      if (error instanceof InvalidOutlookGraphConnectionAssignmentError) {
        response.status(400).json({
          error: { code: "invalid_outlook_graph_connection_assignment" },
        });
        return;
      }
      next(error);
    }
  });

  router.delete("/:applicationId", (request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    const parsed = deleteApplicationSchema.safeParse({
      ...request.body,
      applicationId: request.params.applicationId,
    });
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      applicationsService.deleteApplication(actor, parsed.data);
      response.status(204).end();
    } catch (error) {
      if (error instanceof ApplicationNotFoundError) {
        response.status(404).json({ error: { code: "application_not_found" } });
        return;
      }
      next(error);
    }
  });

  return router;
}
