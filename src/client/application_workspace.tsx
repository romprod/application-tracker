import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ApplicationsClientError,
  type AddApplicationActivityInput,
  type ApplicationAttentionPage,
  type ApplicationEvidence,
  type ApplicationEventsPage,
  type ApplicationFieldProvenanceAssessment,
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
  applicationReference,
  filterApplicationsByColumns,
  type ApplicationColumnFilters,
} from "./application_table";
import type { AuthenticatedSession } from "./auth_client";
import { dueLabel, nextActionApplications } from "./application_next_action";
import type {
  ReferenceValue,
  ReferenceValuesClient,
} from "./reference_values_client";
import type { EmailLinksClient } from "./email_links_client";
import type {
  OutlookConnectionsClient,
  OutlookGraphConnectionOption,
} from "./outlook_connections_client";
import {
  loadCachedApplications,
  loadCachedReferenceValues,
  updateCachedApplications,
} from "./workspace_data_cache";

const loadDuplicateApplicationsDialog = () =>
  import("./duplicate_applications_dialog");
const DuplicateApplicationsDialog = lazy(() =>
  loadDuplicateApplicationsDialog().then((module) => ({
    default: module.DuplicateApplicationsDialog,
  })),
);
const loadDeletedApplicationsDialog = () =>
  import("./deleted_applications_dialog");
const DeletedApplicationsDialog = lazy(() =>
  loadDeletedApplicationsDialog().then((module) => ({
    default: module.DeletedApplicationsDialog,
  })),
);

export function ApplicationWorkspace({
  applicationsClient,
  emailLinksClient,
  error,
  navigate,
  notice: initialNotice,
  outlookConnectionsClient,
  page,
  referenceValuesClient,
  session,
}: {
  applicationsClient: ApplicationsClient;
  emailLinksClient: EmailLinksClient;
  error?: string;
  navigate: (
    page: "applications" | "documents" | "opportunities" | "overview",
  ) => void;
  notice?: string;
  outlookConnectionsClient: OutlookConnectionsClient;
  page: "applications" | "opportunities" | "overview";
  referenceValuesClient: ReferenceValuesClient;
  session: AuthenticatedSession;
}) {
  const [applications, setApplications] = useState<ApplicationRecord[]>();
  const [attentionPage, setAttentionPage] =
    useState<ApplicationAttentionPage>();
  const [attentionError, setAttentionError] = useState(false);
  const [referenceValues, setReferenceValues] = useState<ReferenceValue[]>();
  const [referenceLoadError, setReferenceLoadError] = useState(false);
  const [outlookConnections, setOutlookConnections] =
    useState<OutlookGraphConnectionOption[]>();
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
  const [eventsPage, setEventsPage] = useState<ApplicationEventsPage>();
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLoadingMore, setEventsLoadingMore] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [evidence, setEvidence] = useState<ApplicationEvidence>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);
  const [provenance, setProvenance] =
    useState<ApplicationFieldProvenanceAssessment[]>();
  const [provenanceLoading, setProvenanceLoading] = useState(false);
  const [provenanceError, setProvenanceError] = useState(false);
  const [provenanceVerifyingId, setProvenanceVerifyingId] = useState<string>();
  const [reviewingDuplicates, setReviewingDuplicates] = useState(false);
  const [reviewingDeleted, setReviewingDeleted] = useState(false);
  const drawerRequest = useRef(0);

  const refreshAttention = useCallback(() => {
    setAttentionError(false);
    return applicationsClient
      .queryApplicationAttention({
        attentionOnly: true,
        lifecycle: "all",
        limit: 25,
        offset: 0,
      })
      .then(setAttentionPage)
      .catch(() => setAttentionError(true));
  }, [applicationsClient]);

  useEffect(() => {
    let active = true;
    void loadCachedApplications(applicationsClient)
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
    void applicationsClient
      .queryApplicationAttention({
        attentionOnly: true,
        lifecycle: "all",
        limit: 25,
        offset: 0,
      })
      .then((page) => {
        if (active) setAttentionPage(page);
      })
      .catch(() => {
        if (active) setAttentionError(true);
      });
    return () => {
      active = false;
    };
  }, [applicationsClient]);

  useEffect(() => {
    let active = true;
    void loadCachedReferenceValues(referenceValuesClient)
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

  useEffect(() => {
    let active = true;
    void outlookConnectionsClient
      .listOptions()
      .then((loaded) => {
        if (active) setOutlookConnections(loaded);
      })
      .catch(() => {
        if (active) setOutlookConnections([]);
      });
    return () => {
      active = false;
    };
  }, [outlookConnectionsClient]);

  function openApplication(application: ApplicationRecord) {
    const request = drawerRequest.current + 1;
    drawerRequest.current = request;
    setSelectedApplication(application);
    setEventsPage(undefined);
    setEventsError(false);
    setEventsLoading(true);
    setEvidence(undefined);
    setEvidenceError(false);
    setEvidenceLoading(true);
    setProvenance(undefined);
    setProvenanceError(false);
    setProvenanceLoading(true);

    const eventsRequest = applicationsClient.listApplicationEvents(
      application.id,
      { limit: 25, offset: 0 },
    );
    const evidenceRequest = applicationsClient.getApplicationEvidence(
      application.id,
    );
    const provenanceRequest = applicationsClient.listApplicationFieldProvenance(
      application.id,
    );
    void eventsRequest
      .then((loaded) => {
        if (drawerRequest.current !== request) return;
        setEventsPage(loaded);
        setEventsLoading(false);
      })
      .catch(() => {
        if (drawerRequest.current !== request) return;
        setEventsError(true);
        setEventsLoading(false);
      });
    void provenanceRequest
      .then((loaded) => {
        if (drawerRequest.current !== request) return;
        setProvenance(loaded);
        setProvenanceLoading(false);
      })
      .catch(() => {
        if (drawerRequest.current !== request) return;
        setProvenanceError(true);
        setProvenanceLoading(false);
      });
    void evidenceRequest
      .then((loaded) => {
        if (drawerRequest.current !== request) return;
        setEvidence(loaded);
        setEvidenceLoading(false);
      })
      .catch(() => {
        if (drawerRequest.current !== request) return;
        setEvidenceError(true);
        setEvidenceLoading(false);
      });
  }

  function closeApplication() {
    drawerRequest.current += 1;
    setSelectedApplication(undefined);
    setEventsPage(undefined);
    setEventsLoading(false);
    setEventsLoadingMore(false);
    setEventsError(false);
    setEvidence(undefined);
    setEvidenceLoading(false);
    setEvidenceError(false);
    setProvenance(undefined);
    setProvenanceLoading(false);
    setProvenanceError(false);
    setProvenanceVerifyingId(undefined);
  }

  async function verifyProvenance(provenanceId: string) {
    if (!selectedApplication || provenanceVerifyingId) return;
    setProvenanceVerifyingId(provenanceId);
    setProvenanceError(false);
    try {
      await applicationsClient.verifyApplicationFieldProvenance(
        selectedApplication.id,
        provenanceId,
      );
      setProvenance(
        await applicationsClient.listApplicationFieldProvenance(
          selectedApplication.id,
        ),
      );
    } catch {
      setProvenanceError(true);
    } finally {
      setProvenanceVerifyingId(undefined);
    }
  }

  async function addActivity(input: AddApplicationActivityInput) {
    if (!selectedApplication) return;
    const event = await applicationsClient.addApplicationActivity(
      selectedApplication.id,
      input,
    );
    setEventsPage((current) => {
      const currentEvents = current?.events ?? [];
      const events = [
        event,
        ...currentEvents.filter((candidate) => candidate.id !== event.id),
      ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
      const total =
        Math.max(current?.total ?? 0, currentEvents.length) +
        (currentEvents.some((candidate) => candidate.id === event.id) ? 0 : 1);
      return {
        events,
        limit: current?.limit ?? 25,
        nextOffset: events.length < total ? events.length : null,
        offset: 0,
        returned: events.length,
        total,
      };
    });
  }

  async function loadMoreEvents() {
    if (
      !selectedApplication ||
      eventsPage?.nextOffset === null ||
      eventsLoadingMore
    ) {
      return;
    }
    const offset = eventsPage?.nextOffset;
    if (offset === undefined) return;
    setEventsLoadingMore(true);
    setEventsError(false);
    try {
      const loaded = await applicationsClient.listApplicationEvents(
        selectedApplication.id,
        { limit: 25, offset },
      );
      setEventsPage((current) => {
        if (!current) return loaded;
        const seen = new Set(current.events.map(({ id }) => id));
        return {
          ...loaded,
          events: [
            ...current.events,
            ...loaded.events.filter(({ id }) => !seen.has(id)),
          ],
          offset: 0,
          returned:
            current.events.length +
            loaded.events.filter(({ id }) => !seen.has(id)).length,
        };
      });
    } catch {
      setEventsError(true);
    } finally {
      setEventsLoadingMore(false);
    }
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

  function removeApplication(reason: string) {
    if (!deletionTarget) return;
    const removing = deletionTarget;
    setDeleting(true);
    setDeleteError(undefined);
    void applicationsClient
      .deleteApplication({ applicationId: removing.id, reason })
      .then(() => {
        const removeDeleted = (current: ApplicationRecord[]) =>
          current.filter(({ id }) => id !== removing.id);
        setApplications((current) =>
          current ? removeDeleted(current) : current,
        );
        updateCachedApplications(applicationsClient, removeDeleted);
        setDeletionTarget(undefined);
        setNotice(`${removing.companyName} was removed.`);
        setDeleting(false);
        void refreshAttention();
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
        const includeSaved = (current: ApplicationRecord[]) => [
          saved,
          ...current.filter(({ id }) => id !== saved.id),
        ];
        setApplications((current) => includeSaved(current ?? []));
        updateCachedApplications(applicationsClient, includeSaved);
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
        void refreshAttention();
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
          const includeLatest = (current: ApplicationRecord[]) =>
            current.map((application) =>
              application.id === latest.id ? latest : application,
            );
          setApplications((current) =>
            current ? includeLatest(current) : current,
          );
          updateCachedApplications(applicationsClient, includeLatest);
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
              caught.code === "invalid_application_reference" ||
              caught.code === "invalid_outlook_graph_connection_assignment")
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
          attentionError={attentionError}
          attentionPage={attentionPage}
          loadError={loadError}
          onAdd={beginCreate}
          onDocuments={() => navigate("documents")}
          onOpen={openApplication}
          onViewAll={() => navigate("applications")}
          referenceValues={referenceValues ?? []}
          session={session}
        />
      ) : (
        <ApplicationsPage
          applications={applications}
          loadError={loadError}
          onAdd={beginCreate}
          onOpen={openApplication}
          onReviewDeleted={() => {
            setNotice(undefined);
            setReviewingDeleted(true);
          }}
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
          evidence={evidence}
          evidenceError={evidenceError}
          evidenceLoading={evidenceLoading}
          events={eventsPage?.events}
          eventsError={eventsError}
          eventsLoading={eventsLoading}
          eventsLoadingMore={eventsLoadingMore}
          eventsNextOffset={eventsPage?.nextOffset ?? null}
          onAddActivity={addActivity}
          onClose={closeApplication}
          onDelete={() => beginDelete(selectedApplication)}
          onEdit={() => {
            const application = selectedApplication;
            closeApplication();
            beginEdit(application);
          }}
          onLoadMoreEvents={loadMoreEvents}
          onVerifyProvenance={verifyProvenance}
          provenance={provenance}
          provenanceError={provenanceError}
          provenanceLoading={provenanceLoading}
          provenanceVerifyingId={provenanceVerifyingId}
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
          outlookConnections={outlookConnections ?? []}
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
        <Suspense
          fallback={
            <p className="tracker-loading" role="status">
              Opening duplicate review…
            </p>
          }
        >
          <DuplicateApplicationsDialog
            applicationsClient={applicationsClient}
            onClose={() => setReviewingDuplicates(false)}
            onMerged={(survivor, sourceApplicationId) => {
              const includeSurvivor = (current: ApplicationRecord[]) => [
                survivor,
                ...current.filter(
                  ({ id }) => id !== survivor.id && id !== sourceApplicationId,
                ),
              ];
              setApplications((current) => includeSurvivor(current ?? []));
              updateCachedApplications(applicationsClient, includeSurvivor);
              setReviewingDuplicates(false);
              void refreshAttention();
              setNotice(
                `${survivor.companyName} duplicates were merged safely.`,
              );
            }}
          />
        </Suspense>
      )}
      {reviewingDeleted && (
        <Suspense
          fallback={
            <p className="tracker-loading" role="status">
              Opening deleted applications…
            </p>
          }
        >
          <DeletedApplicationsDialog
            applicationsClient={applicationsClient}
            onClose={() => setReviewingDeleted(false)}
            onRecovered={(recovered) => {
              const recoveredIds = new Set(recovered.map(({ id }) => id));
              const includeRecovered = (current: ApplicationRecord[]) => [
                ...recovered,
                ...current.filter(({ id }) => !recoveredIds.has(id)),
              ];
              setApplications((current) => includeRecovered(current ?? []));
              updateCachedApplications(applicationsClient, includeRecovered);
              setReviewingDeleted(false);
              setNotice(
                recovered.length === 1
                  ? `${recovered[0]?.companyName ?? "Application"} was restored.`
                  : "The merge was recovered and both applications are active.",
              );
              void refreshAttention();
            }}
          />
        </Suspense>
      )}
    </main>
  );
}

function DashboardView({
  applications,
  attentionError,
  attentionPage,
  loadError,
  onAdd,
  onDocuments,
  onOpen,
  onViewAll,
  referenceValues,
  session,
}: {
  applications: ApplicationRecord[] | undefined;
  attentionError: boolean;
  attentionPage: ApplicationAttentionPage | undefined;
  loadError: boolean;
  onAdd: () => void;
  onDocuments: () => void;
  onOpen: (application: ApplicationRecord) => void;
  onViewAll: () => void;
  referenceValues: ReferenceValue[];
  session: AuthenticatedSession;
}) {
  const total = applications?.length ?? 0;
  const applied =
    applications?.filter(({ appliedOn }) => appliedOn !== null) ?? [];
  const count = (statusId: string) =>
    applied.filter((application) => application.statusId === statusId).length;
  const open =
    applications?.filter(({ statusIsTerminal }) => !statusIsTerminal).length ??
    0;
  const livePipeline = applied.filter(
    ({ statusIsTerminal }) => !statusIsTerminal,
  ).length;
  const closedPipeline = applied.filter(
    ({ statusIsTerminal }) => statusIsTerminal,
  ).length;
  const referencedStatusIds = new Set(applied.map(({ statusId }) => statusId));
  const statusCounts = referenceValues.filter(
    ({ category, id, isActive }) =>
      category === "status" && (isActive || referencedStatusIds.has(id)),
  );
  const activeFocus = nextActionApplications(applications ?? []);
  const today = new Date();
  const todayKey = localDateKey(today);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = localDateKey(weekEnd);
  const thisWeek = activeFocus.filter(
    ({ nextActionDue }) =>
      nextActionDue !== null &&
      nextActionDue > todayKey &&
      nextActionDue <= weekEndKey,
  );
  const quietCutoff = new Date(today);
  quietCutoff.setDate(quietCutoff.getDate() - 21);
  const quiet = (applications ?? [])
    .filter(
      ({ statusIsTerminal, updatedAt }) =>
        !statusIsTerminal && new Date(updatedAt) < quietCutoff,
    )
    .sort(
      (left, right) =>
        new Date(left.updatedAt).getTime() -
        new Date(right.updatedAt).getTime(),
    );
  const shortlist = (applications ?? [])
    .filter(
      ({ appliedOn, statusIsTerminal }) =>
        appliedOn === null && !statusIsTerminal,
    )
    .sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1))
    .slice(0, 2);
  const dayLabel = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(today);
  const attentionSummary = attentionError
    ? "The attention queue could not be loaded."
    : attentionPage
      ? `${attentionPage.summary.queuedApplications} of ${attentionPage.summary.totalApplications} applications need attention.`
      : "Building the attention queue.";
  const weekSummary =
    thisWeek.length === 0
      ? "No other actions are due in the next seven days."
      : `${thisWeek.length} more ${
          thisWeek.length === 1 ? "action is" : "actions are"
        } due in the next seven days.`;

  return (
    <div className="workspace-page dashboard-page">
      <section className="today-heading" aria-labelledby="page-title">
        <div>
          <span className="eyebrow">
            {session.workspace.name} · {dayLabel}
          </span>
          <h1 id="page-title">Today</h1>
          <p>
            {attentionSummary} {weekSummary}
          </p>
        </div>
        <div className="tracker-page-actions">
          <button
            className="tracker-button tracker-button-primary"
            type="button"
            onClick={onAdd}
          >
            <span aria-hidden="true">+</span>
            Log application
          </button>
        </div>
      </section>

      {loadError && <ApplicationLoadError />}
      {!applications && !loadError && (
        <p className="tracker-loading">Opening your workspace…</p>
      )}
      {applications && (
        <>
          <div className="today-layout">
            <div className="today-primary">
              <AttentionQueueSection
                error={attentionError}
                page={attentionPage}
                onOpen={onOpen}
                onViewAll={onViewAll}
              />
              <TodayActionSection
                applications={thisWeek}
                empty="The next seven days are clear."
                eyebrow="Next seven days"
                onOpen={onOpen}
                title="Coming up"
              />

              <section
                className="today-card today-pipeline"
                aria-labelledby="pipeline-title"
              >
                <header className="today-card-heading">
                  <div>
                    <span className="eyebrow">Application pipeline</span>
                    <h2 id="pipeline-title">Pipeline health</h2>
                  </div>
                  <button
                    className="tracker-text-button"
                    type="button"
                    onClick={onViewAll}
                  >
                    Open pipeline <span aria-hidden="true">→</span>
                  </button>
                </header>
                <p className="today-pipeline-summary">
                  <strong>{livePipeline} live</strong>
                  <span>·</span>
                  <span>{closedPipeline} closed</span>
                  <span>·</span>
                  <span>{applied.length} applied</span>
                </p>
                {applied.length === 0 ? (
                  <div className="today-empty">
                    <span aria-hidden="true">◎</span>
                    <p>Applied opportunities will build your pipeline here.</p>
                  </div>
                ) : (
                  <>
                    <div
                      className="today-pipeline-track"
                      aria-label={`${applied.length} applications by stage`}
                    >
                      {statusCounts
                        .filter((status) => count(status.id) > 0)
                        .map((status) => (
                          <span
                            key={status.id}
                            data-terminal={status.isTerminal || undefined}
                            style={{ flexGrow: count(status.id) }}
                            title={`${status.label}: ${count(status.id)}`}
                          >
                            {count(status.id)}
                          </span>
                        ))}
                    </div>
                    <ul className="today-pipeline-legend">
                      {statusCounts
                        .filter((status) => count(status.id) > 0)
                        .map((status) => (
                          <li key={status.id}>
                            <span
                              data-terminal={status.isTerminal || undefined}
                              aria-hidden="true"
                            />
                            {status.label}
                            <strong>{count(status.id)}</strong>
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </section>
            </div>

            <aside className="today-secondary" aria-label="Today summary">
              <section
                className="today-card today-quiet"
                aria-labelledby="quiet-title"
              >
                <header className="today-card-heading">
                  <div>
                    <span className="eyebrow">No movement for 21 days</span>
                    <h2 id="quiet-title">Gone quiet</h2>
                  </div>
                  <span>{quiet.length}</span>
                </header>
                {quiet.length === 0 ? (
                  <div className="today-empty">
                    <span aria-hidden="true">◎</span>
                    <p>No live records have gone quiet.</p>
                  </div>
                ) : (
                  <ol className="today-quiet-list">
                    {quiet.slice(0, 5).map((application) => (
                      <li key={application.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(application)}
                        >
                          <span>
                            <strong>{application.companyName}</strong>
                            <small>{application.roleTitle}</small>
                          </span>
                          <span>
                            <small>
                              {applicationReference(application.id)}
                            </small>
                            <time dateTime={application.updatedAt}>
                              {daysSince(application.updatedAt, today)}d idle
                            </time>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section
                className="today-card today-shortlist"
                aria-labelledby="shortlist-title"
              >
                <header className="today-card-heading">
                  <div>
                    <span className="eyebrow">Opportunities</span>
                    <h2 id="shortlist-title">Shortlist</h2>
                  </div>
                </header>
                {shortlist.length === 0 ? (
                  <div className="today-empty">
                    <span aria-hidden="true">◎</span>
                    <p>No opportunities are waiting for review.</p>
                  </div>
                ) : (
                  <ol className="today-shortlist-list">
                    {shortlist.map((application) => (
                      <li key={application.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(application)}
                        >
                          <span>
                            <strong>{application.roleTitle}</strong>
                            <small>{application.companyName}</small>
                          </span>
                          <span>
                            <strong
                              aria-label={`${application.rating ?? 0} out of 5 stars`}
                            >
                              {application.rating === null
                                ? "Unrated"
                                : "★".repeat(application.rating)}
                            </strong>
                            <small>
                              {application.salary ?? "Salary not listed"}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section
                className="today-card today-shortcuts"
                aria-labelledby="shortcuts-title"
              >
                <header className="today-card-heading">
                  <div>
                    <span className="eyebrow">Quick access</span>
                    <h2 id="shortcuts-title">Shortcuts</h2>
                  </div>
                </header>
                <div>
                  <button type="button" onClick={onAdd}>
                    Log application
                  </button>
                  <button type="button" onClick={onDocuments}>
                    Upload document
                  </button>
                  <button type="button" onClick={onViewAll}>
                    Review pipeline
                  </button>
                </div>
                <p>
                  {open} open · {total - applied.length} saved ·{" "}
                  {
                    activeFocus.filter(
                      ({ nextActionDue }) => nextActionDue === null,
                    ).length
                  }{" "}
                  undated
                </p>
              </section>
            </aside>
          </div>

          <section className="tracker-recent" aria-labelledby="recent-title">
            <div className="tracker-section-heading">
              <div>
                <span className="eyebrow">Latest movement</span>
                <h2 id="recent-title">Recent movement</h2>
              </div>
              <button
                className="tracker-text-button"
                type="button"
                onClick={onViewAll}
              >
                Open pipeline <span aria-hidden="true">→</span>
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

function TodayActionSection({
  applications,
  empty,
  eyebrow,
  onOpen,
  title,
  tone,
}: {
  applications: ApplicationRecord[];
  empty: string;
  eyebrow: string;
  onOpen: (application: ApplicationRecord) => void;
  title: string;
  tone?: "attention";
}) {
  const headingId = `today-${title.toLocaleLowerCase().replaceAll(" ", "-")}`;

  return (
    <section
      className={`today-card today-actions${tone ? ` ${tone}` : ""}`}
      aria-labelledby={headingId}
    >
      <header className="today-card-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={headingId}>{title}</h2>
        </div>
        <span>{applications.length}</span>
      </header>
      {applications.length === 0 ? (
        <div className="today-empty">
          <span aria-hidden="true">◎</span>
          <p>{empty}</p>
        </div>
      ) : (
        <ol className="today-action-list">
          {applications.slice(0, 6).map((application) => {
            const due = dueLabel(application.nextActionDue);
            return (
              <li key={application.id}>
                <button type="button" onClick={() => onOpen(application)}>
                  <span className="today-action-copy">
                    <strong>{application.nextAction}</strong>
                    <small>
                      <span>{applicationReference(application.id)}</span>
                      {application.companyName} · {application.roleTitle}
                    </small>
                  </span>
                  <span className={`tracker-due-label ${due.tone}`}>
                    {due.text}
                  </span>
                  <span className="today-open-label">
                    Open <span aria-hidden="true">→</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function AttentionQueueSection({
  error,
  onOpen,
  onViewAll,
  page,
}: {
  error: boolean;
  onOpen: (application: ApplicationRecord) => void;
  onViewAll: () => void;
  page: ApplicationAttentionPage | undefined;
}) {
  const applications = page?.applications ?? [];
  const visibleApplications = applications.slice(0, 3);
  return (
    <section
      className="today-card today-actions attention"
      aria-labelledby="today-needs-attention"
    >
      <header className="today-card-heading">
        <div>
          <span className="eyebrow">Reconciliation and data quality</span>
          <h2 id="today-needs-attention">Needs attention</h2>
        </div>
        <span>{page?.summary.queuedApplications ?? 0}</span>
      </header>
      {error ? (
        <div className="today-empty" role="alert">
          <span aria-hidden="true">!</span>
          <p>The attention queue could not be loaded. Reload to try again.</p>
        </div>
      ) : !page ? (
        <p className="tracker-loading" role="status">
          Building the attention queue…
        </p>
      ) : applications.length === 0 ? (
        <div className="today-empty">
          <span aria-hidden="true">◎</span>
          <p>No application currently matches an attention reason.</p>
        </div>
      ) : (
        <>
          <ol className="today-action-list tracker-attention-queue">
            {visibleApplications.map(({ application, reasons }) => (
              <li key={application.id}>
                <button type="button" onClick={() => onOpen(application)}>
                  <span className="today-action-copy">
                    <strong>
                      {application.nextAction ?? application.roleTitle}
                    </strong>
                    <small>
                      <span>{applicationReference(application.id)}</span>
                      {application.companyName} · {application.roleTitle}
                    </small>
                    <small className="tracker-attention-reasons">
                      {attentionReasonSummary(
                        reasons.map(({ label }) => label),
                      )}
                    </small>
                  </span>
                  <span className="tracker-due-label due">
                    {reasons.length}{" "}
                    {reasons.length === 1 ? "reason" : "reasons"}
                  </span>
                  <span className="today-open-label">
                    Open <span aria-hidden="true">→</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {page.summary.queuedApplications > visibleApplications.length && (
            <footer className="today-card-footer">
              <span>
                Showing {visibleApplications.length} of{" "}
                {page.summary.queuedApplications}
              </span>
              <button
                className="tracker-text-button"
                type="button"
                onClick={onViewAll}
              >
                View all in register <span aria-hidden="true">→</span>
              </button>
            </footer>
          )}
        </>
      )}
    </section>
  );
}

function attentionReasonSummary(labels: string[]): string {
  const visible = labels.slice(0, 2);
  const remaining = labels.length - visible.length;
  return remaining > 0
    ? `${visible.join(" · ")} · +${String(remaining)} more`
    : visible.join(" · ");
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysSince(value: string, relativeTo: Date): number {
  return Math.max(
    0,
    Math.floor((relativeTo.getTime() - new Date(value).getTime()) / 86_400_000),
  );
}

function ApplicationsPage({
  applications,
  loadError,
  onAdd,
  onOpen,
  onReviewDeleted,
  onReviewDuplicates,
  page,
}: {
  applications: ApplicationRecord[] | undefined;
  loadError: boolean;
  onAdd: () => void;
  onOpen: (application: ApplicationRecord) => void;
  onReviewDeleted: () => void;
  onReviewDuplicates: () => void;
  page: "applications" | "opportunities";
}) {
  const maintenanceActionsRef = useRef<HTMLDivElement>(null);
  const maintenanceTriggerRef = useRef<HTMLButtonElement>(null);
  const [maintenanceActionsOpen, setMaintenanceActionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
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
    const query = deferredSearch.trim().toLocaleLowerCase();
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
  }, [deferredSearch, visibleApplications]);
  const filtered = useMemo(
    () => filterApplicationsByColumns(searchResults, columnFilters),
    [columnFilters, searchResults],
  );
  const hasColumnFilters = Object.values(columnFilters).some(
    (selected) => selected !== undefined && selected.length > 0,
  );
  const pageName = page === "applications" ? "Applications" : "Opportunities";
  const pageNameLower = pageName.toLocaleLowerCase();
  const appliedCount =
    applications?.filter(({ appliedOn }) => appliedOn !== null).length ?? 0;
  const liveApplicationCount =
    applications?.filter(
      ({ appliedOn, statusIsTerminal }) =>
        appliedOn !== null && !statusIsTerminal,
    ).length ?? 0;
  const closedApplicationCount =
    applications?.filter(
      ({ appliedOn, statusIsTerminal }) =>
        appliedOn !== null && statusIsTerminal,
    ).length ?? 0;
  const shortlistCount = (applications?.length ?? 0) - appliedCount;
  const applicationStages = useMemo(() => {
    const stages = new Map<string, { count: number; label: string }>();
    for (const application of visibleApplications) {
      const current = stages.get(application.statusId);
      stages.set(application.statusId, {
        count: (current?.count ?? 0) + 1,
        label: application.status,
      });
    }
    return [...stages.entries()].sort((left, right) =>
      left[1].label.localeCompare(right[1].label),
    );
  }, [visibleApplications]);
  const selectedStages = columnFilters.status ?? [];

  useEffect(() => {
    if (!maintenanceActionsOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !maintenanceActionsRef.current?.contains(event.target)
      ) {
        setMaintenanceActionsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMaintenanceActionsOpen(false);
      maintenanceTriggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [maintenanceActionsOpen]);

  function runMaintenanceAction(action: () => void) {
    setMaintenanceActionsOpen(false);
    action();
  }

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
            className="tracker-button tracker-button-primary"
            type="button"
            onClick={onAdd}
          >
            <span aria-hidden="true">+</span>
            Log application
          </button>
          <div
            ref={maintenanceActionsRef}
            className="tracker-maintenance-actions"
          >
            <button
              ref={maintenanceTriggerRef}
              className="tracker-button tracker-button-quiet"
              type="button"
              aria-controls="application-maintenance-actions"
              aria-expanded={maintenanceActionsOpen}
              onFocus={() => {
                void loadDeletedApplicationsDialog();
                void loadDuplicateApplicationsDialog();
              }}
              onClick={() => setMaintenanceActionsOpen((current) => !current)}
              onPointerEnter={() => {
                void loadDeletedApplicationsDialog();
                void loadDuplicateApplicationsDialog();
              }}
            >
              <span aria-hidden="true">•••</span>
              More actions
            </button>
            {maintenanceActionsOpen && (
              <div
                id="application-maintenance-actions"
                className="tracker-maintenance-menu"
                role="group"
                aria-label="Application maintenance"
              >
                <button
                  type="button"
                  onFocus={() => void loadDuplicateApplicationsDialog()}
                  onClick={() => runMaintenanceAction(onReviewDuplicates)}
                  onPointerDown={() => void loadDuplicateApplicationsDialog()}
                  onPointerEnter={() => void loadDuplicateApplicationsDialog()}
                >
                  Review duplicates
                </button>
                <button
                  type="button"
                  onFocus={() => void loadDeletedApplicationsDialog()}
                  onClick={() => runMaintenanceAction(onReviewDeleted)}
                  onPointerDown={() => void loadDeletedApplicationsDialog()}
                  onPointerEnter={() => void loadDeletedApplicationsDialog()}
                >
                  Deleted applications
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {page === "applications" && applicationStages.length > 0 && (
        <nav
          className="tracker-stage-strip"
          aria-label="Filter applications by stage"
        >
          <button
            type="button"
            aria-pressed={selectedStages.length === 0}
            onClick={() =>
              setColumnFilters((current) => {
                const next = { ...current };
                delete next.status;
                return next;
              })
            }
          >
            All <span>{visibleApplications.length}</span>
          </button>
          {applicationStages.map(([statusId, stage]) => (
            <button
              key={statusId}
              type="button"
              aria-pressed={selectedStages.includes(statusId)}
              onClick={() =>
                setColumnFilters((current) => ({
                  ...current,
                  status: current.status?.includes(statusId)
                    ? current.status.filter((value) => value !== statusId)
                    : [statusId],
                }))
              }
            >
              {stage.label} <span>{stage.count}</span>
            </button>
          ))}
        </nav>
      )}

      <div
        className={`tracker-register-context ${page}`}
        aria-label={`${pageName} purpose`}
      >
        <span className="eyebrow">
          {page === "applications" ? "Pipeline" : "Shortlist"}
        </span>
        {page === "applications" ? (
          <p>
            <strong>{liveApplicationCount} live</strong>
            <span>·</span>
            <span>{closedApplicationCount} closed</span>
            <span>·</span>
            <span>{appliedCount} applied in total</span>
          </p>
        ) : (
          <p>
            <strong>{shortlistCount} still to consider</strong>
            <span>·</span>
            <span>{appliedCount} already in your pipeline</span>
            <span>·</span>
            <span>Roles found and judged, before you apply</span>
          </p>
        )}
      </div>

      <div className="tracker-filter-bar">
        <div className="tracker-search">
          <span aria-hidden="true">⌕</span>
          <label className="sr-only" htmlFor="application-search">
            Search {pageNameLower}
          </label>
          <input
            id="application-search"
            placeholder={`Search ${pageNameLower}…`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span
          className="tracker-result-count"
          aria-busy={search !== deferredSearch}
          aria-live="polite"
        >
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
          variant={page}
        />
      )}
    </div>
  );
}
