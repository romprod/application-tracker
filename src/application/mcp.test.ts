import { describe, expect, it, vi } from "vitest";

import type { ApplicationRecord } from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import {
  LocalMcpActorProvider,
  LocalMcpActorUnavailableError,
  LocalMcpReadService,
} from "./mcp.js";
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
    appliedOn: null,
    companyName: "Example Company",
    contacts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    location: null,
    links: [],
    nextAction: null,
    nextActionDue: null,
    notes: null,
    roleTitle: "Engineer",
    roleType: null,
    roleTypeId: null,
    source: null,
    sourceId: null,
    sourceUrl: null,
    status: "Applied",
    statusIsTerminal: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
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

describe("LocalMcpReadService", () => {
  it("binds every call to the configured active actor and workspace", () => {
    const repository = {
      findActiveActor: vi.fn().mockReturnValue(actor),
    };
    const applications = [
      application({
        id: "application-1",
        nextAction: "Prepare examples",
        nextActionDue: "2026-01-09",
        statusId: "status-open",
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
    const applicationReader = {
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
    };
    const referenceReader = {
      listReferenceValues: vi.fn().mockReturnValue(references),
    };
    const service = new LocalMcpReadService(
      new LocalMcpActorProvider(repository, {
        username: "alex",
        workspaceSlug: "default",
      }),
      applicationReader,
      referenceReader,
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
      service.listApplications({ limit: 1, statusId: "status-open" }),
    ).toMatchObject({ returned: 1, total: 2 });
    expect(service.getApplication("application-1")).toEqual({
      application: applications[0],
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
    });
    expect(service.getReferenceData()).toEqual({ values: references });
    expect(repository.findActiveActor).toHaveBeenCalledWith({
      username: "alex",
      workspaceSlug: "default",
    });
    expect(applicationReader.listApplications).toHaveBeenCalledWith(actor);
    expect(referenceReader.listReferenceValues).toHaveBeenCalledWith(actor);
  });

  it("rechecks actor availability on every call", () => {
    const repository = {
      findActiveActor: vi
        .fn()
        .mockReturnValueOnce(actor)
        .mockReturnValue(undefined),
    };
    const service = new LocalMcpReadService(
      new LocalMcpActorProvider(repository, {
        username: "alex",
        workspaceSlug: "default",
      }),
      {
        listApplicationEvents: vi.fn(),
        listApplications: vi.fn().mockReturnValue([]),
      },
      { listReferenceValues: vi.fn().mockReturnValue([]) },
    );

    expect(service.getTrackerContext().actor.username).toBe("alex");
    expect(() => service.getTrackerContext()).toThrow(
      LocalMcpActorUnavailableError,
    );
  });
});
