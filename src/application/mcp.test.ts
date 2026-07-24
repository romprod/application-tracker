import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ApplicationRecord } from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import { EmailLinkExtractionService } from "./email_links.js";
import {
  ApplicationMcpService,
  LocalMcpActorProvider,
  LocalMcpActorUnavailableError,
} from "./mcp.js";
import { McpWriteAccessDisabledError } from "./mcp_access.js";
import { McpDocumentImportManager } from "./mcp_document_imports.js";
import type { ReferenceValue } from "./reference_values.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex Example", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};

function application(
  input: Partial<ApplicationRecord> &
    Pick<ApplicationRecord, "id" | "statusId">,
): ApplicationRecord {
  return {
    agency: null,
    appliedOn: null,
    companyName: "Example Company",
    contacts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    location: null,
    links: [],
    nextAction: null,
    nextActionDue: null,
    notes: null,
    rating: null,
    roleTitle: "Engineer",
    salary: null,
    roleType: null,
    roleTypeId: null,
    source: null,
    sourceId: null,
    sourceUrl: null,
    status: "Applied",
    statusIsTerminal: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    workArrangement: null,
    ...input,
  };
}

const references: ReferenceValue[] = [
  {
    category: "status",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "status-open",
    isActive: true,
    isTerminal: false,
    label: "Applied",
    sortOrder: 10,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    category: "status",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "status-closed",
    isActive: true,
    isTerminal: true,
    label: "Closed",
    sortOrder: 20,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function documentDependencies() {
  return {
    documents: {
      getDocumentChunk: vi.fn(),
      importDocument: vi.fn(),
      listDocuments: vi.fn().mockReturnValue([]),
    },
    imports: new McpDocumentImportManager(1024 * 1024),
  };
}

describe("ApplicationMcpService", () => {
  it("binds every call to the configured active actor and workspace", () => {
    const repository = {
      findActiveActor: vi.fn().mockReturnValue(actor),
    };
    const applications = [
      application({
        agency: "Example Recruitment",
        id: "application-1",
        nextAction: "Prepare examples",
        nextActionDue: "2026-01-09",
        rating: 5,
        salary: "£90,000",
        statusId: "status-open",
        workArrangement: "hybrid",
      }),
      application({
        id: "application-2",
        nextAction: "Send follow-up",
        nextActionDue: "2026-01-10",
        statusId: "status-open",
      }),
      application({
        id: "application-3",
        status: "Closed",
        statusId: "status-closed",
        statusIsTerminal: true,
      }),
    ];
    const applicationService = {
      createApplication: vi.fn(),
      deleteApplication: vi.fn(),
      listApplicationEvents: vi.fn().mockReturnValue([
        {
          actorDisplayName: "Alex Example",
          fromStatus: null,
          id: "event-1",
          occurredAt: "2026-01-01T00:00:00.000Z",
          toStatus: "Applied",
          type: "application_created" as const,
        },
      ]),
      listApplications: vi.fn().mockReturnValue(applications),
      updateApplication: vi.fn(),
    };
    const referenceReader = {
      listReferenceValues: vi.fn().mockReturnValue(references),
    };
    const { documents, imports } = documentDependencies();
    const service = new ApplicationMcpService(
      new LocalMcpActorProvider(repository, {
        username: "alex",
        workspaceSlug: "default",
      }),
      applicationService,
      referenceReader,
      {
        getAccessMode: vi.fn(() => "read_only"),
        requireWriteAccess: vi.fn(() => {
          throw new McpWriteAccessDisabledError();
        }),
      },
      documents,
      imports,
      new EmailLinkExtractionService(),
      undefined,
      () => new Date("2026-01-10T12:00:00.000Z"),
    );

    expect(service.getTrackerContext()).toEqual({
      access: "read_only",
      actor: {
        displayName: "Alex Example",
        role: "admin",
        username: "alex",
      },
      workspace: { name: "Applications", slug: "default" },
    });
    expect(service.getJobSearchSummary()).toEqual({
      asOfDate: "2026-01-10",
      byStatus: [
        {
          count: 2,
          isTerminal: false,
          status: "Applied",
          statusId: "status-open",
        },
        {
          count: 1,
          isTerminal: true,
          status: "Closed",
          statusId: "status-closed",
        },
      ],
      dueTodayActions: 1,
      openActions: 2,
      openApplications: 2,
      overdueActions: 1,
      terminalApplications: 1,
      totalApplications: 3,
    });
    expect(
      service.listApplications({
        limit: 1,
        offset: 0,
        statusId: "status-open",
      }),
    ).toMatchObject({
      applications: [
        expect.objectContaining({
          agency: "Example Recruitment",
          rating: 5,
          salary: "£90,000",
          workArrangement: "hybrid",
        }),
      ],
      nextOffset: 1,
      offset: 0,
      returned: 1,
      total: 2,
    });
    expect(service.getApplication("application-1")).toEqual({
      application: applications[0],
      emailEvidence: [],
      events: [
        {
          actorDisplayName: "Alex Example",
          fromStatus: null,
          id: "event-1",
          occurredAt: "2026-01-01T00:00:00.000Z",
          toStatus: "Applied",
          type: "application_created",
        },
      ],
      jobPostings: [],
    });
    expect(service.getReferenceData()).toEqual({ values: references });
    expect(service.getDocumentImportCapabilities()).toEqual({
      maxDocumentBytes: 1024 * 1024,
      maxDocumentChunkBytes: 12 * 1024,
    });
    expect(
      service.extractJobLinks({
        content:
          "https://www.linkedin.com/jobs/view/4405273020?trackingId=email",
      }),
    ).toEqual({
      candidates: [
        {
          externalPostingId: "4405273020",
          host: "www.linkedin.com",
          provider: "linkedin",
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      ],
    });
    expect(service.listDocuments({ limit: 50, offset: 0 })).toEqual({
      documents: [],
      nextOffset: null,
      offset: 0,
      returned: 0,
      total: 0,
    });
    expect(repository.findActiveActor).toHaveBeenCalledWith({
      username: "alex",
      workspaceSlug: "default",
    });
    expect(applicationService.listApplications).toHaveBeenCalledWith(actor);
    expect(referenceReader.listReferenceValues).toHaveBeenCalledWith(actor);
  });

  it("exports one bounded document range with the stored whole-file digest", () => {
    const { documents, imports } = documentDependencies();
    const wholeBytes = Buffer.alloc(20_000, 7);
    const chunk = wholeBytes.subarray(12_288);
    const sha256 = createHash("sha256").update(wholeBytes).digest("hex");
    const record = {
      applications: [],
      byteSize: wholeBytes.byteLength,
      createdAt: "2026-07-19T10:00:00.000Z",
      documentType: "CV",
      documentTypeId: "11111111-1111-4111-8111-111111111111",
      id: "22222222-2222-4222-8222-222222222222",
      mediaType: "application/pdf",
      originalFilename: "Product CV.pdf",
      uploadedByDisplayName: "Alex Example",
    };
    documents.getDocumentChunk.mockReturnValue({
      bytes: chunk,
      document: record,
      sha256,
    });
    const service = new ApplicationMcpService(
      new LocalMcpActorProvider(
        { findActiveActor: vi.fn(() => actor) },
        { username: "alex", workspaceSlug: "default" },
      ),
      {
        createApplication: vi.fn(),
        deleteApplication: vi.fn(),
        listApplicationEvents: vi.fn(),
        listApplications: vi.fn().mockReturnValue([]),
        updateApplication: vi.fn(),
      },
      { listReferenceValues: vi.fn().mockReturnValue([]) },
      {
        getAccessMode: vi.fn(() => "read_only"),
        requireWriteAccess: vi.fn(),
      },
      documents,
      imports,
      new EmailLinkExtractionService(),
    );

    expect(
      service.exportDocumentChunk({ documentId: record.id, offset: 12_288 }),
    ).toEqual({
      byteSize: wholeBytes.byteLength,
      chunkByteSize: chunk.byteLength,
      chunkSha256: createHash("sha256").update(chunk).digest("hex"),
      complete: true,
      contentBase64: chunk.toString("base64"),
      document: record,
      nextOffset: null,
      offset: 12_288,
      sha256,
    });
    expect(documents.getDocumentChunk).toHaveBeenCalledWith(
      actor,
      record.id,
      12_288,
      12_288,
    );
  });

  it("rechecks actor availability on every call", () => {
    const repository = {
      findActiveActor: vi
        .fn()
        .mockReturnValueOnce(actor)
        .mockReturnValue(undefined),
    };
    const { documents, imports } = documentDependencies();
    const service = new ApplicationMcpService(
      new LocalMcpActorProvider(repository, {
        username: "alex",
        workspaceSlug: "default",
      }),
      {
        createApplication: vi.fn(),
        deleteApplication: vi.fn(),
        listApplicationEvents: vi.fn(),
        listApplications: vi.fn().mockReturnValue([]),
        updateApplication: vi.fn(),
      },
      { listReferenceValues: vi.fn().mockReturnValue([]) },
      {
        getAccessMode: vi.fn(() => "read_only"),
        requireWriteAccess: vi.fn(),
      },
      documents,
      imports,
      new EmailLinkExtractionService(),
    );

    expect(service.getTrackerContext().actor.username).toBe("alex");
    expect(() => service.getTrackerContext()).toThrow(
      LocalMcpActorUnavailableError,
    );
  });

  it("rechecks the connection access mode before every mutation", () => {
    let accessMode: "read_only" | "read_write" = "read_only";
    const created = application({
      id: "application-created",
      statusId: "status-open",
    });
    const updated = { ...created, companyName: "Updated Company" };
    const applications = {
      createApplication: vi.fn(() => created),
      deleteApplication: vi.fn(),
      listApplicationEvents: vi.fn(),
      listApplications: vi.fn().mockReturnValue([]),
      updateApplication: vi.fn(() => updated),
    };
    const { documents, imports } = documentDependencies();
    const service = new ApplicationMcpService(
      new LocalMcpActorProvider(
        { findActiveActor: vi.fn(() => actor) },
        { username: "alex", workspaceSlug: "default" },
      ),
      applications,
      { listReferenceValues: vi.fn().mockReturnValue([]) },
      {
        getAccessMode: () => accessMode,
        requireWriteAccess: () => {
          if (accessMode !== "read_write") {
            throw new McpWriteAccessDisabledError();
          }
        },
      },
      documents,
      imports,
      new EmailLinkExtractionService(),
    );
    const createInput = {
      companyName: "Example Company",
      roleTitle: "Engineer",
      statusId: "11111111-1111-4111-8111-111111111111",
    };

    expect(() => service.createApplication(createInput)).toThrow(
      McpWriteAccessDisabledError,
    );
    expect(applications.createApplication).not.toHaveBeenCalled();

    accessMode = "read_write";
    expect(service.getTrackerContext().access).toBe("read_write");
    expect(service.createApplication(createInput)).toBe(created);
    expect(
      service.updateApplication("application-created", {
        companyName: "Updated Company",
        expectedUpdatedAt: created.updatedAt,
      }),
    ).toBe(updated);
    expect(
      service.bulkUpdateApplications([
        {
          applicationId: "application-created",
          update: {
            expectedUpdatedAt: updated.updatedAt,
            notes: "Bulk update",
          },
        },
      ]),
    ).toEqual({
      applications: [
        { id: "application-created", updatedAt: updated.updatedAt },
      ],
      updated: 1,
    });
    expect(service.deleteApplication("application-created")).toEqual({
      applicationId: "application-created",
      deleted: true,
    });
    expect(applications.createApplication).toHaveBeenCalledWith(
      actor,
      createInput,
    );
    expect(applications.updateApplication).toHaveBeenCalledWith(
      actor,
      "application-created",
      {
        companyName: "Updated Company",
        expectedUpdatedAt: created.updatedAt,
      },
    );
    expect(applications.updateApplication).toHaveBeenCalledWith(
      actor,
      "application-created",
      {
        expectedUpdatedAt: updated.updatedAt,
        notes: "Bulk update",
      },
    );
    expect(applications.deleteApplication).toHaveBeenCalledWith(
      actor,
      "application-created",
    );
  });
});
