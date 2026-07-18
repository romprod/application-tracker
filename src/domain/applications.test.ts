import { describe, expect, it } from "vitest";

import {
  applicationIdSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from "./applications.js";

describe("createApplicationSchema", () => {
  it("normalizes a complete application record", () => {
    expect(
      createApplicationSchema.parse({
        appliedOn: "2026-07-18",
        companyName: "  Example Studio  ",
        location: "  Remote  ",
        notes: "  Referred by a former colleague.  ",
        roleTitle: "  Product Designer  ",
        sourceUrl: "  https://jobs.example.com/product-designer  ",
        status: "applied",
      }),
    ).toEqual({
      appliedOn: "2026-07-18",
      companyName: "Example Studio",
      location: "Remote",
      notes: "Referred by a former colleague.",
      roleTitle: "Product Designer",
      sourceUrl: "https://jobs.example.com/product-designer",
      status: "applied",
    });
  });

  it("uses a prospect stage and removes blank optional values", () => {
    expect(
      createApplicationSchema.parse({
        companyName: "Example Studio",
        location: "   ",
        notes: "",
        roleTitle: "Product Designer",
        sourceUrl: "",
      }),
    ).toEqual({
      companyName: "Example Studio",
      roleTitle: "Product Designer",
      status: "prospect",
    });
  });

  it("rejects malformed dates, unsafe links, and unknown fields", () => {
    expect(() =>
      createApplicationSchema.parse({
        appliedOn: "18/07/2026",
        companyName: "Example Studio",
        roleTitle: "Product Designer",
      }),
    ).toThrow();
    expect(() =>
      createApplicationSchema.parse({
        companyName: "Example Studio",
        roleTitle: "Product Designer",
        sourceUrl: "javascript:alert(1)",
      }),
    ).toThrow();
    expect(() =>
      createApplicationSchema.parse({
        companyName: "Example Studio",
        privateField: "not allowed",
        roleTitle: "Product Designer",
      }),
    ).toThrow();
  });
});

describe("updateApplicationSchema", () => {
  it("normalizes changed fields and clears optional values", () => {
    expect(
      updateApplicationSchema.parse({
        appliedOn: null,
        companyName: "  Example Labs  ",
        location: "   ",
        sourceUrl: null,
        status: "interview",
      }),
    ).toEqual({
      appliedOn: null,
      companyName: "Example Labs",
      location: null,
      sourceUrl: null,
      status: "interview",
    });
  });

  it("rejects empty updates, unsafe links, and unknown fields", () => {
    expect(() => updateApplicationSchema.parse({})).toThrow();
    expect(() =>
      updateApplicationSchema.parse({ sourceUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      updateApplicationSchema.parse({ workspaceId: "other" }),
    ).toThrow();
  });
});

describe("applicationIdSchema", () => {
  it("accepts UUIDs and rejects control text", () => {
    expect(
      applicationIdSchema.parse("123e4567-e89b-12d3-a456-426614174000"),
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(() => applicationIdSchema.parse("' OR 1=1 --")).toThrow();
  });
});
