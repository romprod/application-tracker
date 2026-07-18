import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  ReferenceValuesForbiddenError,
  ReferenceValuesService,
  type ReferenceValuesRepository,
} from "./reference_values.js";

const member: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Sam", role: "member", username: "sam" },
  userId: "user-member",
  workspace: { name: "Applications" },
  workspaceId: "workspace-one",
};
const admin: AuthenticatedActor = {
  ...member,
  user: { ...member.user, role: "admin" },
};

function createRepository() {
  const createReferenceValue = vi.fn<
    ReferenceValuesRepository["createReferenceValue"]
  >((input) => ({
    ...input,
    id: "11111111-1111-4111-8111-111111111111",
    isActive: true,
    sortOrder: 10,
  }));
  const deleteReferenceValue =
    vi.fn<ReferenceValuesRepository["deleteReferenceValue"]>();
  const listReferenceValues = vi.fn<
    ReferenceValuesRepository["listReferenceValues"]
  >(() => []);
  const updateReferenceValue = vi.fn<
    ReferenceValuesRepository["updateReferenceValue"]
  >((input) => ({
    category: "status" as const,
    createdAt: "2026-07-18T12:00:00.000Z",
    id: input.referenceValueId,
    isActive: input.isActive ?? true,
    isTerminal: input.isTerminal ?? false,
    label: input.label ?? "Prospect",
    sortOrder: 10,
    updatedAt: input.updatedAt,
  }));
  return {
    createReferenceValue,
    deleteReferenceValue,
    listReferenceValues,
    repository: {
      createReferenceValue,
      deleteReferenceValue,
      listReferenceValues,
      updateReferenceValue,
    },
    updateReferenceValue,
  };
}

describe("ReferenceValuesService", () => {
  it("lets members read values within their workspace", () => {
    const store = createRepository();
    const service = new ReferenceValuesService(store.repository);

    expect(service.listReferenceValues(member)).toEqual([]);
    expect(store.listReferenceValues).toHaveBeenCalledWith("workspace-one");
  });

  it("lets administrators create and update values", () => {
    const store = createRepository();
    const service = new ReferenceValuesService(
      store.repository,
      () => new Date("2026-07-18T12:00:00.000Z"),
    );

    service.createReferenceValue(admin, {
      category: "status",
      isTerminal: true,
      label: "Withdrawn",
    });
    service.updateReferenceValue(
      admin,
      "11111111-1111-4111-8111-111111111111",
      { isActive: false },
    );

    expect(store.createReferenceValue).toHaveBeenCalledWith({
      category: "status",
      createdAt: "2026-07-18T12:00:00.000Z",
      isTerminal: true,
      label: "Withdrawn",
      updatedAt: "2026-07-18T12:00:00.000Z",
      workspaceId: "workspace-one",
    });
    expect(store.updateReferenceValue).toHaveBeenCalledWith({
      isActive: false,
      referenceValueId: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-07-18T12:00:00.000Z",
      workspaceId: "workspace-one",
    });
  });

  it("rejects every member mutation", () => {
    const service = new ReferenceValuesService(createRepository().repository);

    expect(() =>
      service.createReferenceValue(member, {
        category: "source",
        isTerminal: false,
        label: "Community board",
      }),
    ).toThrow(ReferenceValuesForbiddenError);
    expect(() =>
      service.updateReferenceValue(
        member,
        "11111111-1111-4111-8111-111111111111",
        { label: "Renamed" },
      ),
    ).toThrow(ReferenceValuesForbiddenError);
    expect(() =>
      service.deleteReferenceValue(
        member,
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toThrow(ReferenceValuesForbiddenError);
  });
});
