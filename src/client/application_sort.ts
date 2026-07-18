import type { ApplicationRecord } from "./applications_client";

export type ApplicationSortKey =
  | "appliedOn"
  | "company"
  | "location"
  | "nextAction"
  | "reference"
  | "status"
  | "updatedAt";

export interface ApplicationSort {
  direction: "ascending" | "descending";
  key: ApplicationSortKey;
}

function sortValue(
  application: ApplicationRecord,
  key: ApplicationSortKey,
): string | null {
  switch (key) {
    case "appliedOn":
      return application.appliedOn;
    case "company":
      return `${application.companyName}\u0000${application.roleTitle}`;
    case "location":
      return application.location;
    case "nextAction":
      return application.nextAction;
    case "reference":
      return application.id;
    case "status":
      return application.status;
    case "updatedAt":
      return application.updatedAt;
  }
}

export function sortApplications(
  applications: ApplicationRecord[],
  sort: ApplicationSort,
): ApplicationRecord[] {
  return applications
    .map((application, index) => ({ application, index }))
    .sort((left, right) => {
      if (sort.key === "nextAction") {
        const due = compareOptionalValues(
          left.application.nextActionDue,
          right.application.nextActionDue,
          sort.direction,
        );
        if (due !== 0) return due;
        const action = compareOptionalValues(
          left.application.nextAction,
          right.application.nextAction,
          sort.direction,
        );
        if (action !== 0) return action;
        return left.index - right.index;
      }
      const leftValue = sortValue(left.application, sort.key);
      const rightValue = sortValue(right.application, sort.key);
      if (leftValue === null && rightValue !== null) return 1;
      if (leftValue !== null && rightValue === null) return -1;
      if (leftValue !== null && rightValue !== null) {
        const compared = leftValue.localeCompare(rightValue, undefined, {
          sensitivity: "base",
        });
        if (compared !== 0) {
          return sort.direction === "ascending" ? compared : -compared;
        }
      }
      return left.index - right.index;
    })
    .map(({ application }) => application);
}

function compareOptionalValues(
  left: string | null,
  right: string | null,
  direction: ApplicationSort["direction"],
): number {
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  if (left === null || right === null) return 0;
  const compared = left.localeCompare(right, undefined, {
    sensitivity: "base",
  });
  return direction === "ascending" ? compared : -compared;
}
