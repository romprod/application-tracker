import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApplicationsClientError,
  type ApplicationEvent,
  type ApplicationRecord,
  type ApplicationsClient,
} from "./applications_client";
import {
  ApplicationDialog,
  ApplicationDrawer,
  DeleteApplicationDialog,
  applicationInput,
  applicationUpdateInput,
  type ApplicationFormState,
} from "./application_overlays";
import {
  ApplicationEmptyState,
  ApplicationLoadError,
  ApplicationTable,
  filterApplicationsByColumns,
  type ApplicationColumnFilters,
} from "./application_table";
import type { AuthenticatedSession } from "./auth_client";
import { dueLabel, nextActionApplications } from "./application_next_action";
import { DuplicateApplicationsDialog } from "./duplicate_applications_dialog";
import type {
  ReferenceValue,
  ReferenceValuesClient,
} from "./reference_values_client";
import type { EmailLinksClient } from "./email_links_client";

export function ApplicationWorkspace({
  applicationsClient,
  emailLinksClient,
  error,
  navigate,
  notice: initialNotice,
  page,
  referenceValuesClient,
  session,
}: {
  applicationsClient: ApplicationsClient;
  emailLinksClient: EmailLinksClient;
  error?: string;
  navigate: (page: "applications" | "opportunities" | "overview") => void;
  notice?: string;
  page: "applications" | "opportunities" | "overview";
  referenceValuesClient: ReferenceValuesClient;
  session: AuthenticatedSession;
}) {
  const [applications, setApplications] = useState<ApplicationRecord[]>();
  const [referenceValues, setReferenceValues] = useState<ReferenceValue[]>();
  const [referenceLoadError, setReferenceLoadError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState(initialNotice);
  const [formMode, setFormMode] = useState<"create" | "edit">();
  const [editingApplication, setEditingApplication] =
    useState<ApplicationRecord>();
  const [formError, setFormError] = useState<string>();
  const [conflictApplication, setConflictApplication] =
    useState<ApplicationRecord>();
  const [submitting, setSubmitting] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<ApplicationRecord>();
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [selectedApplication, setSelectedApplication] =
    useState<ApplicationRecord>();
  const [events, setEvents] = useState<ApplicationEvent[]>();
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [reviewingDuplicates, setReviewingDuplicates] = useState(false);
  const historyRequest = useRef(0);

  useEffect(() => {
    let active = true;
    void applicationsClient
      .listApplications()
      .then((loaded) => {
        if (active) setApplications(loaded);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [applicationsClient]);

  useEffect(() => {
    let active = true;
    void referenceValuesClient
      .listValues()
      .then((loaded) => {
        if (active) setReferenceValues(loaded);
      })
      .catch(() => {
        if (active) setReferenceLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [referenceValuesClient]);

  function openApplication(application: ApplicationRecord) {
    const request = historyRequest.current + 1;
    historyRequest.current = request;
    setSelectedApplication(application);
    setEvents(undefined);
    setEventsError(false);
    setEventsLoading(true);
    void applicationsClient
      .listApplicationEvents(application.id)
      .then((loaded) => {
        if (historyRequest.current !== request) return;
        setEvents(loaded);
        setEventsLoading(false);
      })
      .catch(() => {
        if (historyRequest.current !== request) return;
        setEventsError(true);
        setEventsLoading(false);
      });
  }

  function closeApplication() {
    historyRequest.current += 1;
    setSelectedApplication(undefined);
    setEvents(undefined);
    setEventsLoading(false);
    setEventsError(false);
  }

  function beginCreate() {
    if (!referenceValues) {
      setNotice("Application lists are still loading. Please try again.");
      return;
    }
    setFormMode("create");
    setEditingApplication(undefined);
    setConflictApplication(undefined);
    setFormError(undefined);
    setNotice(undefined);
  }

  function beginEdit(application: ApplicationRecord) {
    setFormMode("edit");
    setEditingApplication(application);
    setConflictApplication(undefined);
    setFormError(undefined);
    setNotice(undefined);
  }

  function closeForm() {
    if (submitting) return;
    setFormMode(undefined);
    setEditingApplication(undefined);
    setConflictApplication(undefined);
    setFormError(undefined);
  }

  function beginDelete(application: ApplicationRecord) {
    closeApplication();
    setDeletionTarget(application);
    setDeleteError(undefined);
    setNotice(undefined);
  }

  function closeDelete() {
    if (deleting) return;
    setDeletionTarget(undefined);
    setDeleteError(undefined);
  }

  function removeApplication() {
    if (!deletionTarget) return;
    const removing = deletionTarget;
    setDeleting(true);
    setDeleteError(undefined);
    void applicationsClient
      .deleteApplication(removing.id)
      .then(() => {
        setApplications((current) =>
          current?.filter(({ id }) => id !== removing.id),
        );
        setDeletionTarget(undefined);
        setNotice(`${removing.companyName} was removed.`);
        setDeleting(false);
      })
      .catch(() => {
        setDeleteError("The application could not be removed. Try again.");
        setDeleting(false);
      });
  }

  function saveApplication(form: ApplicationFormState) {
    setSubmitting(true);
    setFormError(undefined);
    const editingId = editingApplication?.id;
    const operation = editingId
      ? applicationsClient.updateApplication(
          editingId,
          applicationUpdateInput(form, editingApplication.updatedAt),
        )
      : applicationsClient.createApplication(applicationInput(form));
    void operation
      .then((saved) => {
        setApplications((current) => [
          saved,
          ...(current ?? []).filter(({ id }) => id !== saved.id),
        ]);
        setSelectedApplication((current) =>
          current?.id === saved.id ? saved : current,
        );
        setNotice(
          editingId
            ? `${saved.companyName} was updated.`
            : `${saved.companyName} was added to the ledger.`,
        );
        setFormMode(undefined);
        setEditingApplication(undefined);
        setConflictApplication(undefined);
        setSubmitting(false);
        if (editingId && selectedApplication?.id === editingId) {
          openApplication(saved);
        }
      })
      .catch((caught: unknown) => {
        if (
          caught instanceof ApplicationsClientError &&
          caught.code === "application_conflict" &&
          caught.application
        ) {
          const latest = caught.application;
          setApplications((current) =>
            current?.map((application) =>
              application.id === latest.id ? latest : application,
            ),
          );
          setConflictApplication(latest);
          setFormError(
            "This application changed after you opened it. Reload the latest version before saving.",
          );
          setSubmitting(false);
          return;
        }
        const action = editingId ? "updated" : "added";
        setFormError(
          caught instanceof ApplicationsClientError &&
            (caught.code === "validation_error" ||
              caught.code === "invalid_application_reference")
            ? "Review the application details and try again."
            : `The application could not be ${action}. Please try again.`,
        );
        setSubmitting(false);
      });
  }

  return (
    <main id="main-content" tabIndex={-1} className="workspace-main">
      {notice && (
        <div className="workspace-notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="workspace-error" role="alert">
          {error}
        </div>
      )}
      {referenceLoadError && (
        <div className="workspace-error" role="alert">
          Application lists could not be loaded. Reload the page to try again.
        </div>
      )}
      {page === "overview" ? (
        <DashboardView
          applications={applications}
          loadError={loadError}
          onAdd={beginCreate}
          onOpen={openApplication}
          onViewAll={() => navigate("opportunities")}
          referenceValues={referenceValues ?? []}
          session={session}
        />
      ) : (
        <ApplicationsPage
          applications={applications}
          loadError={loadError}
          onAdd={beginCreate}
          onOpen={openApplication}
          onReviewDuplicates={() => {
            setNotice(undefined);
            setReviewingDuplicates(true);
          }}
          page={page}
        />
      )}
      {selectedApplication && (
        <ApplicationDrawer
          key={selectedApplication.id}
          application={selectedApplication}
          events={events}
          eventsError={eventsError}
          eventsLoading={eventsLoading}
          onClose={closeApplication}
          onDelete={() => beginDelete(selectedApplication)}
          onEdit={() => {
            const application = selectedApplication;
            closeApplication();
            beginEdit(application);
          }}
        />
      )}
      {formMode && (
        <ApplicationDialog
          key={`${formMode}-${editingApplication?.id ?? "new"}-${editingApplication?.updatedAt ?? ""}`}
          application={editingApplication}
          emailLinksClient={emailLinksClient}
          error={formError}
          mode={formMode}
          onClose={closeForm}
          {...(conflictApplication
            ? {
                onReloadLatest: () => {
                  setEditingApplication(conflictApplication);
                  setConflictApplication(undefined);
                  setFormError(undefined);
                },
              }
            : {})}
          onSave={saveApplication}
          referenceValues={referenceValues ?? []}
          submitting={submitting}
        />
      )}
      {deletionTarget && (
        <DeleteApplicationDialog
          application={deletionTarget}
          deleting={deleting}
          error={deleteError}
          onClose={closeDelete}
          onConfirm={removeApplication}
        />
      )}
      {reviewingDuplicates && (
        <DuplicateApplicationsDialog
          applicationsClient={applicationsClient}
          onClose={() => setReviewingDuplicates(false)}
          onMerged={(survivor, sourceApplicationId) => {
            setApplications((current) => [
              survivor,
              ...(current ?? []).filter(
                ({ id }) => id !== survivor.id && id !== sourceApplicationId,
              ),
            ]);
            setReviewingDuplicates(false);
            setNotice(`${survivor.companyName} duplicates were merged safely.`);
          }}
        />
      )}
    </main>
  );
}

function DashboardView({
  applications,
  loadError,
  onAdd,
  onOpen,
  onViewAll,
  referenceValues,
  session,
}: {
  applications: ApplicationRecord[] | undefined;
  loadError: boolean;
  onAdd: () => void;
  onOpen: (application: ApplicationRecord) => void;
  onViewAll: () => void;
  referenceValues: ReferenceValue[];
  session: AuthenticatedSession;
}) {
  const count = (statusId: string) =>
    applications?.filter((application) => application.statusId === statusId)
      .length ?? 0;
  const total = applications?.length ?? 0;
  const open =
    applications?.filter(({ statusIsTerminal }) => !statusIsTerminal).length ??
    0;
  const referencedStatusIds = new Set(
    (applications ?? []).map(({ statusId }) => statusId),
  );
  const statusCounts = referenceValues.filter(
    ({ category, id, isActive }) =>
      category === "status" && (isActive || referencedStatusIds.has(id)),
  );
  const activeFocus = nextActionApplications(applications ?? []);

  return (
    <div className="workspace-page dashboard-page">
      <section className="tracker-dashboard-hero" aria-labelledby="page-title">
        <div className="tracker-hero-copy">
          <span className="eyebrow">{session.workspace.name} · Dashboard</span>
          <h1 id="page-title" aria-label="Your search, at a glance.">
            Your search,
            <br />
            <em>at a glance.</em>
          </h1>
          <p>
            Every opportunity in one calm, private workspace—clear enough to see
            what is moving and what needs attention.
          </p>
          <button
            className="tracker-button tracker-button-primary"
            type="button"
            onClick={onAdd}
          >
            <span aria-hidden="true">＋</span>
            Log application
          </button>
        </div>
        <div
          className="tracker-hero-figure"
          aria-label={`${open} open applications`}
        >
          <div className="tracker-figure-ring">
            <strong>{open}</strong>
            <span>open</span>
          </div>
          <p>{total} applications recorded</p>
        </div>
      </section>

      <section className="tracker-metrics" aria-label="Application metrics">
        <Metric label="Total" value={total} note="all records" />
        <Metric label="Open" value={open} note="active search" accent />
        {statusCounts.slice(0, 4).map((status) => (
          <Metric
            key={status.id}
            label={status.label}
            value={count(status.id)}
            note={status.isTerminal ? "closed outcome" : "workspace status"}
          />
        ))}
      </section>

      {loadError && <ApplicationLoadError />}
      {!applications && !loadError && (
        <p className="tracker-loading">Opening your workspace…</p>
      )}
      {applications && (
        <>
          <div className="tracker-dashboard-grid">
            <section
              className="tracker-panel"
              aria-labelledby="distribution-title"
            >
              <div className="tracker-panel-heading">
                <div>
                  <span className="eyebrow">Pipeline</span>
                  <h2 id="distribution-title">Status distribution</h2>
                </div>
                <span>{total} total</span>
              </div>
              <div className="tracker-status-bars">
                {statusCounts.map((status) => {
                  const value = count(status.id);
                  const width =
                    total === 0
                      ? 0
                      : Math.max((value / total) * 100, value ? 4 : 0);
                  return (
                    <div className="tracker-status-row" key={status.id}>
                      <div>
                        <span>{status.label}</span>
                        <strong>{value}</strong>
                      </div>
                      <div className="tracker-status-track" aria-hidden="true">
                        <span
                          data-status={
                            status.isTerminal ? "terminal" : "active"
                          }
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <section
              className="tracker-panel tracker-focus"
              aria-labelledby="focus-title"
            >
              <div className="tracker-panel-heading">
                <div>
                  <span className="eyebrow">Current focus</span>
                  <h2 id="focus-title">Next actions</h2>
                </div>
                <span>{activeFocus.length} active</span>
              </div>
              {activeFocus.length === 0 ? (
                <div className="tracker-quiet-state">
                  <span aria-hidden="true">◎</span>
                  <p>Add a next action to an application to see it here.</p>
                </div>
              ) : (
                <ol>
                  {activeFocus.slice(0, 4).map((application) => {
                    const due = dueLabel(application.nextActionDue);
                    return (
                      <li key={application.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(application)}
                        >
                          <span className={`tracker-due-label ${due.tone}`}>
                            {due.text}
                          </span>
                          <strong>{application.nextAction}</strong>
                          <small>
                            {application.companyName} · {application.roleTitle}
                          </small>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>

          <section className="tracker-recent" aria-labelledby="recent-title">
            <div className="tracker-section-heading">
              <div>
                <span className="eyebrow">Latest movement</span>
                <h2 id="recent-title">Recent applications</h2>
              </div>
              <button
                className="tracker-text-button"
                type="button"
                onClick={onViewAll}
              >
                View all <span aria-hidden="true">→</span>
              </button>
            </div>
            {applications.length === 0 ? (
              <ApplicationEmptyState kind="opportunities" onAdd={onAdd} />
            ) : (
              <ApplicationTable
                applications={applications.slice(0, 5)}
                compact
                onOpen={onOpen}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Metric({
  accent = false,
  label,
  note,
  value,
}: {
  accent?: boolean;
  label: string;
  note: string;
  value: number;
}) {
  return (
    <article className={`tracker-metric${accent ? " accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function ApplicationsPage({
  applications,
  loadError,
  onAdd,
  onOpen,
  onReviewDuplicates,
  page,
}: {
  applications: ApplicationRecord[] | undefined;
  loadError: boolean;
  onAdd: () => void;
  onOpen: (application: ApplicationRecord) => void;
  onReviewDuplicates: () => void;
  page: "applications" | "opportunities";
}) {
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<ApplicationColumnFilters>(
    {},
  );
  const visibleApplications = useMemo(
    () =>
      page === "applications"
        ? (applications ?? []).filter(({ appliedOn }) => appliedOn !== null)
        : (applications ?? []),
    [applications, page],
  );
  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? visibleApplications.filter((application) =>
          [
            application.id,
            application.agency,
            application.companyName,
            application.roleTitle,
            application.location,
            application.nextAction,
            application.notes,
            application.rating?.toString(),
            application.roleType,
            application.salary,
            application.source,
            application.sourceUrl,
            application.workArrangement,
            ...application.contacts.flatMap((contact) => [
              contact.name,
              contact.role,
              contact.email,
              contact.phone,
            ]),
            ...application.links.flatMap((link) => [link.label, link.url]),
          ].some((value) => value?.toLocaleLowerCase().includes(query)),
        )
      : visibleApplications;
  }, [search, visibleApplications]);
  const filtered = useMemo(
    () => filterApplicationsByColumns(searchResults, columnFilters),
    [columnFilters, searchResults],
  );
  const hasColumnFilters = Object.values(columnFilters).some(
    (selected) => selected !== undefined && selected.length > 0,
  );
  const pageName = page === "applications" ? "Applications" : "Opportunities";
  const pageNameLower = pageName.toLocaleLowerCase();

  return (
    <div className="workspace-page applications-page">
      <header className="tracker-page-header">
        <div>
          <span className="eyebrow">
            {page === "applications"
              ? "Application register"
              : "Opportunity register"}
          </span>
          <h1>{pageName}</h1>
          <p>
            {page === "applications"
              ? "Search, sort, and review the opportunities you have applied for."
              : "Search, sort, and review every role in your private workspace."}
          </p>
        </div>
        <div className="tracker-page-actions">
          <button
            className="tracker-button tracker-button-quiet"
            type="button"
            onClick={onReviewDuplicates}
          >
            Review duplicates
          </button>
          <button
            className="tracker-button tracker-button-primary"
            type="button"
            onClick={onAdd}
          >
            <span aria-hidden="true">＋</span>
            Log application
          </button>
        </div>
      </header>

      <div className="tracker-filter-bar">
        <div className="tracker-search">
          <span aria-hidden="true">⌕</span>
          <label className="sr-only" htmlFor="application-search">
            Search {pageNameLower}
          </label>
          <input
            id="application-search"
            placeholder={`Search ${pageNameLower} by end company, agency, role, salary, work arrangement, contact, or notes…`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="tracker-result-count" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "record" : "records"}
        </span>
      </div>

      {loadError && <ApplicationLoadError />}
      {!applications && !loadError && (
        <p className="tracker-loading">Opening the {pageNameLower} register…</p>
      )}
      {applications &&
        visibleApplications.length === 0 &&
        !search &&
        !hasColumnFilters && (
          <ApplicationEmptyState kind={page} onAdd={onAdd} />
        )}
      {applications && visibleApplications.length > 0 && (
        <ApplicationTable
          applications={searchResults}
          columnFilters={columnFilters}
          label={pageName}
          onColumnFiltersChange={setColumnFilters}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
