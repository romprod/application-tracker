import { describe, expect, it } from "vitest";

import type { ApplicationRecord } from "./applications_client";
import { dueLabel, nextActionApplications } from "./application_next_action";

function application(
  id: string,
  nextAction: string | null,
  nextActionDue: string | null,
  status: ApplicationRecord["status"] = "applied",
): ApplicationRecord {
  return {
    appliedOn: null,
    companyName: `Company ${id}`,
    createdAt: "2026-07-18T09:00:00.000Z",
    id,
    location: null,
    nextAction,
    nextActionDue,
    notes: null,
    roleTitle: "Product Designer",
    sourceUrl: null,
    status,
    updatedAt: "2026-07-18T09:00:00.000Z",
  };
}

describe("next action presentation", () => {
  it("labels due dates relative to the current local day", () => {
    const today = new Date("2026-07-18T12:00:00.000Z");

    expect(dueLabel("2026-07-17", today)).toEqual({
      text: "1d overdue",
      tone: "overdue",
    });
    expect(dueLabel("2026-07-18", today)).toEqual({
      text: "Due today",
      tone: "today",
    });
    expect(dueLabel("2026-07-19", today)).toEqual({
      text: "Due tomorrow",
      tone: "soon",
    });
    expect(dueLabel(null, today)).toEqual({ text: "No date", tone: "muted" });
  });

  it("orders open actions by due date and leaves undated actions last", () => {
    const ordered = nextActionApplications([
      application("undated", "Prepare questions", null),
      application("closed", "Archive notes", "2026-07-16", "closed"),
      application("later", "Send references", "2026-07-22"),
      application("missing", null, "2026-07-15"),
      application("first", "Follow up", "2026-07-18"),
    ]);

    expect(ordered.map(({ id }) => id)).toEqual(["first", "later", "undated"]);
  });
});
