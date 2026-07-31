import { describe, expect, it } from "vitest";

import { applicationAttentionQuerySchema } from "./application_attention.js";

describe("applicationAttentionQuerySchema", () => {
  it("normalizes a bounded combined attention query", () => {
    expect(
      applicationAttentionQuerySchema.parse({
        appliedFrom: "2026-07-01",
        appliedTo: "2026-07-31",
        attentionOnly: false,
        duplicateRisk: true,
        fieldStates: ["conflicting", "stale"],
        lifecycle: "active",
        limit: 40,
        missingEvidence: ["original_advert", "application_confirmation"],
        missingFields: ["salary", "location"],
        nextAction: "overdue",
        offset: 20,
        query: "  platform engineer  ",
        reasonCodes: ["duplicate_risk", "field_conflicting"],
        statusIds: ["11111111-1111-4111-8111-111111111111"],
        updatedFrom: "2026-07-01T00:00:00.000Z",
        updatedTo: "2026-07-31T23:59:59.999Z",
      }),
    ).toEqual({
      appliedFrom: "2026-07-01",
      appliedTo: "2026-07-31",
      attentionOnly: false,
      duplicateRisk: true,
      fieldStates: ["conflicting", "stale"],
      lifecycle: "active",
      limit: 40,
      missingEvidence: ["original_advert", "application_confirmation"],
      missingFields: ["salary", "location"],
      nextAction: "overdue",
      offset: 20,
      query: "platform engineer",
      reasonCodes: ["duplicate_risk", "field_conflicting"],
      statusIds: ["11111111-1111-4111-8111-111111111111"],
      updatedFrom: "2026-07-01T00:00:00.000Z",
      updatedTo: "2026-07-31T23:59:59.999Z",
    });
  });

  it("defaults to a bounded attention-only page", () => {
    expect(applicationAttentionQuerySchema.parse({})).toEqual({
      attentionOnly: true,
      lifecycle: "all",
      limit: 25,
      offset: 0,
    });
  });

  it("rejects inverted ranges, duplicate filters, and unbounded pages", () => {
    expect(() =>
      applicationAttentionQuerySchema.parse({
        appliedFrom: "2026-07-31",
        appliedTo: "2026-07-01",
      }),
    ).toThrow();
    expect(() =>
      applicationAttentionQuerySchema.parse({
        missingFields: ["salary", "salary"],
      }),
    ).toThrow();
    expect(() =>
      applicationAttentionQuerySchema.parse({ limit: 101 }),
    ).toThrow();
  });
});
