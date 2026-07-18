import { describe, expect, it } from "vitest";

import type { ApplicationRecord } from "./applications_client";
import { sortApplications } from "./application_sort";

const applications: ApplicationRecord[] = [
  {
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
    roleType: null,
    roleTypeId: null,
    roleTitle: "Researcher",
    source: null,
    sourceId: null,
    sourceUrl: null,
    status: "Prospect",
    statusId: "status-prospect",
    statusIsTerminal: false,
    updatedAt: "2026-07-18T09:00:00.000Z",
  },
  {
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
    roleType: null,
    roleTypeId: null,
    roleTitle: "Designer",
    source: null,
    sourceId: null,
    sourceUrl: null,
    status: "Interview",
    statusId: "status-interview",
    statusIsTerminal: false,
    updatedAt: "2026-07-17T09:00:00.000Z",
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
});
