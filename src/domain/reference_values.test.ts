import { describe, expect, it } from "vitest";

import {
  createReferenceValueSchema,
  updateReferenceValueSchema,
} from "./reference_values.js";

describe("reference value schemas", () => {
  it("normalizes a valid status value", () => {
    expect(
      createReferenceValueSchema.parse({
        category: "status",
        isTerminal: true,
        label: "  Withdrawn  ",
      }),
    ).toEqual({
      category: "status",
      isTerminal: true,
      label: "Withdrawn",
    });
  });

  it("rejects terminal flags outside the status category", () => {
    expect(
      createReferenceValueSchema.safeParse({
        category: "source",
        isTerminal: true,
        label: "Referral",
      }).success,
    ).toBe(false);
  });

  it("requires a bounded label and at least one update", () => {
    expect(
      createReferenceValueSchema.safeParse({
        category: "source",
        label: " ",
      }).success,
    ).toBe(false);
    expect(updateReferenceValueSchema.safeParse({}).success).toBe(false);
    expect(
      updateReferenceValueSchema.parse({ label: "  Community board " }),
    ).toEqual({ label: "Community board" });
  });
});
