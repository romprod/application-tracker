import type { ApplicationRecord } from "./applications_client";

export type DueTone = "muted" | "overdue" | "soon" | "today";

export function dueLabel(
  value: string | null,
  now: Date = new Date(),
): { text: string; tone: DueTone } {
  if (!value) return { text: "No date", tone: "muted" };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${value}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) {
    return { text: `${String(Math.abs(days))}d overdue`, tone: "overdue" };
  }
  if (days === 0) return { text: "Due today", tone: "today" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  return {
    text: `Due in ${String(days)}d`,
    tone: days <= 3 ? "soon" : "muted",
  };
}

export function nextActionApplications(
  applications: ApplicationRecord[],
): ApplicationRecord[] {
  return applications
    .filter(
      (application) =>
        application.status !== "closed" && application.nextAction !== null,
    )
    .map((application, index) => ({ application, index }))
    .sort((left, right) => {
      const leftDue = left.application.nextActionDue;
      const rightDue = right.application.nextActionDue;
      if (leftDue === null && rightDue !== null) return 1;
      if (leftDue !== null && rightDue === null) return -1;
      if (leftDue !== null && rightDue !== null) {
        const compared = leftDue.localeCompare(rightDue);
        if (compared !== 0) return compared;
      }
      return left.index - right.index;
    })
    .map(({ application }) => application);
}
