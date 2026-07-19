import { Router, type Request, type RequestHandler } from "express";
import multer, { MulterError } from "multer";

import type { AuthenticatedActor } from "../application/auth.js";
import type { EmailLinkExtractionService } from "../application/email_links.js";
import {
  DocumentPreviewCapacityError,
  DocumentPreviewInputLimitError,
  DocumentPreviewParseError,
  DocumentPreviewTimeoutError,
  type DocumentPreviewService,
} from "../application/document_previews.js";
import {
  DocumentNotFoundError,
  DocumentStorageQuotaExceededError,
  InvalidDocumentContentError,
  InvalidDocumentReferenceError,
  type DocumentLibraryService,
} from "../application/documents.js";
import type { AuthService } from "../application/auth.js";
import {
  documentIdSchema,
  documentUploadMetadataSchema,
} from "../domain/documents.js";
import { emailLinkExtractionInputSchema } from "../domain/email_links.js";
import { requestSessionToken } from "./auth_routes.js";

export interface DocumentsRouteOptions {
  emailLinksService: EmailLinkExtractionService;
  maxUploadBytes: number;
  previewService: DocumentPreviewService;
  service: DocumentLibraryService;
}

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

function authenticatedActor(response: {
  locals: Record<string, unknown>;
}): AuthenticatedActor {
  return response.locals.actor as AuthenticatedActor;
}

function parseApplicationIds(value: unknown): unknown {
  if (value === undefined) return [];
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function requestFields(request: Request): Record<string, unknown> | undefined {
  const body: unknown = request.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  return body as Record<string, unknown>;
}

function encodedFilename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function attachmentDisposition(filename: string): string {
  const fallback =
    filename
      .replaceAll(/["\\]/g, "_")
      .replaceAll(/[^\x20-\x7e]/g, "_")
      .slice(0, 180) || "document";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodedFilename(filename)}`;
}

function uploadParser(maxUploadBytes: number): RequestHandler {
  const parser = multer({
    limits: {
      fieldNameSize: 64,
      fieldNestingDepth: 1,
      fields: 2,
      fieldSize: 4096,
      files: 1,
      fileSize: maxUploadBytes + 1,
      headerPairs: 100,
      parts: 4,
    },
    storage: multer.memoryStorage(),
  }).single("file");
  return (request, response, next) => {
    parser(request, response, (error: unknown) => {
      if (error instanceof MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          response.status(413).json({ error: { code: "document_too_large" } });
          return;
        }
        response.status(400).json({ error: { code: "invalid_upload" } });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      next();
    });
  };
}

export function createDocumentsRouter(
  authService: AuthService,
  options: DocumentsRouteOptions,
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
  router.use((request, response, next) => {
    const actor = authService.getActor(requestSessionToken(request));
    if (!actor) {
      response.status(401).json({ error: { code: "authentication_required" } });
      return;
    }
    response.locals.actor = actor;
    next();
  });

  router.get("/", (_request, response) => {
    response.json({
      documents: options.service.listDocuments(authenticatedActor(response)),
      maxUploadBytes: options.maxUploadBytes,
    });
  });

  router.post("/email-links/extract", (request, response) => {
    const parsed = emailLinkExtractionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    response.json({ links: options.emailLinksService.extract(parsed.data) });
  });

  router.post(
    "/",
    uploadParser(options.maxUploadBytes),
    (request, response, next) => {
      const fields = requestFields(request);
      if (
        !fields ||
        Object.keys(fields).some(
          (field) => field !== "documentTypeId" && field !== "applicationIds",
        ) ||
        !request.file
      ) {
        response.status(400).json({ error: { code: "invalid_upload" } });
        return;
      }
      const parsed = documentUploadMetadataSchema.safeParse({
        applicationIds: parseApplicationIds(fields.applicationIds),
        documentTypeId: fields.documentTypeId,
        mediaType: request.file.mimetype || "application/octet-stream",
        originalFilename: request.file.originalname,
      });
      if (!parsed.success) {
        response.status(400).json({ error: { code: "validation_error" } });
        return;
      }
      try {
        response.status(201).json({
          document: options.service.uploadDocument(
            authenticatedActor(response),
            {
              ...parsed.data,
              bytes: request.file.buffer,
            },
          ),
        });
      } catch (error) {
        if (error instanceof DocumentStorageQuotaExceededError) {
          response
            .status(409)
            .json({ error: { code: "document_storage_quota_exceeded" } });
          return;
        }
        if (error instanceof InvalidDocumentContentError) {
          if (request.file.buffer.byteLength > options.maxUploadBytes) {
            response
              .status(413)
              .json({ error: { code: "document_too_large" } });
            return;
          }
          response
            .status(400)
            .json({ error: { code: "invalid_document_content" } });
          return;
        }
        if (error instanceof InvalidDocumentReferenceError) {
          response
            .status(400)
            .json({ error: { code: "invalid_document_reference" } });
          return;
        }
        next(error);
      }
    },
  );

  router.get("/:documentId/download", (request, response, next) => {
    const parsedId = documentIdSchema.safeParse(request.params.documentId);
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    try {
      const original = options.service.getDocumentOriginal(
        authenticatedActor(response),
        parsedId.data,
      );
      response.set({
        "Content-Disposition": attachmentDisposition(
          original.document.originalFilename,
        ),
        "Content-Length": String(original.bytes.byteLength),
        "Content-Security-Policy": "sandbox",
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.send(Buffer.from(original.bytes));
    } catch (error) {
      if (error instanceof DocumentNotFoundError) {
        response.status(404).json({ error: { code: "document_not_found" } });
        return;
      }
      next(error);
    }
  });

  router.get("/:documentId/preview", (request, response, next) => {
    const parsedId = documentIdSchema.safeParse(request.params.documentId);
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }
    void options.previewService
      .getPreview(authenticatedActor(response), parsedId.data)
      .then((preview) => response.json({ preview }))
      .catch((error: unknown) => {
        if (error instanceof DocumentNotFoundError) {
          response.status(404).json({ error: { code: "document_not_found" } });
          return;
        }
        if (error instanceof DocumentPreviewInputLimitError) {
          response
            .status(413)
            .json({ error: { code: "document_preview_too_large" } });
          return;
        }
        if (error instanceof DocumentPreviewCapacityError) {
          response.set("Retry-After", "1");
          response
            .status(503)
            .json({ error: { code: "document_preview_busy" } });
          return;
        }
        if (error instanceof DocumentPreviewTimeoutError) {
          response
            .status(504)
            .json({ error: { code: "document_preview_timeout" } });
          return;
        }
        if (error instanceof DocumentPreviewParseError) {
          response
            .status(422)
            .json({ error: { code: "document_preview_failed" } });
          return;
        }
        next(error);
      });
  });

  return router;
}
