import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  ApplicationsClientError,
  type ApplicationDuplicateAudit,
  type ApplicationDuplicateCandidate,
  type ApplicationMergeField,
  type ApplicationMergePreview,
  type ApplicationMergeResolutions,
  type ApplicationRecord,
  type ApplicationsClient,
} from "./applications_client";

const pageSize = 25;

const fieldLabels: Record<ApplicationMergeField, string> = {
  agency: "Agency",
  appliedOn: "Applied date",
  companyName: "End company",
  location: "Location",
  nextAction: "Next action",
  nextActionDue: "Next-action date",
  notes: "Notes",
  rating: "Rating",
  roleTypeId: "Role type",
  roleTitle: "Role",
  salary: "Salary",
  sourceId: "Source",
  sourceUrl: "Source URL",
  statusId: "Status",
  workArrangement: "Work arrangement",
};

const reasonLabels: Record<
  ApplicationDuplicateCandidate["reasons"][number]["kind"],
  string
> = {
  agency: "same agency",
  applied_date: "nearby applied date",
  canonical_url: "same canonical URL",
  company_title: "same company and role",
  contact: "shared contact",
  email_message_id: "same email Message-ID",
  location: "same location",
  posting_id: "same posting ID",
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function handleDialogKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onClose: () => void,
  closeDisabled: boolean,
) {
  if (event.key === "Escape" && !closeDisabled) {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = focusableElements(event.currentTarget);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function shortId(applicationId: string): string {
  return applicationId.slice(0, 8);
}

function applicationLabel(application: ApplicationRecord): string {
  return `${application.companyName} · ${application.roleTitle}`;
}

function conflictValue(
  field: ApplicationMergeField,
  value: number | string | null,
  application: ApplicationRecord,
): string {
  if (value === null) return "Not set";
  if (field === "statusId") return application.status;
  if (field === "sourceId") return application.source ?? "Not set";
  if (field === "roleTypeId") return application.roleType ?? "Not set";
  if (field === "workArrangement") {
    return String(value).replace(/^./, (letter) => letter.toUpperCase());
  }
  if (field === "rating") return `${String(value)} out of 5`;
  return String(value);
}

export function DuplicateApplicationsDialog({
  applicationsClient,
  onClose,
  onMerged,
}: {
  applicationsClient: ApplicationsClient;
  onClose: () => void;
  onMerged: (survivor: ApplicationRecord, sourceApplicationId: string) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [auditResult, setAuditResult] = useState<{
    audit?: ApplicationDuplicateAudit;
    error: boolean;
    offset: number;
  }>();
  const [candidate, setCandidate] = useState<ApplicationDuplicateCandidate>();
  const [sourceApplicationId, setSourceApplicationId] = useState<string>();
  const [targetApplicationId, setTargetApplicationId] = useState<string>();
  const [preview, setPreview] = useState<ApplicationMergePreview>();
  const [resolutions, setResolutions] = useState<ApplicationMergeResolutions>({
    fields: {},
  });
  const [previewDirty, setPreviewDirty] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string>();
  const [merging, setMerging] = useState(false);
  const audit = auditResult?.offset === offset ? auditResult.audit : undefined;
  const auditError =
    auditResult?.offset === offset && auditResult.error === true;
  const auditLoading = auditResult?.offset !== offset;

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current
      ?.querySelector<HTMLElement>(".tracker-duplicate-close")
      ?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    void applicationsClient
      .auditDuplicateApplications({ limit: pageSize, offset })
      .then((result) => {
        if (!active) return;
        setAuditResult({ audit: result, error: false, offset });
      })
      .catch(() => {
        if (!active) return;
        setAuditResult({ error: true, offset });
      });
    return () => {
      active = false;
    };
  }, [applicationsClient, offset]);

  function requestPreview(
    selectedCandidate: ApplicationDuplicateCandidate,
    targetId: string,
    nextResolutions: ApplicationMergeResolutions = { fields: {} },
  ) {
    const sourceId = selectedCandidate.applications.find(
      ({ id }) => id !== targetId,
    )?.id;
    if (!sourceId) return;
    setCandidate(selectedCandidate);
    setSourceApplicationId(sourceId);
    setTargetApplicationId(targetId);
    setResolutions(nextResolutions);
    setPreview(undefined);
    setPreviewDirty(false);
    setPreviewLoading(true);
    setMergeError(undefined);
    void applicationsClient
      .mergeApplications({
        mode: "preview",
        resolutions: nextResolutions,
        sourceApplicationId: sourceId,
        targetApplicationId: targetId,
      })
      .then((result) => {
        setPreview(result.preview);
        setPreviewLoading(false);
      })
      .catch(() => {
        setMergeError("The merge preview could not be loaded. Try again.");
        setPreviewLoading(false);
      });
  }

  function selectFieldResolution(
    field: ApplicationMergeField,
    resolution: "source" | "target",
  ) {
    setResolutions((current) => ({
      ...current,
      fields: { ...current.fields, [field]: resolution },
    }));
    setPreviewDirty(true);
    setMergeError(undefined);
  }

  function refreshPreview() {
    if (!candidate || !targetApplicationId) return;
    requestPreview(candidate, targetApplicationId, resolutions);
  }

  function applyMerge() {
    if (
      !preview ||
      !sourceApplicationId ||
      !targetApplicationId ||
      !preview.safeToApply ||
      previewDirty
    ) {
      return;
    }
    setMerging(true);
    setMergeError(undefined);
    void applicationsClient
      .mergeApplications({
        confirm: true,
        expectedSourceUpdatedAt: preview.source.updatedAt,
        expectedTargetUpdatedAt: preview.target.updatedAt,
        mode: "apply",
        resolutions,
        sourceApplicationId,
        targetApplicationId,
      })
      .then((result) => {
        onMerged(result.preview.survivor, sourceApplicationId);
      })
      .catch((caught: unknown) => {
        const code =
          caught instanceof ApplicationsClientError ? caught.code : undefined;
        setMergeError(
          code === "application_merge_conflict"
            ? "One of these records changed. Close this review and start again with the latest data."
            : code === "application_merge_unresolved_conflicts"
              ? "Resolve every conflict and refresh the preview before merging."
              : "The records could not be merged. Nothing was changed.",
        );
        setMerging(false);
      });
  }

  function backToCandidates() {
    if (merging) return;
    setCandidate(undefined);
    setSourceApplicationId(undefined);
    setTargetApplicationId(undefined);
    setPreview(undefined);
    setResolutions({ fields: {} });
    setPreviewDirty(false);
    setMergeError(undefined);
  }

  const allFieldsResolved =
    preview?.fieldConflicts.every(
      ({ field }) => resolutions.fields?.[field] !== undefined,
    ) ?? false;
  const relationshipResolutionRequired =
    preview?.contacts.requiresResolution || preview?.links.requiresResolution;

  return (
    <div className="tracker-modal-backdrop">
      <section
        ref={dialogRef}
        aria-busy={auditLoading || previewLoading || merging}
        aria-describedby="duplicate-dialog-description"
        aria-labelledby="duplicate-dialog-title"
        aria-modal="true"
        className="tracker-modal tracker-duplicate-modal"
        onKeyDown={(event) =>
          handleDialogKeyDown(event, onClose, previewLoading || merging)
        }
        role="dialog"
        tabIndex={-1}
      >
        <header className="tracker-modal-header">
          <div>
            <span className="eyebrow">Ledger maintenance</span>
            <h2 id="duplicate-dialog-title">Review duplicate applications</h2>
            <p id="duplicate-dialog-description">
              Compare deterministic matches, choose the record to keep, and
              preview every change before anything is merged.
            </p>
          </div>
          <button
            aria-label="Close duplicate application review"
            className="tracker-duplicate-close"
            disabled={previewLoading || merging}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        {!candidate ? (
          <div className="tracker-duplicate-content">
            {auditLoading && (
              <p className="tracker-loading" role="status">
                Auditing the workspace…
              </p>
            )}
            {auditError && (
              <div className="form-error" role="alert">
                Duplicate candidates could not be loaded. Close this review and
                try again.
              </div>
            )}
            {!auditLoading && audit?.candidates.length === 0 && (
              <div className="tracker-duplicate-empty">
                <span aria-hidden="true">✓</span>
                <h3>No duplicate candidates found</h3>
                <p>
                  The deterministic audit found no records that need review.
                </p>
              </div>
            )}
            {audit && audit.candidates.length > 0 && (
              <>
                <p className="tracker-duplicate-summary" role="status">
                  Showing {audit.returned} of {audit.total} candidate{" "}
                  {audit.total === 1 ? "pair" : "pairs"}.
                </p>
                <ol className="tracker-duplicate-list">
                  {audit.candidates.map((match) => (
                    <li key={match.applications.map(({ id }) => id).join("-")}>
                      <div className="tracker-duplicate-match-heading">
                        <strong>{match.confidence} match</strong>
                        <ul aria-label="Matching reasons">
                          {match.reasons.map((reason) => (
                            <li key={`${reason.kind}-${reason.detail}`}>
                              {reasonLabels[reason.kind]}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="tracker-duplicate-records">
                        {match.applications.map((application) => (
                          <article key={application.id}>
                            <span>{shortId(application.id)}</span>
                            <h3>{application.companyName}</h3>
                            <p>{application.roleTitle}</p>
                            <dl>
                              <div>
                                <dt>Status</dt>
                                <dd>{application.status}</dd>
                              </div>
                              <div>
                                <dt>Updated</dt>
                                <dd>
                                  {new Date(
                                    application.updatedAt,
                                  ).toLocaleDateString()}
                                </dd>
                              </div>
                            </dl>
                            <button
                              className="tracker-button tracker-button-quiet"
                              onClick={() =>
                                requestPreview(match, application.id)
                              }
                              type="button"
                            >
                              Keep this record
                            </button>
                          </article>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
                <nav
                  aria-label="Duplicate audit pages"
                  className="tracker-duplicate-pagination"
                >
                  <button
                    className="tracker-button tracker-button-quiet"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - pageSize))}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className="tracker-button tracker-button-quiet"
                    disabled={audit.nextOffset === null}
                    onClick={() =>
                      audit.nextOffset !== null && setOffset(audit.nextOffset)
                    }
                    type="button"
                  >
                    Next
                  </button>
                </nav>
              </>
            )}
          </div>
        ) : (
          <div className="tracker-duplicate-content">
            <button
              className="tracker-text-button"
              disabled={previewLoading || merging}
              onClick={backToCandidates}
              type="button"
            >
              ← Back to candidates
            </button>
            {previewLoading && (
              <p className="tracker-loading" role="status">
                Building a read-only merge preview…
              </p>
            )}
            {mergeError && (
              <div className="form-error" role="alert">
                {mergeError}
              </div>
            )}
            {preview && (
              <>
                <section
                  aria-labelledby="merge-direction-title"
                  className="tracker-merge-direction"
                >
                  <span className="eyebrow">Merge direction</span>
                  <h3 id="merge-direction-title">
                    Keep {applicationLabel(preview.target)}
                  </h3>
                  <p>
                    Record {shortId(preview.source.id)} will be marked as merged
                    into {shortId(preview.target.id)}. Its original stage events
                    remain immutable and readable through the merge lineage.
                  </p>
                </section>

                {preview.fieldConflicts.length > 0 && (
                  <section
                    aria-labelledby="merge-conflicts-title"
                    className="tracker-merge-conflicts"
                  >
                    <span className="eyebrow">Decisions required</span>
                    <h3 id="merge-conflicts-title">Resolve field conflicts</h3>
                    <div className="tracker-merge-conflict-grid">
                      {preview.fieldConflicts.map((conflict) => (
                        <fieldset key={conflict.field}>
                          <legend>{fieldLabels[conflict.field]}</legend>
                          <label>
                            <input
                              checked={
                                resolutions.fields?.[conflict.field] ===
                                "target"
                              }
                              name={`merge-${conflict.field}`}
                              onChange={() =>
                                selectFieldResolution(conflict.field, "target")
                              }
                              type="radio"
                            />
                            <span>
                              Keep target
                              <strong>
                                {conflictValue(
                                  conflict.field,
                                  conflict.targetValue,
                                  preview.target,
                                )}
                              </strong>
                            </span>
                          </label>
                          <label>
                            <input
                              checked={
                                resolutions.fields?.[conflict.field] ===
                                "source"
                              }
                              name={`merge-${conflict.field}`}
                              onChange={() =>
                                selectFieldResolution(conflict.field, "source")
                              }
                              type="radio"
                            />
                            <span>
                              Use source
                              <strong>
                                {conflictValue(
                                  conflict.field,
                                  conflict.sourceValue,
                                  preview.source,
                                )}
                              </strong>
                            </span>
                          </label>
                        </fieldset>
                      ))}
                    </div>
                    <button
                      className="tracker-button tracker-button-quiet"
                      disabled={!allFieldsResolved || !previewDirty}
                      onClick={refreshPreview}
                      type="button"
                    >
                      Refresh resolved preview
                    </button>
                  </section>
                )}

                <section
                  aria-labelledby="merge-relationships-title"
                  className="tracker-merge-relationships"
                >
                  <span className="eyebrow">Consolidation</span>
                  <h3 id="merge-relationships-title">
                    Relationships moving to the survivor
                  </h3>
                  <dl>
                    <div>
                      <dt>Contacts</dt>
                      <dd>+{preview.contacts.additions.length}</dd>
                    </div>
                    <div>
                      <dt>Links</dt>
                      <dd>+{preview.links.additions.length}</dd>
                    </div>
                    <div>
                      <dt>Documents</dt>
                      <dd>+{preview.documents.additions.length}</dd>
                    </div>
                    <div>
                      <dt>Postings</dt>
                      <dd>+{preview.jobPostings.additions.length}</dd>
                    </div>
                    <div>
                      <dt>Email evidence</dt>
                      <dd>+{preview.emailEvidence.additions.length}</dd>
                    </div>
                    <div>
                      <dt>Source events retained</dt>
                      <dd>{preview.history.sourceEvents.length}</dd>
                    </div>
                  </dl>
                  {relationshipResolutionRequired && (
                    <div className="form-error" role="alert">
                      The combined contacts or links contain an overlap or
                      exceed the ten-item limit. Use the API or MCP merge tool
                      to select the exact records to retain.
                    </div>
                  )}
                  {preview.informationNotRetained.length > 0 && (
                    <ul className="tracker-merge-unretained">
                      {preview.informationNotRetained.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        <footer className="tracker-modal-footer">
          <p>
            Preview never changes data. Apply rechecks both record versions and
            rolls back the whole merge if any relationship cannot be retained.
          </p>
          <div>
            <button
              className="tracker-button tracker-button-quiet"
              disabled={previewLoading || merging}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            {candidate && preview && (
              <button
                className="tracker-button tracker-button-danger-solid"
                disabled={
                  merging ||
                  previewDirty ||
                  !preview.safeToApply ||
                  relationshipResolutionRequired
                }
                onClick={applyMerge}
                type="button"
              >
                {merging ? "Merging…" : "Confirm merge"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
