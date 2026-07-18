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
  const createApplication = vi.fn<ApplicationsRepository["createApplication"]>(
    (input) => ({
      appliedOn: input.appliedOn,
      companyName: input.companyName,
      createdAt: input.createdAt,
      id: "application-1",
      location: input.location,
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
      createdAt: "2026-07-18T12:00:00.000Z",
      id: input.applicationId,
      location: null,
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
    listApplicationEvents,
    listApplications,
    repository: {
      createApplication,
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
        nextAction: "Send the portfolio follow-up.",
        nextActionDue: "2026-07-21",
        roleTitle: "Product Designer",
        status: "prospect",
      }),
    ).toMatchObject({
      companyName: "Example Studio",
      location: null,
      status: "prospect",
    });
    expect(store.createApplication).toHaveBeenCalledWith({
      appliedOn: null,
      companyName: "Example Studio",
      createdAt: "2026-07-18T12:00:00.000Z",
      createdByUserId: "user-1",
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
});
