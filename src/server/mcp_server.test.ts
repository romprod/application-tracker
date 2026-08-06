import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationNotFoundError } from "../application/applications.js";
import type {
  RecordApplicationFieldProvenanceInput,
  VerifyApplicationFieldProvenanceInput,
} from "../domain/applications.js";
import {
  applicationMcpPublishedSchema,
  applicationMcpSchemaManifest,
  applicationMcpToolNames,
  LocalMcpActorUnavailableError,
  type McpApplicationTools,
} from "../application/mcp.js";
import { McpWriteAccessDisabledError } from "../application/mcp_access.js";
import type { McpAuditRecorder } from "../application/mcp_audit.js";
import { OutlookEmailSyncOperationalError } from "../application/outlook_email_sync.js";
import type { ApplicationLogger } from "./logging.js";
import { createLocalMcpServer } from "./mcp_server.js";

const clients: Client[] = [];
const servers: ReturnType<typeof createLocalMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

function fakeTools(): McpApplicationTools {
  return {
    addApplicationActivity: vi.fn(),
    addApplicationEvent: vi.fn(),
    auditDuplicateApplications: vi.fn(() => ({
      candidates: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    appendDocumentChunk: vi.fn(),
    beginDocumentImport: vi.fn(),
    bulkUpdateApplications: vi.fn(),
    cancelDocumentImport: vi.fn(),
    completeDocumentImport: vi.fn(),
    createApplication: vi.fn(),
    deleteApplication: vi.fn(),
    extractJobLinks: vi.fn(() => ({
      candidates: [
        {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin" as const,
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      ],
    })),
    exportDocumentChunk: vi.fn(),
    findDuplicateApplications: vi.fn(() => ({
      candidates: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    getApplication: vi.fn(() => {
      throw new ApplicationNotFoundError();
    }),
    getApplicationDataQuality: vi.fn(() => ({
      countsByCode: [],
      findings: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      totalApplications: 0,
      totalFindings: 0,
    })),
    getJobSearchSummary: vi.fn(() => ({
      asOfDate: "2026-01-01",
      byStatus: [],
      dueTodayActions: 0,
      openActions: 0,
      openApplications: 0,
      overdueActions: 0,
      terminalApplications: 0,
      totalApplications: 0,
    })),
    queryApplicationAttention: vi.fn(() => ({
      applications: [],
      limit: 25,
      nextOffset: null,
      offset: 0,
      returned: 0,
      summary: {
        byReason: [],
        byState: [],
        queuedApplications: 0,
        totalApplications: 0,
      },
      total: 0,
    })),
    getDocumentImportCapabilities: vi.fn(() => ({
      maxDocumentBytes: 1024 * 1024,
      maxDocumentChunkBytes: 12 * 1024,
    })),
    getReferenceData: vi.fn(() => ({ values: [] })),
    getTrackerContext: vi.fn(() => ({
      access: "read_only" as const,
      actor: {
        displayName: "Alex Example",
        role: "admin" as const,
        username: "alex",
      },
      workspace: { name: "Applications", slug: "default" },
    })),
    inspectJobPosting: vi.fn(() =>
      Promise.resolve({
        canonicalUrl: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
        reason: "provider_challenge" as const,
        retryAfter: "2026-07-30T08:15:00.000Z",
        status: "unavailable" as const,
      }),
    ),
    linkEmailEvidence: vi.fn(),
    listApplications: vi.fn(() => ({
      applications: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    listDeletedApplications: vi.fn(() => ({
      applications: [],
      limit: 25,
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    listApplicationEvents: vi.fn(() => ({
      events: [],
      limit: 25,
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    listUnlinkedApplications: vi.fn(() => ({
      applications: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    listDocuments: vi.fn(() => ({
      documents: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    })),
    matchJobApplicationEmail: vi.fn(() => ({
      level: null,
      matches: [],
      outcome: "none" as const,
    })),
    mergeApplications: vi.fn(),
    previewApplicationRestore: vi.fn(),
    recoverApplicationMerge: vi.fn(),
    prepareSyncOutlookEmailEvidence: vi.fn(() =>
      Promise.reject(new Error("not configured")),
    ),
    prepareReconcileOutlookGraphConnection: vi.fn(() =>
      Promise.reject(new Error("not configured")),
    ),
    prepareReviewNewOutlookJobDigests: vi.fn(() =>
      Promise.reject(new Error("not configured")),
    ),
    processOutlookJobDigest: vi.fn(() =>
      Promise.resolve(outlookJobDigestResult()),
    ),
    searchOutlookJobDigests: vi.fn(() =>
      Promise.resolve(outlookJobDigestSearchResult()),
    ),
    reconcileApplicationFromEvidence: vi.fn(),
    recordApplicationFieldProvenance: vi.fn(
      (input: RecordApplicationFieldProvenanceInput) => ({
        applicationId: input.applicationId,
        confidence: input.confidence,
        createdAt: "2026-07-30T12:00:00.000Z",
        field: input.field,
        fieldState: input.fieldState,
        id: "33333333-3333-4333-8333-333333333333",
        idempotencyKey: input.idempotencyKey ?? null,
        observedAt: input.observedAt,
        relationship: "selected" as const,
        source: input.source,
        value: input.value,
        verifiedAt: null,
        verifiedByDisplayName: null,
        verifiedByUserId: null,
      }),
    ),
    resolveJobLinks: vi.fn(() =>
      Promise.resolve({
        candidates: [
          {
            externalPostingId: "4405273020",
            host: "www.linkedin.com",
            provider: "linkedin" as const,
            redirectsFollowed: 0,
            resolution: "deterministic" as const,
            url: "https://www.linkedin.com/jobs/view/4405273020",
          },
        ],
        tracking: { attempted: 0, resolved: 0, unavailable: [] },
      }),
    ),
    restoreApplication: vi.fn(),
    updateApplication: vi.fn(),
    upsertApplicationFromEmail: vi.fn(),
    verifyApplicationFieldProvenance: vi.fn(
      (input: VerifyApplicationFieldProvenanceInput) => ({
        applicationId: input.applicationId,
        confidence: 0.9,
        createdAt: "2026-07-30T12:00:00.000Z",
        field: "salary" as const,
        fieldState: "disclosed" as const,
        id: input.provenanceId,
        idempotencyKey: "salary-observation-1",
        observedAt: "2026-07-30T11:00:00.000Z",
        relationship: "selected" as const,
        source: { type: "imported" as const },
        value: "£75,000",
        verifiedAt: "2026-07-30T12:05:00.000Z",
        verifiedByDisplayName: "Alex Example",
        verifiedByUserId: "44444444-4444-4444-8444-444444444444",
      }),
    ),
  };
}

function outlookSyncResult() {
  return {
    application: {
      agency: null,
      appliedOn: "2026-07-20",
      companyName: "Example Company",
      contacts: [],
      createdAt: "2026-07-20T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      links: [],
      location: null,
      nextAction: null,
      nextActionDue: null,
      notes: null,
      outlookGraphConnectionId: null,
      outlookGraphConnectionName: null,
      rating: null,
      roleTitle: "Platform Engineer",
      roleType: null,
      roleTypeId: null,
      salary: null,
      source: null,
      sourceId: null,
      sourceUrl: null,
      status: "Applied",
      statusId: "22222222-2222-4222-8222-222222222222",
      statusIsTerminal: false,
      updatedAt: "2026-07-20T12:00:00.000Z",
      workArrangement: null,
    },
    candidateAssessments: [],
    emailEvidence: [],
    existingEvidenceValidation: [],
    link: { attempted: false, created: false },
    outcome: "no_match" as const,
    scoringVersion: 1,
    search: { candidatesRetrieved: 0, detailsRead: 0, queriesRun: 1 },
    selectedEvidence: null,
    threshold: 80,
    verification: {
      applicationReread: true as const,
      evidenceStored: false,
      storedMessageId: null,
    },
  };
}

function outlookConnectionReconciliationResult() {
  return {
    connection: {
      folderPath: "Inbox\\Jobs",
      id: "22222222-2222-4222-8222-222222222222",
      mailbox: "jobs@example.com",
      name: "Work tenant",
    },
    messages: [],
    reconciliation: {
      alreadyLinked: 0,
      ambiguous: 0,
      assignedApplications: 12,
      conflicts: 0,
      detailsRead: 0,
      hasMore: false,
      linked: 0,
      messagesRetrieved: 0,
      noMatch: 0,
    },
    scoringVersion: 1,
    threshold: 80,
    verification: {
      connectionReread: true as const,
      cursorStored: true,
      linkedMessageIds: [],
    },
    window: {
      previousReconciledAt: "2026-07-29T10:00:00.000Z",
      since: "2026-07-29T10:00:00.000Z",
      storedLastReconciledAt: "2026-07-29T11:00:00.000Z",
      through: "2026-07-29T11:00:00.000Z",
    },
  };
}

function outlookJobDigestResult() {
  return {
    classification: "marketing_or_digest" as const,
    connection: {
      folderPath: "Inbox\\Jobs",
      id: "22222222-2222-4222-8222-222222222222",
      mailbox: "jobs@example.com",
      name: "Work tenant",
    },
    digest: {
      messageId: "<digest-1@example.com>",
      receivedAt: "2026-07-30T08:00:00.000Z",
      sender: "alerts@example.com",
      subject: "Daily job alert",
    },
    outcome: "processed" as const,
    page: { nextOffset: null, offset: 0, returned: 1, total: 1 },
    postings: [
      {
        candidate: {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin" as const,
          redirectsFollowed: 0,
          resolution: "deterministic" as const,
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
        descriptionTruncated: false,
        digestFallback: {
          attempted: true,
          unavailableReason: "employer_missing" as const,
        },
        inspection: {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4405273020",
          reason: "provider_challenge" as const,
          retryAfter: "2026-07-30T08:15:00.000Z",
          status: "unavailable" as const,
        },
        inspectionSource: "provider_page" as const,
        match: { level: null, matches: [], outcome: "none" as const },
      },
    ],
    tracking: { attempted: 0, resolved: 0, unavailable: [] },
    verification: {
      exactMessageMatches: 1,
      mailboxReadOnly: true as const,
      messageBodyReturned: false as const,
    },
  };
}

function outlookJobDigestSearchResult() {
  return {
    connection: {
      folderPath: "Inbox\\Jobs",
      id: "22222222-2222-4222-8222-222222222222",
      lastReconciledAt: "2026-07-30T09:00:00.000Z",
      mailbox: "jobs@example.com",
      name: "Work tenant",
    },
    messages: [
      {
        classification: "marketing_or_digest" as const,
        messageId: "<digest-1@example.com>",
        receivedAt: "2026-07-29T08:00:00.000Z",
        sender: "alerts@example.com",
        subject: "Daily job alert",
      },
    ],
    page: {
      batchStartOffset: 0,
      detailsRead: 1,
      limit: 20,
      limitReached: false,
      nextCursor: null,
      nextOffset: null,
      offset: 0,
      scanned: 1,
    },
    unavailable: [],
    verification: {
      applicationStateChanged: false as const,
      cursorChanged: false as const,
      mailboxReadOnly: true as const,
      messageBodyReturned: false as const,
    },
    window: {
      after: "2026-07-23T00:00:00.000Z",
      before: "2026-07-30T09:00:00.000Z",
    },
  };
}

function outlookJobDigestReviewResult() {
  return {
    checkpoint: {
      hasMore: false,
      initializationReason: "first_use" as const,
      initialized: true,
      previousCompletedAt: null,
      storedCompletedAt: "2026-08-06T09:00:00.000Z",
    },
    connection: {
      folderPath: "Inbox\\Jobs",
      id: "22222222-2222-4222-8222-222222222222",
      mailbox: "jobs@example.com",
      name: "Work tenant",
    },
    counts: {
      alreadyReviewedMessages: 0,
      alreadyTracked: 0,
      ambiguous: 0,
      conflicting: 0,
      detailsRead: 0,
      digestsProcessed: 0,
      expired: 0,
      messagesScanned: 0,
      postingsInspected: 0,
      unavailable: 0,
      unprocessed: 0,
    },
    digests: [],
    outcome: "initialized" as const,
    reviewedMessageIds: [],
    unavailableReasons: [],
    verification: {
      applicationStateChanged: false as const,
      checkpointStored: true as const,
      mailboxReadOnly: true as const,
      messageBodyPersisted: false as const,
      messageBodyReturned: false as const,
    },
    window: { after: null, through: "2026-08-06T09:00:00.000Z" },
  };
}

describe("local MCP server", () => {
  it("registers bounded read and write tools without actor selection arguments", async () => {
    const tools = fakeTools();
    const bulkUpdateApplications = vi.fn();
    tools.bulkUpdateApplications = bulkUpdateApplications;
    const listApplications = vi.spyOn(tools, "listApplications");
    const queryApplicationAttention = vi.spyOn(
      tools,
      "queryApplicationAttention",
    );
    const record = vi.fn();
    const recorder: McpAuditRecorder = { record };
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder,
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual(
      applicationMcpToolNames,
    );
    const readOnlyTools = new Set([
      "get_tracker_context",
      "get_connector_schema_status",
      "get_job_search_summary",
      "query_application_attention",
      "list_applications",
      "list_deleted_applications",
      "preview_application_restore",
      "get_application",
      "list_application_events",
      "list_unlinked_applications",
      "get_application_data_quality",
      "audit_duplicate_applications",
      "find_duplicate_applications",
      "match_job_application_email",
      "search_outlook_job_digests",
      "process_outlook_job_digest",
      "extract_job_links",
      "resolve_job_links",
      "inspect_job_posting",
      "get_reference_data",
      "get_document_import_capabilities",
      "list_documents",
      "export_document_chunk",
    ]);
    const openWorldReadOnlyTools = new Set([
      "resolve_job_links",
      "inspect_job_posting",
      "search_outlook_job_digests",
      "process_outlook_job_digest",
    ]);
    const openWorldWriteTools = new Set([
      "sync_outlook_email_evidence",
      "reconcile_outlook_graph_connection",
      "review_new_outlook_job_digests",
    ]);
    const nonIdempotentWriteTools = new Set([
      "create_application",
      "update_application",
      "bulk_update_applications",
      "delete_application",
      "add_application_event",
      "add_application_activity",
      "record_application_field_provenance",
      "restore_application",
      "recover_application_merge",
      "reconcile_outlook_graph_connection",
      "review_new_outlook_job_digests",
    ]);
    for (const tool of listed.tools) {
      if (readOnlyTools.has(tool.name)) {
        expect(tool.annotations).toMatchObject({
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: openWorldReadOnlyTools.has(tool.name),
          readOnlyHint: true,
        });
      } else {
        expect(tool.annotations).toMatchObject({
          idempotentHint: !nonIdempotentWriteTools.has(tool.name),
          openWorldHint: openWorldWriteTools.has(tool.name),
          readOnlyHint: false,
        });
      }
    }
    expect(
      listed.tools.find(({ name }) => name === "delete_application")
        ?.annotations,
    ).toMatchObject({ destructiveHint: true });
    expect(
      listed.tools.find(({ name }) => name === "merge_applications")
        ?.annotations,
    ).toMatchObject({ destructiveHint: true, idempotentHint: true });
    for (const tool of listed.tools) {
      expect(tool.inputSchema.properties).not.toHaveProperty("actor");
      expect(tool.inputSchema.properties).not.toHaveProperty("workspace");
      expect(tool.inputSchema.properties).not.toHaveProperty("username");
    }
    const createApplicationTool = listed.tools.find(
      ({ name }) => name === "create_application",
    );
    expect(createApplicationTool?.inputSchema.properties).toHaveProperty(
      "salary",
    );
    expect(createApplicationTool?.inputSchema.properties).toHaveProperty(
      "rating",
    );
    expect(createApplicationTool?.inputSchema.properties).toHaveProperty(
      "agency",
    );
    expect(createApplicationTool?.inputSchema.properties).toHaveProperty(
      "workArrangement",
    );
    expect(createApplicationTool?.inputSchema.properties).toHaveProperty(
      "salaryDetails",
    );
    expect(createApplicationTool?.inputSchema.properties).toHaveProperty(
      "workArrangementDetails",
    );
    expect(
      JSON.stringify(
        listed.tools.find(({ name }) => name === "list_applications")
          ?.outputSchema,
      ),
    ).toContain('"salary"');
    expect(
      JSON.stringify(
        listed.tools.find(({ name }) => name === "get_application")
          ?.outputSchema,
      ),
    ).toContain('"rating"');
    expect(
      JSON.stringify(
        listed.tools.find(({ name }) => name === "get_application")
          ?.outputSchema,
      ),
    ).toContain('"provenance"');
    const duplicateApplicationId = "11111111-1111-4111-8111-111111111111";
    const duplicateBulkUpdate = await client.callTool({
      arguments: {
        updates: [
          {
            applicationId: duplicateApplicationId,
            update: {
              expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
              notes: "First update",
            },
          },
          {
            applicationId: duplicateApplicationId,
            update: {
              expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
              notes: "Duplicate update",
            },
          },
        ],
      },
      name: "bulk_update_applications",
    });
    expect(duplicateBulkUpdate.isError).toBe(true);
    expect(bulkUpdateApplications).not.toHaveBeenCalled();

    const context = await client.callTool({
      arguments: {},
      name: "get_tracker_context",
    });
    expect(context.isError).not.toBe(true);
    expect(context.structuredContent).toMatchObject({ access: "read_only" });

    const schemaStatus = await client.callTool({
      arguments: {},
      name: "get_connector_schema_status",
    });
    expect(schemaStatus.isError).not.toBe(true);
    expect(schemaStatus.structuredContent).toEqual({
      documentationUrl:
        "https://developers.openai.com/apps-sdk/deploy/submission#how-published-app-metadata-versions-work",
      live: applicationMcpSchemaManifest,
      publication: {
        ...applicationMcpPublishedSchema,
        status: "update_available",
      },
      publicationRequired: false,
      refreshMethod: "scan_submit_publish",
      selfRefreshSupported: false,
    });

    const summary = await client.callTool({
      arguments: {},
      name: "get_job_search_summary",
    });
    expect(summary.isError).not.toBe(true);
    expect(summary.structuredContent).toMatchObject({ totalApplications: 0 });

    const attention = await client.callTool({
      arguments: {},
      name: "query_application_attention",
    });
    expect(attention.isError).not.toBe(true);
    expect(attention.structuredContent).toMatchObject({
      applications: [],
      summary: { queuedApplications: 0 },
    });
    expect(queryApplicationAttention.mock.calls).toEqual([
      [
        {
          attentionOnly: true,
          lifecycle: "all",
          limit: 25,
          offset: 0,
        },
      ],
    ]);

    const applications = await client.callTool({
      arguments: {},
      name: "list_applications",
    });
    expect(applications.isError).not.toBe(true);
    expect(listApplications).toHaveBeenCalledWith({ limit: 50, offset: 0 });

    const referenceData = await client.callTool({
      arguments: {},
      name: "get_reference_data",
    });
    expect(referenceData.isError).not.toBe(true);
    expect(referenceData.structuredContent).toEqual({ values: [] });

    const extracted = await client.callTool({
      arguments: {
        content:
          "Apply at https://www.linkedin.com/jobs/view/4405273020?trackingId=email",
      },
      name: "extract_job_links",
    });
    expect(extracted.isError).not.toBe(true);
    expect(extracted.structuredContent).toEqual({
      candidates: [
        {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin",
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      ],
    });

    const resolved = await client.callTool({
      arguments: {
        content:
          "Apply at https://www.linkedin.com/jobs/view/4405273020?trackingId=email",
      },
      name: "resolve_job_links",
    });
    expect(resolved.isError).not.toBe(true);
    expect(resolved.structuredContent).toMatchObject({
      candidates: [
        {
          redirectsFollowed: 0,
          resolution: "deterministic",
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      ],
      tracking: { attempted: 0, resolved: 0, unavailable: [] },
    });

    const inspected = await client.callTool({
      arguments: {
        url: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
      },
      name: "inspect_job_posting",
    });
    expect(inspected.isError).not.toBe(true);
    expect(inspected.structuredContent).toEqual({
      canonicalUrl: "https://uk.indeed.com/viewjob?jk=96550901704ee48a",
      reason: "provider_challenge",
      retryAfter: "2026-07-30T08:15:00.000Z",
      status: "unavailable",
    });

    const missing = await client.callTool({
      arguments: {
        applicationId: "11111111-1111-4111-8111-111111111111",
      },
      name: "get_application",
    });
    expect(missing.isError).toBe(true);
    expect(missing.content).toEqual([
      {
        text: '{"error":{"code":"application_not_found"}}',
        type: "text",
      },
    ]);
    expect(record).toHaveBeenCalledTimes(10);
    expect(record).toHaveBeenNthCalledWith(1, {
      action: "get_tracker_context",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "workspace",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(2, {
      action: "get_connector_schema_status",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "workspace",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(4, {
      action: "query_application_attention",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "application_collection",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(7, {
      action: "extract_job_links",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(8, {
      action: "resolve_job_links",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(9, {
      action: "inspect_job_posting",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
    expect(record).toHaveBeenNthCalledWith(10, {
      action: "get_application",
      actorUserId: "actor-user-1",
      result: "not_found",
      targetType: "application",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("executes the one-call Outlook sync and audits its prepared commit", async () => {
    const tools = fakeTools();
    const commit = vi.fn(() => outlookSyncResult());
    const prepare = vi.fn(() => Promise.resolve({ commit }));
    tools.prepareSyncOutlookEmailEvidence = prepare;
    const record = vi.fn();
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {
        applicationId: "11111111-1111-4111-8111-111111111111",
      },
      name: "sync_outlook_email_evidence",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(outlookSyncResult());
    expect(prepare).toHaveBeenCalledWith({
      applicationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      action: "sync_outlook_email_evidence",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("reconciles one Graph connection by mailbox and audits its prepared commit", async () => {
    const tools = fakeTools();
    const commit = vi.fn(() => outlookConnectionReconciliationResult());
    const prepare = vi.fn(() => Promise.resolve({ commit }));
    tools.prepareReconcileOutlookGraphConnection = prepare;
    const record = vi.fn();
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: { connection: "jobs@example.com" },
      name: "reconcile_outlook_graph_connection",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(
      outlookConnectionReconciliationResult(),
    );
    expect(prepare).toHaveBeenCalledWith({
      connection: "jobs@example.com",
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      action: "reconcile_outlook_graph_connection",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("processes one exact Outlook digest as a read-only audited call", async () => {
    const tools = fakeTools();
    const process = vi.fn(() => Promise.resolve(outlookJobDigestResult()));
    tools.processOutlookJobDigest = process;
    const record = vi.fn();
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {
        connection: "jobs@example.com",
        messageId: "<digest-1@example.com>",
      },
      name: "process_outlook_job_digest",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(outlookJobDigestResult());
    expect(process).toHaveBeenCalledWith({
      connection: "jobs@example.com",
      messageId: "<digest-1@example.com>",
      offset: 0,
    });
    expect(record).toHaveBeenCalledWith({
      action: "process_outlook_job_digest",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("reviews new Outlook digests and audits the checkpoint atomically", async () => {
    const tools = fakeTools();
    const commit = vi.fn(() => outlookJobDigestReviewResult());
    const prepare = vi.fn(() => Promise.resolve({ commit }));
    tools.prepareReviewNewOutlookJobDigests = prepare;
    const record = vi.fn();
    const runAtomically = vi.fn((operation: () => object) => operation());
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically,
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: { connection: "jobs@example.com" },
      name: "review_new_outlook_job_digests",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(outlookJobDigestReviewResult());
    expect(prepare).toHaveBeenCalledWith({ connection: "jobs@example.com" });
    expect(commit).toHaveBeenCalledOnce();
    expect(runAtomically).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      action: "review_new_outlook_job_digests",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("searches historical Outlook digests as a read-only audited call", async () => {
    const tools = fakeTools();
    const search = vi.fn(() => Promise.resolve(outlookJobDigestSearchResult()));
    tools.searchOutlookJobDigests = search;
    const record = vi.fn();
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {
        after: "2026-07-23T00:00:00.000Z",
        before: "2026-07-30T09:00:00.000Z",
        connection: "jobs@example.com",
      },
      name: "search_outlook_job_digests",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(outlookJobDigestSearchResult());
    expect(search).toHaveBeenCalledWith({
      after: "2026-07-23T00:00:00.000Z",
      before: "2026-07-30T09:00:00.000Z",
      connection: "jobs@example.com",
      limit: 20,
      offset: 0,
    });
    expect(record).toHaveBeenCalledWith({
      action: "search_outlook_job_digests",
      actorUserId: "actor-user-1",
      result: "success",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });

    for (const argumentsValue of [
      {
        after: "2026-06-01T00:00:00.000Z",
        before: "2026-07-30T09:00:00.000Z",
        connection: "jobs@example.com",
      },
      {
        after: "2026-07-23T00:00:00.000Z",
        before: "2026-07-30T09:00:00.000Z",
        connection: "jobs@example.com",
        limit: 20,
        offset: 500,
      },
    ]) {
      const invalid = await client.callTool({
        arguments: argumentsValue,
        name: "search_outlook_job_digests",
      });
      expect(invalid.isError).toBe(true);
    }
    expect(search).toHaveBeenCalledOnce();
  });

  it("returns a stable error when server-side Outlook sync is unconfigured", async () => {
    const tools = fakeTools();
    tools.prepareSyncOutlookEmailEvidence = vi.fn(() =>
      Promise.reject(
        new OutlookEmailSyncOperationalError("outlook_email_sync_unavailable"),
      ),
    );
    const record = vi.fn();
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {
        applicationId: "11111111-1111-4111-8111-111111111111",
      },
      name: "sync_outlook_email_evidence",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        text: '{"error":{"code":"outlook_email_sync_unavailable"}}',
        type: "text",
      },
    ]);
    expect(record).toHaveBeenCalledWith({
      action: "sync_outlook_email_evidence",
      actorUserId: "actor-user-1",
      result: "error",
      targetType: "job_email",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("audits revoked access as denied", async () => {
    const tools = fakeTools();
    tools.getTrackerContext = vi.fn(() => {
      throw new LocalMcpActorUnavailableError();
    });
    const record = vi.fn();
    const recorder: McpAuditRecorder = { record };
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder,
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {},
      name: "get_tracker_context",
    });

    expect(result.isError).toBe(true);
    expect(record).toHaveBeenCalledWith({
      action: "get_tracker_context",
      actorUserId: "actor-user-1",
      result: "denied",
      targetType: "workspace",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });

  it("fails closed when a required audit event cannot be stored", async () => {
    const tools = fakeTools();
    const errorLog = vi.fn<ApplicationLogger["error"]>();
    const logger: ApplicationLogger = { error: errorLog, info: vi.fn() };
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: {
          record: () => {
            throw new Error("synthetic database failure");
          },
        },
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
      logger,
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {},
      name: "get_tracker_context",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { text: '{"error":{"code":"internal_error"}}', type: "text" },
    ]);
    expect(errorLog).toHaveBeenCalledOnce();
    const [event, context] = errorLog.mock.calls[0] ?? [];
    expect(event).toBe("mcp_audit_failed");
    expect(context?.tool).toBe("get_tracker_context");
    expect(context?.error).toBeInstanceOf(Error);
  });

  it("blocks writes while read-only and audits the denied attempt", async () => {
    const tools = fakeTools();
    tools.createApplication = vi.fn(() => {
      throw new McpWriteAccessDisabledError();
    });
    const record = vi.fn();
    const server = createLocalMcpServer(tools, {
      audit: {
        actorUserId: "actor-user-1",
        recorder: { record },
        runAtomically: (operation) => operation(),
        workspaceId: "workspace-1",
      },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      arguments: {
        companyName: "Example Company",
        roleTitle: "Engineer",
        statusId: "11111111-1111-4111-8111-111111111111",
      },
      name: "create_application",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        text: '{"error":{"code":"write_access_disabled"}}',
        type: "text",
      },
    ]);
    expect(record).toHaveBeenCalledWith({
      action: "create_application",
      actorUserId: "actor-user-1",
      result: "denied",
      targetType: "application",
      transport: "local_stdio",
      workspaceId: "workspace-1",
    });
  });
});
