import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { ApplicationLedgerService } from "../application/applications.js";
import { DocumentLibraryService } from "../application/documents.js";
import { JobEmailReconciliationService } from "../application/job_email_reconciliation.js";
import {
  ApplicationMcpService,
  LocalMcpActorProvider,
} from "../application/mcp.js";
import { McpConnectionAccessPolicy } from "../application/mcp_access.js";
import { McpAuditService } from "../application/mcp_audit.js";
import { McpDocumentImportManager } from "../application/mcp_document_imports.js";
import { ReferenceValuesService } from "../application/reference_values.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteDocumentsRepository } from "../infrastructure/database/documents_repository.js";
import { SqliteMcpActorRepository } from "../infrastructure/database/mcp_actor_repository.js";
import { SqliteMcpAuditRepository } from "../infrastructure/database/mcp_audit_repository.js";
import { SqliteJobEmailReconciliationRepository } from "../infrastructure/database/job_email_reconciliation_repository.js";
import { SqliteReferenceValuesRepository } from "../infrastructure/database/reference_values_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { createLocalMcpServer } from "./mcp_server.js";

const clients: Client[] = [];
const servers: ReturnType<typeof createLocalMcpServer>[] = [];
const databases: ReturnType<typeof openApplicationDatabase>[] = [];

const documentPolicy = {
  maxInstallationBytes: 10 * 1024 * 1024,
  maxInstallationDocuments: 100,
  maxUploadBytes: 1024 * 1024,
  maxWorkspaceBytes: 5 * 1024 * 1024,
  maxWorkspaceDocuments: 50,
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  for (const database of databases.splice(0)) database.close();
});

describe("MCP write integration", () => {
  it("applies access changes to an existing session and audits writes atomically", async () => {
    const database = openApplicationDatabase(":memory:");
    databases.push(database);
    const setup = new SqliteSetupRepository(
      database,
    ).createInitialAdministrator({
      completedAt: "2026-07-19T14:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    const actorProvider = new LocalMcpActorProvider(
      new SqliteMcpActorRepository(database),
      { username: "alex", workspaceSlug: "default" },
    );
    const access = new McpConnectionAccessPolicy("read_only");
    const documents = new DocumentLibraryService(
      new SqliteDocumentsRepository(database, documentPolicy),
      documentPolicy,
      () => new Date("2026-07-19T16:00:30.000Z"),
    );
    const tools = new ApplicationMcpService(
      actorProvider,
      new ApplicationLedgerService(
        new SqliteApplicationsRepository(database),
        () => new Date("2026-07-19T16:00:00.000Z"),
      ),
      new ReferenceValuesService(new SqliteReferenceValuesRepository(database)),
      access,
      documents,
      new McpDocumentImportManager(documentPolicy.maxUploadBytes),
    );
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: setup.administrator.id,
        recorder: new McpAuditService(
          new SqliteMcpAuditRepository(database),
          () => new Date("2026-07-19T16:01:00.000Z"),
        ),
        runAtomically: (operation) =>
          database.transaction(operation).immediate(),
        workspaceId: setup.workspace.id,
      },
    });
    const client = new Client({ name: "write-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    clients.push(client);
    servers.push(server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const statusId = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = 'status'
         ORDER BY sort_order LIMIT 1`,
      )
      .pluck()
      .get(setup.workspace.id) as string;

    const blocked = await client.callTool({
      arguments: {
        companyName: "Blocked Company",
        roleTitle: "Engineer",
        statusId,
      },
      name: "create_application",
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toEqual([
      {
        text: '{"error":{"code":"write_access_disabled"}}',
        type: "text",
      },
    ]);

    access.update("read_write");

    const created = await client.callTool({
      arguments: {
        companyName: "Example Company",
        roleTitle: "Engineer",
        statusId,
      },
      name: "create_application",
    });
    expect(created.isError).not.toBe(true);
    const applicationId = String(created.structuredContent?.id);
    const expectedUpdatedAt = String(created.structuredContent?.updatedAt);

    const updated = await client.callTool({
      arguments: {
        applicationId,
        update: {
          companyName: "Updated Company",
          expectedUpdatedAt,
          notes: "Follow up",
        },
      },
      name: "update_application",
    });
    expect(updated.structuredContent).toMatchObject({
      companyName: "Updated Company",
      notes: "Follow up",
    });

    const stale = await client.callTool({
      arguments: {
        applicationId,
        update: { companyName: "Stale overwrite", expectedUpdatedAt },
      },
      name: "update_application",
    });
    expect(stale.isError).toBe(true);
    expect(stale.content).toEqual([
      {
        text: '{"error":{"code":"application_conflict"}}',
        type: "text",
      },
    ]);

    const deleted = await client.callTool({
      arguments: { applicationId, confirm: true },
      name: "delete_application",
    });
    expect(deleted.structuredContent).toEqual({
      applicationId,
      deleted: true,
    });
    expect(
      database
        .prepare("SELECT count(*) FROM application_deletions")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      database
        .prepare(
          `SELECT action, result, transport FROM mcp_audit_events
           ORDER BY occurred_at, rowid`,
        )
        .all(),
    ).toEqual([
      {
        action: "create_application",
        result: "denied",
        transport: "local_stdio",
      },
      {
        action: "create_application",
        result: "success",
        transport: "local_stdio",
      },
      {
        action: "update_application",
        result: "success",
        transport: "local_stdio",
      },
      {
        action: "update_application",
        result: "error",
        transport: "local_stdio",
      },
      {
        action: "delete_application",
        result: "success",
        transport: "local_stdio",
      },
    ]);

    database.exec(`
      CREATE TRIGGER reject_mcp_audit_smoke
      BEFORE INSERT ON mcp_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'synthetic audit failure');
      END;
    `);
    const rolledBack = await client.callTool({
      arguments: {
        companyName: "Must Roll Back",
        roleTitle: "Engineer",
        statusId,
      },
      name: "create_application",
    });
    expect(rolledBack.isError).toBe(true);
    expect(rolledBack.content).toEqual([
      { text: '{"error":{"code":"internal_error"}}', type: "text" },
    ]);
    expect(
      database
        .prepare("SELECT count(*) FROM applications WHERE deleted_at IS NULL")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("imports document chunks idempotently with application associations", async () => {
    const database = openApplicationDatabase(":memory:");
    databases.push(database);
    const setup = new SqliteSetupRepository(
      database,
    ).createInitialAdministrator({
      completedAt: "2026-07-19T14:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    const actorProvider = new LocalMcpActorProvider(
      new SqliteMcpActorRepository(database),
      { username: "alex", workspaceSlug: "default" },
    );
    const access = new McpConnectionAccessPolicy("read_write");
    const documents = new DocumentLibraryService(
      new SqliteDocumentsRepository(database, documentPolicy),
      documentPolicy,
      () => new Date("2026-07-19T16:00:30.000Z"),
    );
    const tools = new ApplicationMcpService(
      actorProvider,
      new ApplicationLedgerService(
        new SqliteApplicationsRepository(database),
        () => new Date("2026-07-19T16:00:00.000Z"),
      ),
      new ReferenceValuesService(new SqliteReferenceValuesRepository(database)),
      access,
      documents,
      new McpDocumentImportManager(documentPolicy.maxUploadBytes),
    );
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: setup.administrator.id,
        recorder: new McpAuditService(
          new SqliteMcpAuditRepository(database),
          () => new Date("2026-07-19T16:01:00.000Z"),
        ),
        runAtomically: (operation) =>
          database.transaction(operation).immediate(),
        workspaceId: setup.workspace.id,
      },
    });
    const client = new Client({ name: "document-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    clients.push(client);
    servers.push(server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const statusId = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = 'status'
         ORDER BY sort_order LIMIT 1`,
      )
      .pluck()
      .get(setup.workspace.id) as string;
    const documentTypeId = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = 'document_type'
         ORDER BY sort_order LIMIT 1`,
      )
      .pluck()
      .get(setup.workspace.id) as string;
    const created = await client.callTool({
      arguments: {
        companyName: "Example Company",
        roleTitle: "Engineer",
        statusId,
      },
      name: "create_application",
    });
    const applicationId = String(created.structuredContent?.id);
    const bytes = Buffer.from("complete legacy document contents");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const beginInput = {
      applicationIds: [applicationId],
      byteSize: bytes.byteLength,
      documentTypeId,
      mediaType: "text/plain",
      originalFilename: "resume.txt",
      sha256,
      idempotencyKey: "legacy-jobtracker:legacy-document-1",
    };
    const begun = await client.callTool({
      arguments: beginInput,
      name: "begin_document_import",
    });
    const uploadId = String(begun.structuredContent?.uploadId);
    expect(begun.structuredContent).toMatchObject({
      complete: false,
      nextOffset: 0,
      receivedBytes: 0,
      idempotencyKey: "legacy-jobtracker:legacy-document-1",
    });

    const chunkSha256 = createHash("sha256").update(bytes).digest("hex");
    const appended = await client.callTool({
      arguments: {
        chunkSha256,
        contentBase64: bytes.toString("base64"),
        offset: 0,
        uploadId,
      },
      name: "append_document_chunk",
    });
    expect(appended.structuredContent).toMatchObject({
      complete: true,
      nextOffset: bytes.byteLength,
      receivedBytes: bytes.byteLength,
    });

    const completed = await client.callTool({
      arguments: { uploadId },
      name: "complete_document_import",
    });
    const completedAgain = await client.callTool({
      arguments: { uploadId },
      name: "complete_document_import",
    });
    const importedDocumentId = String(completed.structuredContent?.id);
    expect(completed.isError).not.toBe(true);
    expect(completedAgain.structuredContent?.id).toBe(importedDocumentId);
    expect(completed.structuredContent).toMatchObject({
      applications: [
        {
          companyName: "Example Company",
          id: applicationId,
          roleTitle: "Engineer",
        },
      ],
      byteSize: bytes.byteLength,
      documentTypeId,
      mediaType: "text/plain",
      originalFilename: "resume.txt",
    });

    const listed = await client.callTool({
      arguments: {},
      name: "list_documents",
    });
    expect(listed.structuredContent).toMatchObject({
      documents: [{ id: importedDocumentId }],
      nextOffset: null,
      offset: 0,
      returned: 1,
      total: 1,
    });
    const exported = await client.callTool({
      arguments: { documentId: importedDocumentId, offset: 0 },
      name: "export_document_chunk",
    });
    expect(exported.isError).not.toBe(true);
    expect(exported.structuredContent).toMatchObject({
      byteSize: bytes.byteLength,
      chunkByteSize: bytes.byteLength,
      chunkSha256,
      complete: true,
      nextOffset: null,
      offset: 0,
      sha256,
    });
    expect(
      Buffer.from(String(exported.structuredContent?.contentBase64), "base64"),
    ).toEqual(bytes);
    const invalidOffset = await client.callTool({
      arguments: {
        documentId: importedDocumentId,
        offset: bytes.byteLength,
      },
      name: "export_document_chunk",
    });
    expect(invalidOffset.content).toEqual([
      {
        text: '{"error":{"code":"invalid_document_export_offset"}}',
        type: "text",
      },
    ]);
    const cancelled = await client.callTool({
      arguments: { uploadId },
      name: "cancel_document_import",
    });
    expect(cancelled.structuredContent).toEqual({ cancelled: true });
    expect(
      database.prepare("SELECT count(*) FROM documents").pluck().get(),
    ).toBe(1);
    expect(
      database.prepare("SELECT count(*) FROM file_objects").pluck().get(),
    ).toBe(1);
  });

  it("matches and idempotently upserts persisted job-email evidence", async () => {
    const database = openApplicationDatabase(":memory:");
    databases.push(database);
    const setup = new SqliteSetupRepository(
      database,
    ).createInitialAdministrator({
      completedAt: "2026-07-21T14:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    const actorProvider = new LocalMcpActorProvider(
      new SqliteMcpActorRepository(database),
      { username: "alex", workspaceSlug: "default" },
    );
    const applications = new ApplicationLedgerService(
      new SqliteApplicationsRepository(database),
      () => new Date("2026-07-21T16:00:00.000Z"),
    );
    const jobEmails = new JobEmailReconciliationService(
      new SqliteJobEmailReconciliationRepository(database),
      applications,
      (operation) => database.transaction(operation).immediate(),
      () => new Date("2026-07-21T16:01:00.000Z"),
    );
    const documents = new DocumentLibraryService(
      new SqliteDocumentsRepository(database, documentPolicy),
      documentPolicy,
    );
    const tools = new ApplicationMcpService(
      actorProvider,
      applications,
      new ReferenceValuesService(new SqliteReferenceValuesRepository(database)),
      new McpConnectionAccessPolicy("read_write"),
      documents,
      new McpDocumentImportManager(documentPolicy.maxUploadBytes),
      jobEmails,
    );
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: setup.administrator.id,
        recorder: new McpAuditService(new SqliteMcpAuditRepository(database)),
        runAtomically: (operation) =>
          database.transaction(operation).immediate(),
        workspaceId: setup.workspace.id,
      },
    });
    const client = new Client({ name: "job-email-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    clients.push(client);
    servers.push(server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const statusId = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = 'status'
         ORDER BY sort_order LIMIT 1`,
      )
      .pluck()
      .get(setup.workspace.id) as string;
    const arguments_ = {
      application: {
        companyName: "Example Company",
        roleTitle: "Platform Engineer",
        statusId,
      },
      email: {
        messageId: "<linkedin-4405273020@example.com>",
        receivedAt: "2026-07-21T15:30:00Z",
        webUrl: "https://outlook.office.com/mail/inbox/id/example",
      },
      posting: {
        url: "https://www.linkedin.com/comm/jobs/view/4405273020?trackingId=email",
      },
    };

    const first = await client.callTool({
      arguments: arguments_,
      name: "upsert_application_from_email",
    });
    const repeated = await client.callTool({
      arguments: arguments_,
      name: "upsert_application_from_email",
    });
    const storedApplicationId = database
      .prepare(
        "SELECT id FROM applications WHERE workspace_id = ? AND deleted_at IS NULL",
      )
      .pluck()
      .get(setup.workspace.id);
    if (typeof storedApplicationId !== "string") {
      throw new Error("Missing application from job-email upsert result");
    }
    const applicationId = storedApplicationId;

    expect(first.structuredContent).toMatchObject({
      action: "created",
      emailEvidenceLinked: true,
      matchLevel: null,
      postingLinked: true,
    });
    expect(repeated.structuredContent).toMatchObject({
      action: "matched",
      application: { id: applicationId },
      emailEvidenceLinked: false,
      matchLevel: "posting_id",
      postingLinked: false,
    });
    const matched = await client.callTool({
      arguments: {
        posting: {
          url: "https://www.linkedin.com/jobs/view/4405273020?refId=other",
        },
      },
      name: "match_job_application_email",
    });
    expect(matched.structuredContent).toMatchObject({
      level: "posting_id",
      matches: [{ id: applicationId }],
      outcome: "matched",
    });
    const detail = await client.callTool({
      arguments: { applicationId },
      name: "get_application",
    });
    expect(detail.structuredContent).toMatchObject({
      emailEvidence: [{ messageId: "<linkedin-4405273020@example.com>" }],
      jobPostings: [{ externalPostingId: "4405273020", provider: "linkedin" }],
    });
    expect(
      database
        .prepare("SELECT count(*) FROM applications WHERE deleted_at IS NULL")
        .pluck()
        .get(),
    ).toBe(1);
    await client.callTool({
      arguments: {
        companyName: "Example Company",
        roleTitle: "Platform Engineer",
        statusId,
      },
      name: "create_application",
    });
    const ambiguous = await client.callTool({
      arguments: {
        companyName: "example company",
        roleTitle: "platform engineer",
      },
      name: "match_job_application_email",
    });
    expect(ambiguous.structuredContent).toMatchObject({
      level: "company_title",
      matches: [
        { companyName: "Example Company" },
        { companyName: "Example Company" },
      ],
      outcome: "ambiguous",
    });
    expect(
      database
        .prepare(
          `SELECT action FROM mcp_audit_events
           WHERE action IN (
             'match_job_application_email',
             'upsert_application_from_email'
           )
           ORDER BY rowid`,
        )
        .pluck()
        .all(),
    ).toEqual([
      "upsert_application_from_email",
      "upsert_application_from_email",
      "match_job_application_email",
      "match_job_application_email",
    ]);
  });
});
