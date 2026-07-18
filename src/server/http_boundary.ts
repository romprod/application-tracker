import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type {
  ErrorRequestHandler,
  Request,
  RequestHandler,
  Response,
} from "express";

import type { ApplicationLogger } from "./logging.js";

type BoundaryErrorCode =
  | "internal_error"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "payload_too_large"
  | "unsupported_media_type";

function requestId(response: Response): string {
  const value: unknown = response.locals.requestId;
  return typeof value === "string" ? value : "unavailable";
}

function routeTemplate(request: Request): string {
  const route: unknown = request.route;
  if (
    typeof route === "object" &&
    route !== null &&
    "path" in route &&
    typeof route.path === "string"
  ) {
    return route.path;
  }
  return "unmatched";
}

function errorProperty(error: unknown, property: string): unknown {
  return typeof error === "object" && error !== null && property in error
    ? error[property as keyof typeof error]
    : undefined;
}

function boundaryError(error: unknown): {
  code: BoundaryErrorCode;
  status: number;
} {
  const status = errorProperty(error, "status");
  const type = errorProperty(error, "type");

  if (status === 400 && type === "entity.parse.failed") {
    return { code: "invalid_json", status: 400 };
  }
  if (status === 413 && type === "entity.too.large") {
    return { code: "payload_too_large", status: 413 };
  }
  if (
    status === 415 &&
    (type === "charset.unsupported" || type === "encoding.unsupported")
  ) {
    return { code: "unsupported_media_type", status: 415 };
  }
  if (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    typeof type === "string" &&
    (type.startsWith("entity.") || type.startsWith("request."))
  ) {
    return { code: "invalid_request", status };
  }
  return { code: "internal_error", status: 500 };
}

function sendApiError(
  response: Response,
  status: number,
  code: BoundaryErrorCode,
): void {
  response.set("Cache-Control", "no-store");
  response.status(status).json({ error: { code } });
}

export function createApiRequestLogger(
  logger: ApplicationLogger,
): RequestHandler {
  return (request, response, next) => {
    const startedAt = performance.now();
    const id = randomUUID();
    response.locals.requestId = id;
    response.set("Cache-Control", "no-store");
    response.set("X-Request-Id", id);
    response.once("finish", () => {
      logger.info("http_request_completed", {
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        method: request.method,
        requestId: id,
        route: routeTemplate(request),
        statusCode: response.statusCode,
      });
    });
    next();
  };
}

export const apiNotFoundHandler: RequestHandler = (_request, response) => {
  sendApiError(response, 404, "not_found");
};

export function createApiErrorHandler(
  logger: ApplicationLogger,
): ErrorRequestHandler {
  return (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const handled = boundaryError(error);
    if (handled.status === 500) {
      logger.error("http_request_failed", {
        error,
        requestId: requestId(response),
      });
    }
    sendApiError(response, handled.status, handled.code);
  };
}
