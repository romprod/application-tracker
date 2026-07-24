import { describe, expect, it } from "vitest";

import type { ApplicationRecord } from "./applications_client";
import { sortApplications } from "./application_sort";

const applications: ApplicationRecord[] = [
  {
    agency: "Zulu Recruitment",
    appliedOn: null,
    companyName: "Zulu Works",
    contacts: [],
    createdAt: "2026-07-16T09:00:00.000Z",
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    location: null,
    links: [],
    nextAction: "Prepare questions",
    nextActionDue: null,
    notes: null,
    rating: 3,
    roleType: null,
    roleTypeId: null,
    roleTitle: "Researcher",
    salary: "£65,000",
    source: null,
    sourceId: null,
    sourceUrl: null,
    status: "Prospect",
    statusId: "status-prospect",
    statusIsTerminal: false,
    updatedAt: "2026-07-18T09:00:00.000Z",
    workArrangement: "office",
  },
  {
    agency: "Acme Talent",
    appliedOn: "2026-07-17",
    companyName: "Acme Studio",
    contacts: [],
    createdAt: "2026-07-17T09:00:00.000Z",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    location: "Remote",
    links: [],
    nextAction: "Send the portfolio follow-up",
    nextActionDue: "2026-07-21",
    notes: null,
    rating: 5,
    roleType: null,
    roleTypeId: null,
    roleTitle: "Designer",
    salary: "£75,000",
    source: null,
    sourceId: null,
    sourceUrl: null,
    status: "Interview",
    statusId: "status-interview",
    statusIsTerminal: false,
    updatedAt: "2026-07-17T09:00:00.000Z",
    workArrangement: "hybrid",
  },
];

describe("application table sorting", () => {
  it("sorts text columns without mutating the source records", () => {
    const sorted = sortApplications(applications, {
      direction: "ascending",
      key: "company",
    });

    expect(sorted.map(({ companyName }) => companyName)).toEqual([
      "Acme Studio",
      "Zulu Works",
    ]);
    expect(applications[0]?.companyName).toBe("Zulu Works");
  });

  it("keeps missing values after recorded values in either direction", () => {
    expect(
      sortApplications(applications, {
        direction: "ascending",
        key: "appliedOn",
      }).map(({ companyName }) => companyName),
    ).toEqual(["Acme Studio", "Zulu Works"]);

    expect(
      sortApplications(applications, {
        direction: "descending",
        key: "appliedOn",
      }).map(({ companyName }) => companyName),
    ).toEqual(["Acme Studio", "Zulu Works"]);
  });

  it("uses the full identifier for stable reference sorting", () => {
    expect(
      sortApplications(applications, {
        direction: "ascending",
        key: "reference",
      }).map(({ id }) => id),
    ).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  });

  it("sorts next actions by due date before their description", () => {
    expect(
      sortApplications(applications, {
        direction: "ascending",
        key: "nextAction",
      }).map(({ companyName }) => companyName),
    ).toEqual(["Acme Studio", "Zulu Works"]);
  });

  it("sorts salary and rating columns", () => {
    expect(
      sortApplications(applications, {
        direction: "ascending",
        key: "salary",
      }).map(({ companyName }) => companyName),
    ).toEqual(["Zulu Works", "Acme Studio"]);
    expect(
      sortApplications(applications, {
        direction: "descending",
        key: "rating",
      }).map(({ companyName }) => companyName),
    ).toEqual(["Acme Studio", "Zulu Works"]);
  });

  it("sorts agency and work-arrangement columns", () => {
    expect(
      sortApplications(applications, {
        direction: "ascending",
        key: "agency",
      }).map(({ agency }) => agency),
    ).toEqual(["Acme Talent", "Zulu Recruitment"]);
    expect(
      sortApplications(applications, {
        direction: "ascending",
        key: "workArrangement",
      }).map(({ workArrangement }) => workArrangement),
    ).toEqual(["hybrid", "office"]);
  });
});
