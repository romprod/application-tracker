import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApplicationsClientError,
  type ApplicationEvent,
  type ApplicationRecord,
  type ApplicationsClient,
  type ApplicationStatus,
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
} from "./application_table";
import type { AuthenticatedSession } from "./auth_client";
import { dueLabel, nextActionApplications } from "./application_next_action";

export function ApplicationWorkspace({
  applicationsClient,
  error,
  navigate,
  notice: initialNotice,
  page,
  session,
}: {
  applicationsClient: ApplicationsClient;
  error?: string;
  navigate: (page: "applications" | "overview") => void;
  notice?: string;
  page: "applications" | "overview";
  session: AuthenticatedSession;
}) {
  const [applications, setApplications] = useState<ApplicationRecord[]>();
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState(initialNotice);
  const [formMode, setFormMode] = useState<"create" | "edit">();
  const [editingApplication, setEditingApplication] =
    useState<ApplicationRecord>();
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<ApplicationRecord>();
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [selectedApplication, setSelectedApplication] =
    useState<ApplicationRecord>();
  const [events, setEvents] = useState<ApplicationEvent[]>();
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState(false);
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
    setFormMode("create");
    setEditingApplication(undefined);
    setFormError(undefined);
    setNotice(undefined);
  }

  function beginEdit(application: ApplicationRecord) {
    setFormMode("edit");
    setEditingApplication(application);
    setFormError(undefined);
    setNotice(undefined);
  }

  function closeForm() {
    if (submitting) return;
    setFormMode(undefined);
    setEditingApplication(undefined);
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
          applicationUpdateInput(form),
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
        setSubmitting(false);
        if (editingId && selectedApplication?.id === editingId) {
          openApplication(saved);
        }
      })
      .catch((caught: unknown) => {
        const action = editingId ? "updated" : "added";
        setFormError(
          caught instanceof ApplicationsClientError &&
            caught.code === "validation_error"
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
      {page === "overview" ? (
        <DashboardView
          applications={applications}
          loadError={loadError}
          onAdd={beginCreate}
          onOpen={openApplication}
          onViewAll={() => navigate("applications")}
          session={session}
        />
      ) : (
        <ApplicationsPage
          applications={applications}
          loadError={loadError}
          onAdd={beginCreate}
          onOpen={openApplication}
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
          key={`${formMode}-${editingApplication?.id ?? "new"}`}
          application={editingApplication}
          error={formError}
          mode={formMode}
          onClose={closeForm}
          onSave={saveApplication}
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
    </main>
  );
}

function DashboardView({
  applications,
  loadError,
  onAdd,
  onOpen,
  onViewAll,
  session,
}: {
  applications: ApplicationRecord[] | undefined;
  loadError: boolean;
  onAdd: () => void;
  onOpen: (application: ApplicationRecord) => void;
  onViewAll: () => void;
  session: AuthenticatedSession;
}) {
  const count = (status: ApplicationStatus) =>
    applications?.filter((application) => application.status === status)
      .length ?? 0;
  const total = applications?.length ?? 0;
  const open =
    applications?.filter(({ status }) => status !== "closed").length ?? 0;
  const statusCounts = [
    { label: "Prospect", status: "prospect" as const },
    { label: "Applied", status: "applied" as const },
    { label: "Interview", status: "interview" as const },
    { label: "Offer", status: "offer" as const },
    { label: "Closed", status: "closed" as const },
  ];
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
        <Metric label="Applied" value={count("applied")} note="submitted" />
        <Metric
          label="Interviews"
          value={count("interview")}
          note="in conversation"
        />
        <Metric label="Offers" value={count("offer")} note="received" />
        <Metric label="Closed" value={count("closed")} note="completed" />
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
                {statusCounts.map(({ label, status }) => {
                  const value = count(status);
                  const width =
                    total === 0
                      ? 0
                      : Math.max((value / total) * 100, value ? 4 : 0);
                  return (
                    <div className="tracker-status-row" key={status}>
                      <div>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                      <div className="tracker-status-track" aria-hidden="true">
                        <span
                          data-status={status}
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
              <ApplicationEmptyState onAdd={onAdd} />
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
}: {
  applications: ApplicationRecord[] | undefined;
  loadError: boolean;
  onAdd: () => void;
  onOpen: (application: ApplicationRecord) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [location, setLocation] = useState("");
  const locations = useMemo(
    () =>
      [
        ...new Set(
          (applications ?? []).flatMap((application) =>
            application.location ? [application.location] : [],
          ),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [applications],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (applications ?? []).filter((application) => {
      const matchesSearch =
        !query ||
        [
          application.id,
          application.companyName,
          application.roleTitle,
          application.location,
          application.nextAction,
          application.notes,
          application.sourceUrl,
          ...application.contacts.flatMap((contact) => [
            contact.name,
            contact.role,
            contact.email,
            contact.phone,
          ]),
          ...application.links.flatMap((link) => [link.label, link.url]),
        ].some((value) => value?.toLocaleLowerCase().includes(query));
      return (
        matchesSearch &&
        (!status || application.status === status) &&
        (!location || application.location === location)
      );
    });
  }, [applications, location, search, status]);

  return (
    <div className="workspace-page applications-page">
      <header className="tracker-page-header">
        <div>
          <span className="eyebrow">Opportunity register</span>
          <h1>Applications</h1>
          <p>Search, sort, and review every role in your private workspace.</p>
        </div>
        <button
          className="tracker-button tracker-button-primary"
          type="button"
          onClick={onAdd}
        >
          <span aria-hidden="true">＋</span>
          Log application
        </button>
      </header>

      <div className="tracker-filter-bar">
        <div className="tracker-search">
          <span aria-hidden="true">⌕</span>
          <label className="sr-only" htmlFor="application-search">
            Search applications
          </label>
          <input
            id="application-search"
            placeholder="Search company, role, contact, or notes…"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className="tracker-filter-field">
          <span className="sr-only">Filter by stage</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All stages</option>
            <option value="prospect">Prospect</option>
            <option value="applied">Applied</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="tracker-filter-field">
          <span className="sr-only">Filter by location</span>
          <select
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <span className="tracker-result-count" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "record" : "records"}
        </span>
      </div>

      {loadError && <ApplicationLoadError />}
      {!applications && !loadError && (
        <p className="tracker-loading">Opening the application register…</p>
      )}
      {applications &&
        filtered.length === 0 &&
        !search &&
        !status &&
        !location && <ApplicationEmptyState onAdd={onAdd} />}
      {applications &&
        filtered.length === 0 &&
        (Boolean(search) || Boolean(status) || Boolean(location)) && (
          <div className="tracker-empty-state">
            <span aria-hidden="true">⌕</span>
            <h2>No matching applications</h2>
            <p>Change the search or filters to see more records.</p>
          </div>
        )}
      {filtered.length > 0 && (
        <ApplicationTable applications={filtered} onOpen={onOpen} />
      )}
    </div>
  );
}
