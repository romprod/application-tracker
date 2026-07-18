import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type {
  ApplicationEvent,
  ApplicationRecord,
  ApplicationStatus,
  CreateApplicationInput,
  UpdateApplicationInput,
} from "./applications_client";
import {
  StatusChip,
  applicationReference,
  formatDate,
  formatDateTime,
} from "./application_table";
import { dueLabel } from "./application_next_action";

export interface ApplicationFormState {
  appliedOn: string;
  companyName: string;
  location: string;
  nextAction: string;
  nextActionDue: string;
  notes: string;
  roleTitle: string;
  sourceUrl: string;
  status: ApplicationStatus;
}

const emptyApplicationForm: ApplicationFormState = {
  appliedOn: "",
  companyName: "",
  location: "",
  nextAction: "",
  nextActionDue: "",
  notes: "",
  roleTitle: "",
  sourceUrl: "",
  status: "prospect",
};

type ApplicationTextField = Exclude<keyof ApplicationFormState, "status">;

export function applicationInput(
  form: ApplicationFormState,
): CreateApplicationInput {
  const appliedOn = form.appliedOn.trim();
  const location = form.location.trim();
  const nextAction = form.nextAction.trim();
  const nextActionDue = form.nextActionDue.trim();
  const notes = form.notes.trim();
  const sourceUrl = form.sourceUrl.trim();
  return {
    companyName: form.companyName.trim(),
    roleTitle: form.roleTitle.trim(),
    status: form.status,
    ...(appliedOn ? { appliedOn } : {}),
    ...(location ? { location } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(nextActionDue ? { nextActionDue } : {}),
    ...(notes ? { notes } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function applicationUpdateInput(
  form: ApplicationFormState,
): UpdateApplicationInput {
  return {
    appliedOn: form.appliedOn.trim() || null,
    companyName: form.companyName.trim(),
    location: form.location.trim() || null,
    nextAction: form.nextAction.trim() || null,
    nextActionDue: form.nextActionDue.trim() || null,
    notes: form.notes.trim() || null,
    roleTitle: form.roleTitle.trim(),
    sourceUrl: form.sourceUrl.trim() || null,
    status: form.status,
  };
}

function applicationForm(application: ApplicationRecord): ApplicationFormState {
  return {
    appliedOn: application.appliedOn ?? "",
    companyName: application.companyName,
    location: application.location ?? "",
    nextAction: application.nextAction ?? "",
    nextActionDue: application.nextActionDue ?? "",
    notes: application.notes ?? "",
    roleTitle: application.roleTitle,
    sourceUrl: application.sourceUrl ?? "",
    status: application.status,
  };
}

function eventHeading(event: ApplicationEvent): string {
  return event.type === "application_created"
    ? "Application created"
    : `${titleCase(event.fromStatus ?? "")} → ${titleCase(event.toStatus)}`;
}

function eventDetail(event: ApplicationEvent): string {
  return event.type === "application_created"
    ? `Filed in ${titleCase(event.toStatus)}`
    : "Stage changed";
}

function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusSelector: string,
) {
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const initialFocus =
      dialogRef.current?.querySelector<HTMLElement>(initialFocusSelector);
    (initialFocus ?? dialogRef.current)?.focus();
    return () => previousFocus.current?.focus();
  }, [dialogRef, initialFocusSelector]);
}

function handleDialogKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onClose: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
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

export function ApplicationDrawer({
  application,
  events,
  eventsError,
  eventsLoading,
  onClose,
  onDelete,
  onEdit,
}: {
  application: ApplicationRecord;
  events: ApplicationEvent[] | undefined;
  eventsError: boolean;
  eventsLoading: boolean;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const nextActionDue = dueLabel(application.nextActionDue);
  useDialogFocus(drawerRef, ".tracker-drawer-close");
  return (
    <div
      className="tracker-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="tracker-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-detail-title"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        tabIndex={-1}
      >
        <header className="tracker-drawer-topbar">
          <span>{applicationReference(application.id)}</span>
          <div>
            <button
              className="tracker-button tracker-button-quiet"
              type="button"
              onClick={onEdit}
            >
              Edit application
            </button>
            <button
              className="tracker-button tracker-button-danger"
              type="button"
              onClick={onDelete}
            >
              Delete application
            </button>
            <button
              className="tracker-drawer-close"
              type="button"
              aria-label="Close application details"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>
        <div className="tracker-drawer-content">
          <StatusChip status={application.status} />
          <h2 id="application-detail-title">{application.roleTitle}</h2>
          <p className="tracker-drawer-company">{application.companyName}</p>
          <dl className="tracker-drawer-facts">
            <div>
              <dt>Applied</dt>
              <dd>{formatDate(application.appliedOn)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{application.location ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(application.updatedAt)}</dd>
            </div>
          </dl>
          {application.sourceUrl && (
            <a
              className="tracker-source-link"
              href={application.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open source listing <span aria-hidden="true">↗</span>
            </a>
          )}
          {application.nextAction && (
            <section
              className="tracker-next-action-panel"
              aria-labelledby="next-action-title"
            >
              <span aria-hidden="true">◷</span>
              <div>
                <small className={`tracker-due-label ${nextActionDue.tone}`}>
                  {nextActionDue.text}
                </small>
                <h3 id="next-action-title">{application.nextAction}</h3>
                {application.nextActionDue && (
                  <p>{formatDate(application.nextActionDue)}</p>
                )}
              </div>
            </section>
          )}
          <section
            className="tracker-drawer-section"
            aria-labelledby="notes-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>01</span>
              <h3 id="notes-title">Notes</h3>
            </div>
            <p>{application.notes ?? "No notes have been recorded."}</p>
          </section>
          <section
            className="tracker-drawer-section"
            aria-labelledby="history-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>02</span>
              <h3 id="history-title">Stage history</h3>
            </div>
            {eventsLoading && (
              <p className="tracker-loading">Opening history…</p>
            )}
            {eventsError && (
              <p className="tracker-load-error" role="alert">
                History could not be loaded. Try again.
              </p>
            )}
            {events && (
              <ol className="tracker-timeline">
                {events.map((event) => (
                  <li key={event.id}>
                    <span aria-hidden="true" />
                    <div>
                      <strong>{eventHeading(event)}</strong>
                      <small>{eventDetail(event)}</small>
                    </div>
                    <p>
                      <span>{event.actorDisplayName}</span>
                      <time dateTime={event.occurredAt}>
                        {formatDateTime(event.occurredAt)}
                      </time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

export function DeleteApplicationDialog({
  application,
  deleting,
  error,
  onClose,
  onConfirm,
}: {
  application: ApplicationRecord;
  deleting: boolean;
  error: string | undefined;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, ".tracker-delete-cancel");
  const title = `Remove ${application.companyName}?`;

  return (
    <div
      className="tracker-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        aria-busy={deleting}
        aria-describedby="application-delete-description"
        aria-labelledby="application-delete-title"
        aria-modal="true"
        className="tracker-modal tracker-confirm-modal"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        role="dialog"
        tabIndex={-1}
      >
        <header className="tracker-modal-header">
          <div>
            <span className="eyebrow">Remove record</span>
            <h2 id="application-delete-title">{title}</h2>
          </div>
        </header>
        <div className="tracker-confirm-content">
          <span aria-hidden="true">×</span>
          <p id="application-delete-description">
            This removes {application.roleTitle} from the workspace. Its audit
            history remains stored.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="tracker-modal-footer">
          <p>You cannot restore the record from the application.</p>
          <div>
            <button
              className="tracker-button tracker-button-quiet tracker-delete-cancel"
              disabled={deleting}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="tracker-button tracker-button-danger-solid"
              disabled={deleting}
              onClick={onConfirm}
              type="button"
            >
              {deleting ? "Removing…" : "Remove application"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function ApplicationDialog({
  application,
  error,
  mode,
  onClose,
  onSave,
  submitting,
}: {
  application: ApplicationRecord | undefined;
  error: string | undefined;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (form: ApplicationFormState) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<ApplicationFormState>(
    application ? applicationForm(application) : emptyApplicationForm,
  );
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, "#application-company");
  const title = mode === "create" ? "Log an application" : "Edit application";

  function updateText(field: ApplicationTextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div
      className="tracker-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="tracker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-dialog-title"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        tabIndex={-1}
      >
        <header className="tracker-modal-header">
          <div>
            <span className="eyebrow">
              {mode === "create" ? "New opportunity" : "Revise opportunity"}
            </span>
            <h2 id="application-dialog-title">{title}</h2>
          </div>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            disabled={submitting}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(form);
          }}
        >
          <fieldset className="tracker-form-section">
            <legend>
              <span>01</span> Core record
            </legend>
            <div className="tracker-form-grid">
              <div className="field">
                <label htmlFor="application-company">Company</label>
                <input
                  autoComplete="organization"
                  id="application-company"
                  maxLength={160}
                  required
                  value={form.companyName}
                  onChange={(event) =>
                    updateText("companyName", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-role">Role title</label>
                <input
                  autoComplete="off"
                  id="application-role"
                  maxLength={160}
                  required
                  value={form.roleTitle}
                  onChange={(event) =>
                    updateText("roleTitle", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-status">Stage</label>
                <select
                  id="application-status"
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as ApplicationStatus,
                    }))
                  }
                >
                  <option value="prospect">Prospect</option>
                  <option value="applied">Applied</option>
                  <option value="interview">Interview</option>
                  <option value="offer">Offer</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="application-date">Applied date</label>
                <input
                  id="application-date"
                  type="date"
                  value={form.appliedOn}
                  onChange={(event) =>
                    updateText("appliedOn", event.target.value)
                  }
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="tracker-form-section">
            <legend>
              <span>02</span> Context and notes
            </legend>
            <div className="tracker-form-grid">
              <div className="field">
                <label htmlFor="application-location">Location</label>
                <input
                  autoComplete="off"
                  id="application-location"
                  maxLength={160}
                  value={form.location}
                  onChange={(event) =>
                    updateText("location", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-source">Source link</label>
                <input
                  autoComplete="url"
                  id="application-source"
                  maxLength={2048}
                  type="url"
                  value={form.sourceUrl}
                  onChange={(event) =>
                    updateText("sourceUrl", event.target.value)
                  }
                />
              </div>
              <div className="field tracker-form-wide">
                <label htmlFor="application-notes">Notes</label>
                <textarea
                  id="application-notes"
                  maxLength={5000}
                  rows={4}
                  value={form.notes}
                  onChange={(event) => updateText("notes", event.target.value)}
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="tracker-form-section">
            <legend>
              <span>03</span> Next step
            </legend>
            <div className="tracker-form-grid">
              <div className="field tracker-form-wide">
                <label htmlFor="application-next-action">Next action</label>
                <input
                  autoComplete="off"
                  id="application-next-action"
                  maxLength={500}
                  placeholder="Follow up, prepare, send…"
                  value={form.nextAction}
                  onChange={(event) =>
                    updateText("nextAction", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-next-action-due">Due date</label>
                <input
                  id="application-next-action-due"
                  type="date"
                  value={form.nextActionDue}
                  onChange={(event) =>
                    updateText("nextActionDue", event.target.value)
                  }
                />
              </div>
            </div>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <footer className="tracker-modal-footer">
            <p>
              {mode === "edit"
                ? "Stage changes are added to the permanent timeline."
                : "You can add more detail at any time."}
            </p>
            <div>
              <button
                className="tracker-button tracker-button-quiet"
                type="button"
                disabled={submitting}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="tracker-button tracker-button-primary"
                type="submit"
                disabled={submitting}
              >
                {submitting
                  ? "Saving…"
                  : mode === "edit"
                    ? "Save changes"
                    : "Save application"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
