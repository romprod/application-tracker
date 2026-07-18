import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import type { AuthService, AuthenticatedActor } from "../application/auth.js";
import {
  ReferenceValueConflictError,
  ReferenceValueInvalidError,
  ReferenceValueNotFoundError,
  ReferenceValueRequiredError,
  ReferenceValuesForbiddenError,
  type ReferenceValuesService,
} from "../application/reference_values.js";
import {
  createReferenceValueSchema,
  referenceValueIdSchema,
  updateReferenceValueSchema,
} from "../domain/reference_values.js";
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

function authenticatedActor(
  request: Request,
  response: Response,
  authService: AuthService,
): AuthenticatedActor | undefined {
  const actor = authService.getActor(requestSessionToken(request));
  if (!actor) {
    response.status(401).json({ error: { code: "authentication_required" } });
  }
  return actor;
}

function handleKnownError(
  error: unknown,
  response: Response,
  next: NextFunction,
): void {
  if (error instanceof ReferenceValuesForbiddenError) {
    response.status(403).json({ error: { code: "forbidden" } });
    return;
  }
  if (error instanceof ReferenceValueConflictError) {
    response.status(409).json({ error: { code: "reference_value_conflict" } });
    return;
  }
  if (error instanceof ReferenceValueRequiredError) {
    response.status(409).json({ error: { code: "reference_value_required" } });
    return;
  }
  if (error instanceof ReferenceValueNotFoundError) {
    response.status(404).json({ error: { code: "reference_value_not_found" } });
    return;
  }
  if (error instanceof ReferenceValueInvalidError) {
    response.status(400).json({ error: { code: "validation_error" } });
    return;
  }
  next(error);
}

export function createReferenceValuesRouter(
  authService: AuthService,
  referenceValuesService: ReferenceValuesService,
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

  router.get("/", (request, response, next) => {
    const actor = authenticatedActor(request, response, authService);
    if (!actor) return;
    try {
      response.json({
        values: referenceValuesService.listReferenceValues(actor),
      });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.post("/", (request, response, next) => {
    const actor = authenticatedActor(request, response, authService);
    if (!actor) return;
    const parsed = createReferenceValueSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.status(201).json({
        value: referenceValuesService.createReferenceValue(actor, parsed.data),
      });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.patch("/:referenceValueId", (request, response, next) => {
    const actor = authenticatedActor(request, response, authService);
    if (!actor) return;
    const parsedId = referenceValueIdSchema.safeParse(
      request.params.referenceValueId,
    );
    const parsedBody = updateReferenceValueSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      response.json({
        value: referenceValuesService.updateReferenceValue(
          actor,
          parsedId.data,
          parsedBody.data,
        ),
      });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.delete("/:referenceValueId", (request, response, next) => {
    const actor = authenticatedActor(request, response, authService);
    if (!actor) return;
    const parsedId = referenceValueIdSchema.safeParse(
      request.params.referenceValueId,
    );
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      referenceValuesService.deleteReferenceValue(actor, parsedId.data);
      response.status(204).end();
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  return router;
}
