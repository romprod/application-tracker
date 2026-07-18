import { Router } from "express";

import {
  InvalidSetupTokenError,
  SetupAlreadyCompleteError,
  type SetupService,
} from "../application/setup.js";
import { initialSetupSchema } from "../domain/setup.js";

export function createSetupRouter(setupService: SetupService): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.get("/status", (_request, response) => {
    response.json(setupService.getStatus());
  });

  router.post("/", async (request, response, next) => {
    const parsed = initialSetupSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }

    try {
      const result = await setupService.createInitialAdministrator(parsed.data);
      response.status(201).json(result);
    } catch (error) {
      if (error instanceof InvalidSetupTokenError) {
        response.status(403).json({ error: { code: "invalid_setup_token" } });
        return;
      }
      if (error instanceof SetupAlreadyCompleteError) {
        response.status(409).json({ error: { code: "setup_complete" } });
        return;
      }
      next(error);
    }
  });

  return router;
}
