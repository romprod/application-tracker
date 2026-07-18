import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import {
  CannotDisableCurrentUserError,
  ManagedUserNotFoundError,
  UserAdministrationForbiddenError,
  UsernameUnavailableError,
  type UserAdministrationService,
} from "../application/users.js";
import type { AuthService, AuthenticatedActor } from "../application/auth.js";
import {
  createLocalUserSchema,
  updateUserStatusSchema,
  userIdSchema,
} from "../domain/users.js";
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
  if (error instanceof UserAdministrationForbiddenError) {
    response.status(403).json({ error: { code: "forbidden" } });
    return;
  }
  if (error instanceof UsernameUnavailableError) {
    response.status(409).json({ error: { code: "username_unavailable" } });
    return;
  }
  if (error instanceof CannotDisableCurrentUserError) {
    response.status(409).json({ error: { code: "cannot_disable_self" } });
    return;
  }
  if (error instanceof ManagedUserNotFoundError) {
    response.status(404).json({ error: { code: "user_not_found" } });
    return;
  }
  next(error);
}

export function createUsersRouter(
  authService: AuthService,
  usersService: UserAdministrationService,
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
      response.json({ users: usersService.listUsers(actor) });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.post("/", async (request, response, next) => {
    const actor = authenticatedActor(request, response, authService);
    if (!actor) return;
    const parsed = createLocalUserSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      const user = await usersService.createLocalUser(actor, parsed.data);
      response.status(201).json({ user });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  router.patch("/:userId/status", (request, response, next) => {
    const actor = authenticatedActor(request, response, authService);
    if (!actor) return;
    const parsedId = userIdSchema.safeParse(request.params.userId);
    const parsedBody = updateUserStatusSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      const user = usersService.setUserStatus(
        actor,
        parsedId.data,
        parsedBody.data,
      );
      response.json({ user });
    } catch (error) {
      handleKnownError(error, response, next);
    }
  });

  return router;
}
