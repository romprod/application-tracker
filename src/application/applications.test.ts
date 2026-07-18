import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  ApplicationLedgerService,
  type ApplicationsRepository,
} from "./applications.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "member", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};
const prospectId = "11111111-1111-4111-8111-111111111111";
const interviewId = "22222222-2222-4222-8222-222222222222";

function repository() {
  const deleteApplication = vi.fn<ApplicationsRepository["deleteApplication"]>(
    () => true,
  );
  const createApplication = vi.fn<ApplicationsRepository["createApplication"]>(
    (input) => ({
      appliedOn: input.appliedOn,
      companyName: input.companyName,
      contacts: input.contacts ?? [],
      createdAt: input.createdAt,
      id: "application-1",
      location: input.location,
      links: input.links ?? [],
      nextAction: input.nextAction,
      nextActionDue: input.nextActionDue,
      notes: input.notes,
      roleType: null,
      roleTypeId: input.roleTypeId,
      roleTitle: input.roleTitle,
      source: null,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      status: input.statusId === interviewId ? "Interview" : "Prospect",
      statusId: input.statusId,
      statusIsTerminal: false,
      updatedAt: input.createdAt,
    }),
  );
  const listApplications = vi.fn<ApplicationsRepository["listApplications"]>(
    () => [],
  );
  const listApplicationEvents = vi.fn<
    ApplicationsRepository["listApplicationEvents"]
  >(() => []);
  const updateApplication = vi.fn<ApplicationsRepository["updateApplication"]>(
    (input) => ({
      appliedOn: null,
      companyName: input.companyName ?? "Example Studio",
      contacts: input.contacts ?? [],
      createdAt: "2026-07-18T12:00:00.000Z",
      id: input.applicationId,
      location: null,
      links: input.links ?? [],
      nextAction: input.nextAction ?? null,
      nextActionDue: input.nextActionDue ?? null,
      notes: null,
      roleType: null,
      roleTypeId: null,
      roleTitle: "Product Designer",
      source: null,
      sourceId: null,
      sourceUrl: null,
      status: input.statusId === interviewId ? "Interview" : "Prospect",
      statusId: input.statusId ?? prospectId,
      statusIsTerminal: false,
      updatedAt: input.updatedAt,
    }),
  );
  return {
    createApplication,
    deleteApplication,
    listApplicationEvents,
    listApplications,
    repository: {
      createApplication,
      deleteApplication,
      listApplicationEvents,
      listApplications,
      updateApplication,
    },
    updateApplication,
  };
}

describe("ApplicationLedgerService", () => {
  it("creates an application inside the actor's workspace", () => {
    const store = repository();
    const service = new ApplicationLedgerService(
      store.repository,
      () => new Date("2026-07-18T12:00:00.000Z"),
    );

    expect(
      service.createApplication(actor, {
        companyName: "Example Studio",
        contacts: [
          {
            email: "morgan@example.com",
            name: "Morgan Recruiter",
          },
        ],
        links: [
          {
            label: "Hiring portal",
            url: "https://careers.example.com/application",
          },
        ],
        nextAction: "Send the portfolio follow-up.",
        nextActionDue: "2026-07-21",
        roleTitle: "Product Designer",
        statusId: prospectId,
      }),
    ).toMatchObject({
      companyName: "Example Studio",
      contacts: [
        {
          email: "morgan@example.com",
          name: "Morgan Recruiter",
          phone: null,
          role: null,
        },
      ],
      location: null,
      links: [
        {
          label: "Hiring portal",
          url: "https://careers.example.com/application",
        },
      ],
      status: "Prospect",
    });
    expect(store.createApplication).toHaveBeenCalledWith({
      appliedOn: null,
      companyName: "Example Studio",
      contacts: [
        {
          email: "morgan@example.com",
          name: "Morgan Recruiter",
          phone: null,
          role: null,
        },
      ],
      createdAt: "2026-07-18T12:00:00.000Z",
      createdByUserId: "user-1",
      links: [
        {
          label: "Hiring portal",
          url: "https://careers.example.com/application",
        },
      ],
      location: null,
      nextAction: "Send the portfolio follow-up.",
      nextActionDue: "2026-07-21",
      notes: null,
      roleTypeId: null,
      roleTitle: "Product Designer",
      sourceId: null,
      sourceUrl: null,
      statusId: prospectId,
      workspaceId: "workspace-1",
    });
  });

  it("lists only through the actor's workspace scope", () => {
    const store = repository();
    const service = new ApplicationLedgerService(store.repository);

    expect(service.listApplications(actor)).toEqual([]);
    expect(store.listApplications).toHaveBeenCalledWith("workspace-1");
  });

  it("updates through the actor's workspace and identity", () => {
    const store = repository();
    const service = new ApplicationLedgerService(
      store.repository,
      () => new Date("2026-07-18T13:00:00.000Z"),
    );

    expect(
      service.updateApplication(actor, "application-1", {
        companyName: "Example Labs",
        statusId: interviewId,
      }),
    ).toMatchObject({ companyName: "Example Labs", status: "Interview" });
    expect(store.updateApplication).toHaveBeenCalledWith({
      actorUserId: "user-1",
      applicationId: "application-1",
      companyName: "Example Labs",
      statusId: interviewId,
      updatedAt: "2026-07-18T13:00:00.000Z",
      workspaceId: "workspace-1",
    });
  });

  it("lists history through the actor's workspace scope", () => {
    const store = repository();
    const service = new ApplicationLedgerService(store.repository);

    expect(service.listApplicationEvents(actor, "application-1")).toEqual([]);
    expect(store.listApplicationEvents).toHaveBeenCalledWith(
      "workspace-1",
      "application-1",
    );
  });

  it("deletes through the actor's workspace and identity", () => {
    const store = repository();
    const service = new ApplicationLedgerService(
      store.repository,
      () => new Date("2026-07-18T15:00:00.000Z"),
    );

    service.deleteApplication(actor, "application-1");

    expect(store.deleteApplication).toHaveBeenCalledWith({
      actorUserId: "user-1",
      applicationId: "application-1",
      deletedAt: "2026-07-18T15:00:00.000Z",
      workspaceId: "workspace-1",
    });
  });

  it("hides whether a deletion target is missing or outside the workspace", () => {
    const store = repository();
    store.deleteApplication.mockReturnValue(false);
    const service = new ApplicationLedgerService(store.repository);

    expect(() =>
      service.deleteApplication(actor, "missing-application"),
    ).toThrow("Application not found");
  });
});
