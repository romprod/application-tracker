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
      roleTitle: input.roleTitle,
      sourceUrl: input.sourceUrl,
      status: input.status,
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
      roleTitle: "Product Designer",
      sourceUrl: null,
      status: input.status ?? "prospect",
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
        status: "prospect",
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
      status: "prospect",
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
      roleTitle: "Product Designer",
      sourceUrl: null,
      status: "prospect",
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
        status: "interview",
      }),
    ).toMatchObject({ companyName: "Example Labs", status: "interview" });
    expect(store.updateApplication).toHaveBeenCalledWith({
      actorUserId: "user-1",
      applicationId: "application-1",
      companyName: "Example Labs",
      status: "interview",
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
