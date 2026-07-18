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
  onOpen,
}: {
  applications: ApplicationRecord[];
  compact?: boolean;
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
      <table className="tracker-applications-table" aria-label="Applications">
        <thead>
          <tr>
            {sortableHeader("Ref", "reference")}
            {sortableHeader("Company / role", "company")}
            {sortableHeader("Stage", "status")}
            {!compact && sortableHeader("Applied", "appliedOn")}
            {!compact && sortableHeader("Location", "location")}
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
              <td>
                <StatusChip status={application.status} />
              </td>
              {!compact && <td>{formatDate(application.appliedOn)}</td>}
              {!compact && <td>{application.location ?? "—"}</td>}
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
    <span className="tracker-status-chip" data-status={status}>
      {titleCase(status)}
    </span>
  );
}

export function ApplicationEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="tracker-empty-state">
      <span aria-hidden="true">◎</span>
      <h2>No applications yet</h2>
      <p>Log the first opportunity to start your search history.</p>
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

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
