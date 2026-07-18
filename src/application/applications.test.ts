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
  return {
    createApplication,
    listApplications,
    repository: { createApplication, listApplications },
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
});
