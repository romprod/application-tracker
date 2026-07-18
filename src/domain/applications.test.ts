import { describe, expect, it } from "vitest";

import {
  applicationIdSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from "./applications.js";

const statusId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const roleTypeId = "33333333-3333-4333-8333-333333333333";

describe("createApplicationSchema", () => {
  it("normalizes a complete application record", () => {
    expect(
      createApplicationSchema.parse({
        appliedOn: "2026-07-18",
        companyName: "  Example Studio  ",
        contacts: [
          {
            email: "  recruiter@example.com  ",
            name: "  Morgan Recruiter  ",
            phone: "  +44 20 7946 0958  ",
            role: "  Recruiter  ",
          },
        ],
        links: [
          {
            label: "  Hiring portal  ",
            url: "  https://careers.example.com/application  ",
          },
        ],
        location: "  Remote  ",
        nextAction: "  Send the portfolio follow-up.  ",
        nextActionDue: "2026-07-21",
        notes: "  Referred by a former colleague.  ",
        roleTypeId,
        roleTitle: "  Product Designer  ",
        sourceId,
        sourceUrl: "  https://jobs.example.com/product-designer  ",
        statusId,
      }),
    ).toEqual({
      appliedOn: "2026-07-18",
      companyName: "Example Studio",
      contacts: [
        {
          email: "recruiter@example.com",
          name: "Morgan Recruiter",
          phone: "+44 20 7946 0958",
          role: "Recruiter",
        },
      ],
      links: [
        {
          label: "Hiring portal",
          url: "https://careers.example.com/application",
        },
      ],
      location: "Remote",
      nextAction: "Send the portfolio follow-up.",
      nextActionDue: "2026-07-21",
      notes: "Referred by a former colleague.",
      roleTypeId,
      roleTitle: "Product Designer",
      sourceId,
      sourceUrl: "https://jobs.example.com/product-designer",
      statusId,
    });
  });

  it("requires a workspace status and removes blank optional values", () => {
    expect(
      createApplicationSchema.parse({
        companyName: "Example Studio",
        location: "   ",
        nextAction: "",
        nextActionDue: "",
        notes: "",
        roleTitle: "Product Designer",
        sourceUrl: "",
        statusId,
      }),
    ).toEqual({
      companyName: "Example Studio",
      roleTitle: "Product Designer",
      statusId,
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
        links: [{ label: "Portal", url: "javascript:alert(1)" }],
        roleTitle: "Product Designer",
      }),
    ).toThrow();
    expect(() =>
      createApplicationSchema.parse({
        companyName: "Example Studio",
        contacts: [{ email: "not-an-email", name: "Morgan Recruiter" }],
        roleTitle: "Product Designer",
      }),
    ).toThrow();
    expect(() =>
      createApplicationSchema.parse({
        companyName: "Example Studio",
        links: Array.from({ length: 11 }, (_, index) => ({
          label: `Link ${index + 1}`,
          url: `https://example.com/${index + 1}`,
        })),
        roleTitle: "Product Designer",
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
        contacts: [],
        links: [],
        location: "   ",
        nextAction: "  ",
        nextActionDue: "",
        roleTypeId: null,
        sourceId: null,
        sourceUrl: null,
        statusId,
      }),
    ).toEqual({
      appliedOn: null,
      companyName: "Example Labs",
      contacts: [],
      links: [],
      location: null,
      nextAction: null,
      nextActionDue: null,
      roleTypeId: null,
      sourceId: null,
      sourceUrl: null,
      statusId,
    });
  });

  it("rejects empty updates, unsafe links, and unknown fields", () => {
    expect(() => updateApplicationSchema.parse({})).toThrow();
    expect(() =>
      updateApplicationSchema.parse({ sourceUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      updateApplicationSchema.parse({ nextActionDue: "21/07/2026" }),
    ).toThrow();
    expect(() =>
      updateApplicationSchema.parse({ nextAction: "x".repeat(501) }),
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
