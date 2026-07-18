import { describe, expect, it } from "vitest";

import { createApplicationSchema } from "./applications.js";

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
