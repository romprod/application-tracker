import { describe, expect, it } from "vitest";

import {
  deleteApplicationSchema,
  listDeletedApplicationsSchema,
  recoverApplicationMergeSchema,
  restoreApplicationSchema,
} from "./application_recovery.js";

const applicationId = "11111111-1111-4111-8111-111111111111";

describe("application recovery schemas", () => {
  it("requires a bounded deletion reason", () => {
    expect(
      deleteApplicationSchema.parse({
        applicationId,
        reason: "  Duplicate record created during import.  ",
      }),
    ).toEqual({
      applicationId,
      reason: "Duplicate record created during import.",
    });
    expect(
      deleteApplicationSchema.safeParse({ applicationId, reason: "no" })
        .success,
    ).toBe(false);
  });

  it("bounds deleted-list pagination", () => {
    expect(listDeletedApplicationsSchema.parse({})).toEqual({
      limit: 25,
      offset: 0,
    });
    expect(
      listDeletedApplicationsSchema.safeParse({ limit: 101, offset: 0 })
        .success,
    ).toBe(false);
  });

  it("requires explicit confirmation and optimistic restore versions", () => {
    expect(
      restoreApplicationSchema.safeParse({
        applicationId,
        confirm: false,
        expectedDeletedAt: "2026-07-31T12:00:00.000Z",
        expectedUpdatedAt: "2026-07-31T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      restoreApplicationSchema.safeParse({
        applicationId,
        confirm: true,
        expectedDeletedAt: "2026-07-31T12:00:00.000Z",
        expectedUpdatedAt: "2026-07-31T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("separates read-only merge preview from confirmed recovery", () => {
    expect(
      recoverApplicationMergeSchema.parse({
        mode: "preview",
        sourceApplicationId: applicationId,
      }),
    ).toEqual({ mode: "preview", sourceApplicationId: applicationId });
    expect(
      recoverApplicationMergeSchema.safeParse({
        mode: "apply",
        sourceApplicationId: applicationId,
      }).success,
    ).toBe(false);
  });
});
