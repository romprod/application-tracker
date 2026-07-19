import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { ApplicationLedgerService } from "../application/applications.js";
import { AuthService } from "../application/auth.js";
import { DocumentLibraryService } from "../application/documents.js";
import { DocumentPreviewService } from "../application/document_previews.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { CryptoSessionTokenManager } from "../infrastructure/auth/session_token_manager.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { SqliteAuthRepository } from "../infrastructure/database/auth_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteDocumentsRepository } from "../infrastructure/database/documents_repository.js";
import { SqliteDocumentPreviewsRepository } from "../infrastructure/database/document_previews_repository.js";
import { DocumentPreviewSupervisor } from "../infrastructure/documents/document_preview_supervisor.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { createApp } from "./app.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function createDocumentsApp(
  maxUploadBytes = 1024,
  maxPreviewInputBytes = 1024,
) {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const hasher = new ScryptPasswordHasher({
    cost: 1024,
    maxMemory: 8_388_608,
  });
  const passwordHash = await hasher.hash("correct horse battery staple");
  const dummyPasswordHash = await hasher.hash("not a real account password");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-19T09:00:00.000Z",
    displayName: "Alex Example",
    passwordHash,
    username: "alex",
    workspaceName: "Applications",
  });
  const authService = new AuthService(
    new SqliteAuthRepository(database),
    hasher,
    new CryptoSessionTokenManager(),
    {
      absoluteDurationMs: 86_400_000,
      dummyPasswordHash,
      idleDurationMs: 1_800_000,
      refreshIntervalMs: 60_000,
    },
    () => new Date("2026-07-19T09:30:00.000Z"),
  );
  const documentsRepository = new SqliteDocumentsRepository(database);
  const documentsService = new DocumentLibraryService(
    documentsRepository,
    { maxUploadBytes },
    () => new Date("2026-07-19T10:00:00.000Z"),
  );
  const applicationService = new ApplicationLedgerService(
    new SqliteApplicationsRepository(database),
    () => new Date("2026-07-19T09:45:00.000Z"),
  );
  const statusId = database
    .prepare(
      `SELECT id FROM reference_values
       WHERE workspace_id = ? AND category = 'status' AND label = 'Applied'`,
    )
    .pluck()
    .get(setup.workspace.id);
  const documentTypeId = database
    .prepare(
      `SELECT id FROM reference_values
       WHERE workspace_id = ? AND category = 'document_type' AND label = 'CV'`,
    )
    .pluck()
    .get(setup.workspace.id);
  if (typeof statusId !== "string" || typeof documentTypeId !== "string") {
    throw new Error("Missing test reference values");
  }
  const application = applicationService.createApplication(
    {
      authenticated: true,
      user: { displayName: "Alex Example", role: "admin", username: "alex" },
      userId: setup.administrator.id,
      workspace: { name: setup.workspace.name },
      workspaceId: setup.workspace.id,
    },
    {
      companyName: "Example Studio",
      roleTitle: "Product Designer",
      statusId,
    },
  );
  const app = createApp({
    authCookie: { maxAgeSeconds: 86_400, secure: false },
    authService,
    documents: {
      maxUploadBytes,
      previewService: new DocumentPreviewService(
        documentsRepository,
        new SqliteDocumentPreviewsRepository(database),
        new DocumentPreviewSupervisor({
          maxInputBytes: maxPreviewInputBytes,
          maxMemoryMb: 16,
          maxOutputCharacters: 1000,
          timeoutMs: 500,
        }),
        "plain-text-v1",
        () => new Date("2026-07-19T10:05:00.000Z"),
      ),
      service: documentsService,
    },
  });
  return { app, application, documentTypeId };
}

function sessionCookie(response: request.Response): string {
  const header: unknown = response.headers["set-cookie"];
  if (typeof header === "string") return header;
  if (Array.isArray(header) && typeof header[0] === "string") return header[0];
  throw new Error("Expected a session cookie");
}

async function login(app: ReturnType<typeof createApp>) {
  const response = await request(app)
    .post("/api/auth/login")
    .send({
      password: "correct horse battery staple",
      username: "alex",
    })
    .expect(200);
  return sessionCookie(response);
}

function sameOrigin(test: request.Test): request.Test {
  return test
    .set("Host", "tracker.example.test")
    .set("Origin", "https://tracker.example.test");
}

function responseDocument(response: request.Response): Record<string, unknown> {
  const body: unknown = response.body;
  if (
    typeof body !== "object" ||
    body === null ||
    !("document" in body) ||
    typeof body.document !== "object" ||
    body.document === null
  ) {
    throw new Error("Expected a document response");
  }
  return body.document as Record<string, unknown>;
}

describe("document routes", () => {
  it("requires authentication before listing or parsing uploads", async () => {
    const { app, documentTypeId } = await createDocumentsApp();

    await request(app)
      .get("/api/documents")
      .expect(401, { error: { code: "authentication_required" } });
    await sameOrigin(request(app).post("/api/documents"))
      .field("documentTypeId", documentTypeId)
      .field("applicationIds", "[]")
      .attach("file", Buffer.from("pdf-data"), {
        contentType: "application/pdf",
        filename: "Product CV.pdf",
      })
      .expect(401, { error: { code: "authentication_required" } });
  });

  it("uploads, lists, associates, and downloads an original", async () => {
    const { app, application, documentTypeId } = await createDocumentsApp();
    const cookie = await login(app);
    const bytes = Buffer.from("pdf-data");

    const uploaded = await sameOrigin(request(app).post("/api/documents"))
      .set("Cookie", cookie)
      .field("documentTypeId", documentTypeId)
      .field("applicationIds", JSON.stringify([application.id]))
      .attach("file", bytes, {
        contentType: "application/pdf",
        filename: "Product CV.pdf",
      })
      .expect(201);
    const document = responseDocument(uploaded);
    expect(document).toMatchObject({
      applications: [
        expect.objectContaining({
          companyName: "Example Studio",
          id: application.id,
        }),
      ],
      byteSize: bytes.length,
      documentType: "CV",
      mediaType: "application/pdf",
      originalFilename: "Product CV.pdf",
    });
    const documentId = document.id;
    if (typeof documentId !== "string") {
      throw new Error("Expected a document identifier");
    }

    await request(app)
      .get("/api/documents")
      .set("Cookie", cookie)
      .expect(200, {
        documents: [document],
        maxUploadBytes: 1024,
      });
    const downloaded = await request(app)
      .get(`/api/documents/${documentId}/download`)
      .set("Cookie", cookie)
      .expect("Content-Type", "application/octet-stream")
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Content-Disposition", /attachment/)
      .expect(200);
    expect(downloaded.body).toEqual(bytes);
  });

  it("rejects cross-origin, oversized, malformed, and invalid-reference uploads", async () => {
    const { app, documentTypeId } = await createDocumentsApp(8);
    const cookie = await login(app);

    await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .field("documentTypeId", documentTypeId)
      .field("applicationIds", "[]")
      .attach("file", Buffer.from("pdf-data"), "Product CV.pdf")
      .expect(403, { error: { code: "csrf_rejected" } });
    await sameOrigin(request(app).post("/api/documents"))
      .set("Cookie", cookie)
      .field("documentTypeId", documentTypeId)
      .field("applicationIds", "[]")
      .attach("file", Buffer.alloc(9), "Oversized.pdf")
      .expect(413, { error: { code: "document_too_large" } });
    await sameOrigin(request(app).post("/api/documents"))
      .set("Cookie", cookie)
      .field("documentTypeId", documentTypeId)
      .field("applicationIds", "not-json")
      .attach("file", Buffer.from("pdf-data"), "Product CV.pdf")
      .expect(400, { error: { code: "validation_error" } });
    await sameOrigin(request(app).post("/api/documents"))
      .set("Cookie", cookie)
      .field("documentTypeId", documentTypeId)
      .field(
        "applicationIds",
        JSON.stringify(["33333333-3333-4333-8333-333333333333"]),
      )
      .attach("file", Buffer.from("pdf-data"), "Product CV.pdf")
      .expect(400, { error: { code: "invalid_document_reference" } });
  });

  it("returns stable errors for missing files and originals", async () => {
    const { app, documentTypeId } = await createDocumentsApp();
    const cookie = await login(app);

    await sameOrigin(request(app).post("/api/documents"))
      .set("Cookie", cookie)
      .field("documentTypeId", documentTypeId)
      .field("applicationIds", "[]")
      .expect(400, { error: { code: "invalid_upload" } });
    await request(app)
      .get("/api/documents/44444444-4444-4444-8444-444444444444/download")
      .set("Cookie", cookie)
      .expect(404, { error: { code: "document_not_found" } });
  });

  it("generates, caches, and returns an authorized plain-text preview", async () => {
    const { app, documentTypeId } = await createDocumentsApp();
    const cookie = await login(app);
    const uploaded = await sameOrigin(request(app).post("/api/documents"))
      .set("Cookie", cookie)
      .field("documentTypeId", documentTypeId)
      .field("applicationIds", "[]")
      .attach("file", Buffer.from("First line\r\nSecond line"), {
        contentType: "text/plain",
        filename: "notes.txt",
      })
      .expect(201);
    const documentId = responseDocument(uploaded).id;
    if (typeof documentId !== "string") throw new Error("Missing document ID");

    const expected = {
      preview: {
        documentId,
        generatedAt: "2026-07-19T10:05:00.000Z",
        mediaType: "text/plain",
        parserVersion: "plain-text-v1",
        status: "ready",
        text: "First line\nSecond line",
        truncated: false,
      },
    };
    await request(app)
      .get(`/api/documents/${documentId}/preview`)
      .set("Cookie", cookie)
      .expect(200, expected);
    await request(app)
      .get(`/api/documents/${documentId}/preview`)
      .set("Cookie", cookie)
      .expect(200, expected);
  });

  it("reports unsupported, oversized, malformed, and unauthenticated previews", async () => {
    const { app, documentTypeId } = await createDocumentsApp(1024, 8);
    const cookie = await login(app);
    const upload = async (
      bytes: Buffer,
      contentType: string,
      filename: string,
    ) => {
      const response = await sameOrigin(request(app).post("/api/documents"))
        .set("Cookie", cookie)
        .field("documentTypeId", documentTypeId)
        .field("applicationIds", "[]")
        .attach("file", bytes, { contentType, filename })
        .expect(201);
      const id = responseDocument(response).id;
      if (typeof id !== "string") throw new Error("Missing document ID");
      return id;
    };
    const pdfId = await upload(
      Buffer.from("pdf-data"),
      "application/pdf",
      "cv.pdf",
    );
    const largeId = await upload(
      Buffer.from("ninebytes"),
      "text/plain",
      "large.txt",
    );
    const binaryId = await upload(
      Buffer.from([0, 1, 2, 3]),
      "text/plain",
      "binary.txt",
    );

    await request(app)
      .get(`/api/documents/${pdfId}/preview`)
      .set("Cookie", cookie)
      .expect(200, {
        preview: {
          documentId: pdfId,
          mediaType: "application/pdf",
          status: "unsupported",
        },
      });
    await request(app)
      .get(`/api/documents/${largeId}/preview`)
      .set("Cookie", cookie)
      .expect(413, { error: { code: "document_preview_too_large" } });
    await request(app)
      .get(`/api/documents/${binaryId}/preview`)
      .set("Cookie", cookie)
      .expect(422, { error: { code: "document_preview_failed" } });
    await request(app)
      .get(`/api/documents/${pdfId}/preview`)
      .expect(401, { error: { code: "authentication_required" } });
    await request(app)
      .get("/api/documents/not-a-document/preview")
      .set("Cookie", cookie)
      .expect(400, { error: { code: "validation_error" } });
  });
});
