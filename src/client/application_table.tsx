import { useMemo, useState } from "react";

import type {
  ApplicationRecord,
  ApplicationStatus,
} from "./applications_client";
import {
  sortApplications,
  type ApplicationSort,
  type ApplicationSortKey,
} from "./application_sort";
import { dueLabel } from "./application_next_action";

export function ApplicationTable({
  applications,
  compact = false,
  label = "Applications",
  onOpen,
}: {
  applications: ApplicationRecord[];
  compact?: boolean;
  label?: string;
  onOpen: (application: ApplicationRecord) => void;
}) {
  const [sort, setSort] = useState<ApplicationSort | null>(null);
  const rows = useMemo(
    () => (sort ? sortApplications(applications, sort) : applications),
    [applications, sort],
  );

  function toggleSort(key: ApplicationSortKey) {
    setSort((current) => ({
      direction:
        current?.key === key && current.direction === "ascending"
          ? "descending"
          : "ascending",
      key,
    }));
  }

  function sortableHeader(label: string, key: ApplicationSortKey) {
    const direction = sort?.key === key ? sort.direction : undefined;
    return (
      <th scope="col" aria-sort={direction}>
        <button type="button" onClick={() => toggleSort(key)}>
          {label}
          <span aria-hidden="true">
            {direction === "ascending"
              ? "↑"
              : direction === "descending"
                ? "↓"
                : "↕"}
          </span>
          <span className="sr-only">
            {direction
              ? `, sorted ${direction}. Activate to sort ${direction === "ascending" ? "descending" : "ascending"}.`
              : ", not sorted. Activate to sort ascending."}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className={`tracker-table-shell${compact ? " compact" : ""}`}>
      <table className="tracker-applications-table" aria-label={label}>
        <thead>
          <tr>
            {sortableHeader("Ref", "reference")}
            {sortableHeader("End company / role", "company")}
            {!compact && sortableHeader("Agency", "agency")}
            {sortableHeader("Stage", "status")}
            {!compact && sortableHeader("Salary", "salary")}
            {!compact && sortableHeader("Rating", "rating")}
            {!compact && sortableHeader("Applied", "appliedOn")}
            {!compact && sortableHeader("Location", "location")}
            {!compact && sortableHeader("Work arrangement", "workArrangement")}
            {sortableHeader("Next action", "nextAction")}
            {sortableHeader("Updated", "updatedAt")}
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((application) => (
            <tr
              key={application.id}
              tabIndex={0}
              onClick={() => onOpen(application)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(application);
                }
              }}
            >
              <td>
                <span className="tracker-reference">
                  {applicationReference(application.id)}
                </span>
              </td>
              <td>
                <strong>{application.companyName}</strong>
                <span>{application.roleTitle}</span>
              </td>
              {!compact && <td>{application.agency ?? "—"}</td>}
              <td>
                <StatusChip status={application.status} />
              </td>
              {!compact && <td>{application.salary ?? "—"}</td>}
              {!compact && (
                <td>
                  <RatingStars rating={application.rating} />
                </td>
              )}
              {!compact && <td>{formatDate(application.appliedOn)}</td>}
              {!compact && <td>{application.location ?? "—"}</td>}
              {!compact && (
                <td>{formatWorkArrangement(application.workArrangement)}</td>
              )}
              <NextActionCell application={application} />
              <td>{formatDate(application.updatedAt)}</td>
              <td>
                <button
                  className="tracker-open-row"
                  type="button"
                  aria-label={`Open ${application.companyName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(application);
                  }}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null) return <>—</>;
  return (
    <span
      className="tracker-rating"
      aria-label={`${rating} out of 5 stars`}
      title={`${rating} out of 5 stars`}
    >
      <span aria-hidden="true">
        {"★".repeat(rating)}
        <span>{"☆".repeat(5 - rating)}</span>
      </span>
    </span>
  );
}

function NextActionCell({ application }: { application: ApplicationRecord }) {
  if (!application.nextAction) return <td>—</td>;
  const due = dueLabel(application.nextActionDue);
  return (
    <td className="tracker-next-action-cell">
      <strong>{application.nextAction}</strong>
      <span className={`tracker-due-label ${due.tone}`}>{due.text}</span>
    </td>
  );
}

export function StatusChip({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className="tracker-status-chip"
      data-status={status.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}
    >
      {status}
    </span>
  );
}

export function ApplicationEmptyState({
  kind = "applications",
  onAdd,
}: {
  kind?: "applications" | "opportunities";
  onAdd: () => void;
}) {
  const opportunities = kind === "opportunities";
  return (
    <div className="tracker-empty-state">
      <span aria-hidden="true">◎</span>
      <h2>{opportunities ? "No opportunities yet" : "No applications yet"}</h2>
      <p>
        {opportunities
          ? "Log the first opportunity to start your search history."
          : "Set an applied date on an opportunity and it will appear here."}
      </p>
      <button
        className="tracker-button tracker-button-primary"
        type="button"
        onClick={onAdd}
      >
        Log application
      </button>
    </div>
  );
}

export function ApplicationLoadError() {
  return (
    <p className="tracker-load-error" role="alert">
      Applications could not be loaded. Reload the page to try again.
    </p>
  );
}

export function applicationReference(id: string): string {
  return id.replaceAll("-", "").slice(0, 6).toUpperCase();
}

export function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value.includes("T") ? value : `${value}T00:00:00`));
}

export function formatWorkArrangement(
  value: ApplicationRecord["workArrangement"],
): string {
  return value
    ? `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`
    : "Not recorded";
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
