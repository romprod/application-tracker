import { useEffect, useRef, useState } from "react";

import type {
  ApplicationMergeRecoveryPreview,
  ApplicationRecord,
  ApplicationRestorePreview,
  ApplicationsClient,
  DeletedApplicationRecord,
  DeletedApplicationsPage,
} from "./applications_client";
import { applicationReference, formatDate } from "./application_table";

type RecoveryPreview =
  ApplicationMergeRecoveryPreview | ApplicationRestorePreview;

function isMergePreview(
  preview: RecoveryPreview,
): preview is ApplicationMergeRecoveryPreview {
  return "safeToRecover" in preview;
}

export function DeletedApplicationsDialog({
  applicationsClient,
  onClose,
  onRecovered,
}: {
  applicationsClient: ApplicationsClient;
  onClose: () => void;
  onRecovered: (applications: ApplicationRecord[]) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const previewRequestIdRef = useRef(0);
  const [page, setPage] = useState<DeletedApplicationsPage>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<DeletedApplicationRecord>();
  const [preview, setPreview] = useState<RecoveryPreview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
    let active = true;
    void applicationsClient
      .listDeletedApplications({ limit: 25, offset: 0 })
      .then((loaded) => {
        if (active) setPage(loaded);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationsClient]);

  function inspect(application: DeletedApplicationRecord) {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setSelected(application);
    setPreview(undefined);
    setPreviewError(false);
    setRecoveryError(false);
    setPreviewLoading(true);
    const operation = application.merge
      ? applicationsClient.recoverApplicationMerge({
          mode: "preview",
          sourceApplicationId: application.application.id,
        })
      : applicationsClient.previewApplicationRestore(
          application.application.id,
        );
    void operation
      .then((loaded) => {
        if (previewRequestIdRef.current !== requestId) return;
        if ("recovery" in loaded) return;
        setPreview(loaded);
      })
      .catch(() => {
        if (previewRequestIdRef.current === requestId) setPreviewError(true);
      })
      .finally(() => {
        if (previewRequestIdRef.current === requestId) {
          setPreviewLoading(false);
        }
      });
  }

  function recover() {
    if (!selected || !preview || recovering) return;
    setRecovering(true);
    setRecoveryError(false);
    const operation = isMergePreview(preview)
      ? preview.safeToRecover && preview.target
        ? applicationsClient.recoverApplicationMerge({
            confirm: true,
            expectedSourceUpdatedAt: preview.source.updatedAt,
            expectedTargetUpdatedAt: preview.target.updatedAt,
            mode: "apply",
            sourceApplicationId: preview.source.id,
          })
        : undefined
      : preview.safeToRestore
        ? applicationsClient.restoreApplication({
            applicationId: preview.application.id,
            confirm: true,
            expectedDeletedAt: preview.deletion.deletedAt,
            expectedUpdatedAt: preview.application.updatedAt,
          })
        : undefined;
    if (!operation) {
      setRecovering(false);
      return;
    }
    void operation
      .then((result) => {
        if ("recovery" in result) {
          onRecovered([result.source, result.target]);
        } else if ("restoration" in result) {
          onRecovered([result.application]);
        }
      })
      .catch(() => {
        setRecoveryError(true);
        void inspect(selected);
      })
      .finally(() => setRecovering(false));
  }

  function loadMore() {
    if (page?.nextOffset === null || page?.nextOffset === undefined) return;
    setLoadingMore(true);
    setLoadError(false);
    void applicationsClient
      .listDeletedApplications({ limit: 25, offset: page.nextOffset })
      .then((next) =>
        setPage((current) => ({
          ...next,
          applications: [
            ...(current?.applications ?? []),
            ...next.applications,
          ],
          offset: 0,
          returned: (current?.returned ?? 0) + next.returned,
        })),
      )
      .catch(() => setLoadError(true))
      .finally(() => setLoadingMore(false));
  }

  const safe = preview
    ? isMergePreview(preview)
      ? preview.safeToRecover
      : preview.safeToRestore
    : false;

  return (
    <div
      className="tracker-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !recovering) onClose();
      }}
    >
      <section
        ref={dialogRef}
        aria-busy={loading || previewLoading || recovering}
        aria-labelledby="deleted-applications-title"
        aria-modal="true"
        className="tracker-modal deleted-applications-modal"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !recovering) onClose();
        }}
        role="dialog"
        tabIndex={-1}
      >
        <header className="tracker-modal-header">
          <div>
            <span className="eyebrow">Recovery ledger</span>
            <h2 id="deleted-applications-title">Deleted applications</h2>
            <p>Review immutable deletion details before restoring a record.</p>
          </div>
          <button
            aria-label="Close deleted applications"
            className="tracker-icon-button"
            disabled={recovering}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="deleted-applications-layout">
          <section aria-label="Deleted application list">
            {loading ? (
              <p className="tracker-loading" role="status">
                Loading deleted applications…
              </p>
            ) : loadError && !page ? (
              <p className="form-error" role="alert">
                Deleted applications could not be loaded.
              </p>
            ) : page?.applications.length === 0 ? (
              <p className="tracker-empty-copy">No applications are deleted.</p>
            ) : (
              <ol className="deleted-application-list">
                {page?.applications.map((item) => (
                  <li key={item.id}>
                    <button
                      aria-pressed={selected?.id === item.id}
                      onClick={() => inspect(item)}
                      type="button"
                    >
                      <span>
                        <strong>{item.application.companyName}</strong>
                        <small>{item.application.roleTitle}</small>
                      </span>
                      <span>
                        <small>
                          {applicationReference(item.application.id)}
                        </small>
                        <time dateTime={item.deletedAt}>
                          {formatDate(item.deletedAt)}
                        </time>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {page?.nextOffset !== null && page?.nextOffset !== undefined && (
              <button
                className="tracker-button tracker-button-quiet"
                disabled={loadingMore}
                onClick={loadMore}
                type="button"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </section>
          <section className="deleted-application-preview" aria-live="polite">
            {!selected ? (
              <p className="tracker-empty-copy">
                Select a deletion to inspect its recovery proof.
              </p>
            ) : (
              <>
                <span className="eyebrow">
                  {selected.merge ? "Merge deletion" : "Manual deletion"}
                </span>
                <h3>{selected.application.companyName}</h3>
                <p>{selected.reason}</p>
                <dl>
                  <div>
                    <dt>Deleted by</dt>
                    <dd>{selected.actorDisplayName}</dd>
                  </div>
                  <div>
                    <dt>Deleted</dt>
                    <dd>{formatDate(selected.deletedAt)}</dd>
                  </div>
                  {selected.merge && (
                    <div>
                      <dt>Merged into</dt>
                      <dd>
                        {selected.merge.targetCompanyName} ·{" "}
                        {selected.merge.targetRoleTitle}
                      </dd>
                    </div>
                  )}
                </dl>
                {previewLoading && (
                  <p className="tracker-loading" role="status">
                    Checking recovery safety…
                  </p>
                )}
                {previewError && (
                  <p className="form-error" role="alert">
                    Recovery preview could not be loaded.
                  </p>
                )}
                {preview && (
                  <div className="deleted-recovery-result">
                    <strong>
                      {safe ? "Safe to recover" : "Recovery blocked"}
                    </strong>
                    {preview.conflicts.length > 0 && (
                      <ul>
                        {preview.conflicts.map((conflict, index) => (
                          <li
                            key={`${conflict.code}-${conflict.recordId ?? index}`}
                          >
                            {conflict.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!isMergePreview(preview) && (
                      <p>
                        {preview.relationships.emailEvidence} emails ·{" "}
                        {preview.relationships.jobPostings} postings ·{" "}
                        {preview.relationships.documents} documents
                      </p>
                    )}
                  </div>
                )}
                {recoveryError && (
                  <p className="form-error" role="alert">
                    The record changed during recovery. Review the new preview.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
        <footer className="tracker-modal-footer">
          <p>Deletion and merge history remains immutable after recovery.</p>
          <div>
            <button
              className="tracker-button tracker-button-quiet"
              disabled={recovering}
              onClick={onClose}
              type="button"
            >
              Close
            </button>
            <button
              className="tracker-button tracker-button-primary"
              disabled={!safe || recovering}
              onClick={recover}
              type="button"
            >
              {recovering
                ? "Recovering…"
                : selected?.merge
                  ? "Recover merge"
                  : "Restore application"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
