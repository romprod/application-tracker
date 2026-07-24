import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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

export type ApplicationColumnFilters = Partial<
  Record<ApplicationSortKey, string[]>
>;

interface ApplicationFilterOption {
  count: number;
  label: string;
  value: string;
}

const missingFilterValue = "\u0000not-recorded";

export function ApplicationTable({
  applications,
  columnFilters,
  compact = false,
  label = "Applications",
  onColumnFiltersChange,
  onOpen,
}: {
  applications: ApplicationRecord[];
  columnFilters?: ApplicationColumnFilters;
  compact?: boolean;
  label?: string;
  onColumnFiltersChange?: (filters: ApplicationColumnFilters) => void;
  onOpen: (application: ApplicationRecord) => void;
}) {
  const [sort, setSort] = useState<ApplicationSort | null>(null);
  const [openFilter, setOpenFilter] = useState<ApplicationSortKey | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  const filteringEnabled =
    columnFilters !== undefined && onColumnFiltersChange !== undefined;
  const rows = useMemo(() => {
    const filtered = columnFilters
      ? filterApplicationsByColumns(applications, columnFilters)
      : applications;
    return sort ? sortApplications(filtered, sort) : filtered;
  }, [applications, columnFilters, sort]);
  const closeOpenFilter = useCallback(() => {
    const closingAnchor = filterAnchor;
    setOpenFilter(null);
    setFilterAnchor(null);
    closingAnchor?.focus();
  }, [filterAnchor]);

  function toggleSort(key: ApplicationSortKey) {
    setSort((current) => ({
      direction:
        current?.key === key && current.direction === "ascending"
          ? "descending"
          : "ascending",
      key,
    }));
  }

  function toggleFilter(key: ApplicationSortKey, value: string) {
    if (!columnFilters || !onColumnFiltersChange) return;
    const selected = columnFilters[key] ?? [];
    const next = selected.includes(value)
      ? selected.filter((candidate) => candidate !== value)
      : [...selected, value];
    onColumnFiltersChange({
      ...columnFilters,
      [key]: next,
    });
  }

  function clearFilter(key: ApplicationSortKey) {
    if (!columnFilters || !onColumnFiltersChange) return;
    const next = { ...columnFilters };
    delete next[key];
    onColumnFiltersChange(next);
  }

  function sortableHeader(headerLabel: string, key: ApplicationSortKey) {
    const direction = sort?.key === key ? sort.direction : undefined;
    const selected = columnFilters?.[key] ?? [];
    const filterOptions = filteringEnabled
      ? applicationFilterOptions(applications, key)
      : [];
    return (
      <th
        className={selected.length > 0 ? "tracker-column-filtered" : undefined}
        scope="col"
        aria-sort={direction}
      >
        <div className="tracker-column-header">
          <button
            className="tracker-sort-button"
            type="button"
            onClick={() => toggleSort(key)}
          >
            {headerLabel}
            <span className="tracker-sort-direction" aria-hidden="true">
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
          {filteringEnabled && (
            <button
              className="tracker-column-filter-button"
              type="button"
              aria-expanded={openFilter === key}
              aria-haspopup="dialog"
              aria-label={
                selected.length > 0
                  ? `Filter ${headerLabel}, ${selected.length} selected`
                  : `Filter ${headerLabel}`
              }
              onClick={(event) => {
                if (openFilter === key) {
                  setOpenFilter(null);
                  setFilterAnchor(null);
                  return;
                }
                setOpenFilter(key);
                setFilterAnchor(event.currentTarget);
              }}
            >
              <FilterIcon />
              {selected.length > 0 && (
                <span className="tracker-filter-count" aria-hidden="true">
                  {selected.length}
                </span>
              )}
            </button>
          )}
        </div>
        {openFilter === key &&
          createPortal(
            <ColumnFilterMenu
              anchor={filterAnchor}
              columnLabel={headerLabel}
              onClear={() => clearFilter(key)}
              onClose={closeOpenFilter}
              onToggle={(value) => toggleFilter(key, value)}
              options={filterOptions}
              selected={selected}
            />,
            document.querySelector(".workspace-app-shell") ?? document.body,
          )}
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
          {rows.length === 0 ? (
            <tr className="tracker-table-empty-row">
              <td colSpan={compact ? 6 : 12}>
                <span aria-hidden="true">⌕</span>
                <strong>No records match these filters.</strong>
                <small>
                  Clear a column filter or change the search above to see more.
                </small>
              </td>
            </tr>
          ) : (
            rows.map((application) => (
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilterIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M2.2 3.1h11.6L9.4 8.3v3.8l-2.8 1.4V8.3L2.2 3.1Z" />
    </svg>
  );
}

function ColumnFilterMenu({
  anchor,
  columnLabel,
  onClear,
  onClose,
  onToggle,
  options,
  selected,
}: {
  anchor: HTMLButtonElement | null;
  columnLabel: string;
  onClear: () => void;
  onClose: () => void;
  onToggle: (value: string) => void;
  options: ApplicationFilterOption[];
  selected: string[];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const matchingOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? options.filter(({ label }) =>
          label.toLocaleLowerCase().includes(normalized),
        )
      : options;
  }, [options, query]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const filterAnchor = anchor;
    function placeMenu() {
      const rect = filterAnchor.getBoundingClientRect();
      const menuWidth = 292;
      setPosition({
        left: Math.max(
          8,
          Math.min(rect.left, window.innerWidth - menuWidth - 8),
        ),
        top: rect.bottom + 8,
      });
    }
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [anchor]);

  useEffect(() => {
    searchRef.current?.focus();
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !anchor?.contains(target)
      ) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={menuRef}
      className="tracker-column-filter-menu"
      role="dialog"
      aria-label={`Filter ${columnLabel}`}
      style={position}
    >
      <header>
        <span>Column filter</span>
        <strong>{columnLabel}</strong>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={onClear}
        >
          Clear
        </button>
      </header>
      <label className="tracker-column-filter-search">
        <span className="sr-only">Search {columnLabel} filter options</span>
        <span aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          type="search"
          placeholder="Find a value…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div
        className="tracker-column-filter-options"
        role="group"
        aria-label={`${columnLabel} values`}
      >
        {matchingOptions.length > 0 ? (
          matchingOptions.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
              />
              <span>{option.label}</span>
              <small>{option.count}</small>
            </label>
          ))
        ) : (
          <p>No values match that search.</p>
        )}
      </div>
      <footer>
        <span>
          {selected.length === 0
            ? "All values shown"
            : `${selected.length} ${selected.length === 1 ? "value" : "values"} selected`}
        </span>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </footer>
    </div>
  );
}

export function filterApplicationsByColumns(
  applications: ApplicationRecord[],
  filters: ApplicationColumnFilters,
): ApplicationRecord[] {
  const activeFilters = Object.entries(filters).filter(
    (entry): entry is [ApplicationSortKey, string[]] => entry[1].length > 0,
  );
  if (activeFilters.length === 0) return applications;
  return applications.filter((application) =>
    activeFilters.every(([key, selected]) =>
      selected.includes(applicationFilterValue(application, key)),
    ),
  );
}

function applicationFilterOptions(
  applications: ApplicationRecord[],
  key: ApplicationSortKey,
): ApplicationFilterOption[] {
  const options = new Map<string, ApplicationFilterOption>();
  for (const application of applications) {
    const value = applicationFilterValue(application, key);
    const current = options.get(value);
    if (current) {
      current.count += 1;
      continue;
    }
    options.set(value, {
      count: 1,
      label: applicationFilterLabel(application, key),
      value,
    });
  }
  return [...options.values()].sort((left, right) => {
    if (left.value === missingFilterValue) return 1;
    if (right.value === missingFilterValue) return -1;
    return left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function applicationFilterValue(
  application: ApplicationRecord,
  key: ApplicationSortKey,
): string {
  switch (key) {
    case "agency":
      return application.agency ?? missingFilterValue;
    case "appliedOn":
      return application.appliedOn ?? missingFilterValue;
    case "company":
      return `${application.companyName}\u0000${application.roleTitle}`;
    case "location":
      return application.location ?? missingFilterValue;
    case "nextAction":
      return application.nextAction
        ? `${application.nextAction}\u0000${application.nextActionDue ?? ""}`
        : missingFilterValue;
    case "rating":
      return application.rating?.toString() ?? missingFilterValue;
    case "reference":
      return applicationReference(application.id);
    case "salary":
      return application.salary ?? missingFilterValue;
    case "status":
      return application.statusId;
    case "updatedAt":
      return formatDate(application.updatedAt);
    case "workArrangement":
      return application.workArrangement ?? missingFilterValue;
  }
}

function applicationFilterLabel(
  application: ApplicationRecord,
  key: ApplicationSortKey,
): string {
  switch (key) {
    case "agency":
      return application.agency ?? "Not recorded";
    case "appliedOn":
      return formatDate(application.appliedOn);
    case "company":
      return `${application.companyName} — ${application.roleTitle}`;
    case "location":
      return application.location ?? "Not recorded";
    case "nextAction":
      return application.nextAction
        ? `${application.nextAction} — ${dueLabel(application.nextActionDue).text}`
        : "Not recorded";
    case "rating":
      return application.rating === null
        ? "Not recorded"
        : `${application.rating} ${application.rating === 1 ? "star" : "stars"}`;
    case "reference":
      return applicationReference(application.id);
    case "salary":
      return application.salary ?? "Not recorded";
    case "status":
      return application.status;
    case "updatedAt":
      return formatDate(application.updatedAt);
    case "workArrangement":
      return formatWorkArrangement(application.workArrangement);
  }
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
