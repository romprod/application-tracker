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
import type { ReferenceValue } from "./reference_values_client";
import {
  EmailLinksClientError,
  type EmailLinkCandidate,
  type EmailLinksClient,
} from "./email_links_client";

export interface ApplicationFormState {
  appliedOn: string;
  companyName: string;
  contacts: ApplicationContactForm[];
  links: ApplicationLinkForm[];
  location: string;
  nextAction: string;
  nextActionDue: string;
  notes: string;
  roleTypeId: string;
  roleTitle: string;
  sourceId: string;
  sourceUrl: string;
  statusId: string;
}

interface ApplicationContactForm {
  email: string;
  name: string;
  phone: string;
  role: string;
}

interface ApplicationLinkForm {
  label: string;
  url: string;
}

function emptyApplicationForm(
  referenceValues: ReferenceValue[],
): ApplicationFormState {
  return {
    appliedOn: "",
    companyName: "",
    contacts: [],
    links: [],
    location: "",
    nextAction: "",
    nextActionDue: "",
    notes: "",
    roleTypeId: "",
    roleTitle: "",
    sourceId: "",
    sourceUrl: "",
    statusId:
      referenceValues.find(
        ({ category, isActive }) => category === "status" && isActive,
      )?.id ?? "",
  };
}

type ApplicationTextField = Exclude<
  keyof ApplicationFormState,
  "contacts" | "links" | "roleTypeId" | "sourceId" | "statusId"
>;

function contactInput(contact: ApplicationContactForm) {
  const email = contact.email.trim();
  const phone = contact.phone.trim();
  const role = contact.role.trim();
  return {
    name: contact.name.trim(),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(role ? { role } : {}),
  };
}

function linkInput(link: ApplicationLinkForm) {
  return { label: link.label.trim(), url: link.url.trim() };
}

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
    contacts: form.contacts.map(contactInput),
    links: form.links.map(linkInput),
    roleTitle: form.roleTitle.trim(),
    statusId: form.statusId,
    ...(appliedOn ? { appliedOn } : {}),
    ...(location ? { location } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(nextActionDue ? { nextActionDue } : {}),
    ...(notes ? { notes } : {}),
    ...(form.roleTypeId ? { roleTypeId: form.roleTypeId } : {}),
    ...(form.sourceId ? { sourceId: form.sourceId } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function applicationUpdateInput(
  form: ApplicationFormState,
): UpdateApplicationInput {
  return {
    appliedOn: form.appliedOn.trim() || null,
    companyName: form.companyName.trim(),
    contacts: form.contacts.map(contactInput),
    links: form.links.map(linkInput),
    location: form.location.trim() || null,
    nextAction: form.nextAction.trim() || null,
    nextActionDue: form.nextActionDue.trim() || null,
    notes: form.notes.trim() || null,
    roleTypeId: form.roleTypeId || null,
    roleTitle: form.roleTitle.trim(),
    sourceId: form.sourceId || null,
    sourceUrl: form.sourceUrl.trim() || null,
    statusId: form.statusId,
  };
}

function applicationForm(application: ApplicationRecord): ApplicationFormState {
  return {
    appliedOn: application.appliedOn ?? "",
    companyName: application.companyName,
    contacts: application.contacts.map((contact) => ({
      email: contact.email ?? "",
      name: contact.name,
      phone: contact.phone ?? "",
      role: contact.role ?? "",
    })),
    links: application.links.map((link) => ({ ...link })),
    location: application.location ?? "",
    nextAction: application.nextAction ?? "",
    nextActionDue: application.nextActionDue ?? "",
    notes: application.notes ?? "",
    roleTypeId: application.roleTypeId ?? "",
    roleTitle: application.roleTitle,
    sourceId: application.sourceId ?? "",
    sourceUrl: application.sourceUrl ?? "",
    statusId: application.statusId,
  };
}

function eventHeading(event: ApplicationEvent): string {
  return event.type === "application_created"
    ? "Application created"
    : `${event.fromStatus ?? ""} → ${event.toStatus}`;
}

function eventDetail(event: ApplicationEvent): string {
  return event.type === "application_created"
    ? `Filed in ${event.toStatus}`
    : "Stage changed";
}

function linkHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
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
            <div>
              <dt>Source</dt>
              <dd>{application.source ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Role type</dt>
              <dd>{application.roleType ?? "Not recorded"}</dd>
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
            aria-labelledby="contacts-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>01</span>
              <h3 id="contacts-title">Contacts</h3>
            </div>
            {application.contacts.length > 0 ? (
              <ul className="tracker-contact-list">
                {application.contacts.map((contact, index) => (
                  <li key={`${contact.name}-${index}`}>
                    <span aria-hidden="true">◎</span>
                    <div>
                      <strong>{contact.name}</strong>
                      {contact.role && <small>{contact.role}</small>}
                      <p>
                        {contact.email && (
                          <a href={`mailto:${contact.email}`}>
                            {contact.email}
                          </a>
                        )}
                        {contact.phone && (
                          <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No contacts have been recorded.</p>
            )}
          </section>
          <section
            className="tracker-drawer-section"
            aria-labelledby="related-links-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>02</span>
              <h3 id="related-links-title">Related links</h3>
            </div>
            {application.links.length > 0 ? (
              <ul className="tracker-related-links">
                {application.links.map((link, index) => (
                  <li key={`${link.url}-${index}`}>
                    <a
                      aria-label={`${link.label} — ${linkHost(link.url)} (opens in a new tab)`}
                      href={link.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span aria-hidden="true">↗</span>
                      <span>
                        <strong>{link.label}</strong>
                        <small>{linkHost(link.url)}</small>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No additional links have been recorded.</p>
            )}
          </section>
          <section
            className="tracker-drawer-section"
            aria-labelledby="notes-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>03</span>
              <h3 id="notes-title">Notes</h3>
            </div>
            <p>{application.notes ?? "No notes have been recorded."}</p>
          </section>
          <section
            className="tracker-drawer-section"
            aria-labelledby="history-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>04</span>
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
  emailLinksClient,
  error,
  mode,
  onClose,
  onSave,
  referenceValues,
  submitting,
}: {
  application: ApplicationRecord | undefined;
  emailLinksClient: EmailLinksClient;
  error: string | undefined;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (form: ApplicationFormState) => void;
  referenceValues: ReferenceValue[];
  submitting: boolean;
}) {
  const [form, setForm] = useState<ApplicationFormState>(
    application
      ? applicationForm(application)
      : emptyApplicationForm(referenceValues),
  );
  const [emailImportOpen, setEmailImportOpen] = useState(false);
  const [emailContent, setEmailContent] = useState("");
  const [emailFilename, setEmailFilename] = useState<string>();
  const [emailCandidates, setEmailCandidates] = useState<EmailLinkCandidate[]>(
    [],
  );
  const [selectedEmailLinks, setSelectedEmailLinks] = useState<string[]>([]);
  const [emailImportError, setEmailImportError] = useState<string>();
  const [scanningEmail, setScanningEmail] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, "#application-company");
  const title = mode === "create" ? "Log an application" : "Edit application";
  const statuses = referenceValues.filter(
    ({ category, id, isActive }) =>
      category === "status" && (isActive || id === form.statusId),
  );
  const sources = referenceValues.filter(
    ({ category, id, isActive }) =>
      category === "source" && (isActive || id === form.sourceId),
  );
  const roleTypes = referenceValues.filter(
    ({ category, id, isActive }) =>
      category === "role_type" && (isActive || id === form.roleTypeId),
  );

  function updateText(field: ApplicationTextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateContact(
    index: number,
    field: keyof ApplicationContactForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, [field]: value } : contact,
      ),
    }));
  }

  function updateLink(
    index: number,
    field: keyof ApplicationLinkForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      links: current.links.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [field]: value } : link,
      ),
    }));
  }

  function scanEmail() {
    if (emailContent.length === 0) {
      setEmailImportError("Paste email content or choose a small .eml file.");
      return;
    }
    if (emailContent.length > 200_000) {
      setEmailImportError("Email content must be 200,000 characters or less.");
      return;
    }
    setScanningEmail(true);
    setEmailImportError(undefined);
    setEmailCandidates([]);
    setSelectedEmailLinks([]);
    void emailLinksClient
      .extractJobLinks(emailContent)
      .then((links) => {
        setEmailCandidates(links);
        setSelectedEmailLinks(links.map(({ url }) => url));
        if (links.length === 0) {
          setEmailImportError("No likely job links were found in that email.");
        }
        setScanningEmail(false);
      })
      .catch((caught: unknown) => {
        setEmailImportError(
          caught instanceof EmailLinksClientError &&
            caught.code === "validation_error"
            ? "Email content must be between 1 and 200,000 characters."
            : "The email could not be scanned. Please try again.",
        );
        setScanningEmail(false);
      });
  }

  function addSelectedEmailLinks() {
    const existing = new Set(form.links.map(({ url }) => url));
    const available = Math.max(0, 10 - form.links.length);
    const additions = emailCandidates
      .filter(
        ({ url }) => selectedEmailLinks.includes(url) && !existing.has(url),
      )
      .slice(0, available)
      .map(({ host, url }) => ({
        label: `Job posting · ${host}`.slice(0, 80),
        url,
      }));
    setForm((current) => ({
      ...current,
      links: [...current.links, ...additions],
    }));
    setEmailImportOpen(false);
    setEmailContent("");
    setEmailFilename(undefined);
    setEmailCandidates([]);
    setSelectedEmailLinks([]);
    setEmailImportError(undefined);
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
                  required
                  value={form.statusId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      statusId: event.target.value,
                    }))
                  }
                >
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                      {status.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
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
                <label htmlFor="application-role-type">Role type</label>
                <select
                  id="application-role-type"
                  value={form.roleTypeId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      roleTypeId: event.target.value,
                    }))
                  }
                >
                  <option value="">Not recorded</option>
                  {roleTypes.map((roleType) => (
                    <option key={roleType.id} value={roleType.id}>
                      {roleType.label}
                      {roleType.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="application-source-type">Source</label>
                <select
                  id="application-source-type"
                  value={form.sourceId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sourceId: event.target.value,
                    }))
                  }
                >
                  <option value="">Not recorded</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                      {source.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              </div>
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
              <span>03</span> People and links
            </legend>
            <div className="tracker-repeater">
              <div className="tracker-repeater-heading">
                <div>
                  <strong>Contacts</strong>
                  <small>Recruiters, hiring managers, and referrals</small>
                </div>
                <button
                  className="tracker-button tracker-button-quiet"
                  disabled={form.contacts.length >= 10}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      contacts: [
                        ...current.contacts,
                        { email: "", name: "", phone: "", role: "" },
                      ],
                    }))
                  }
                  type="button"
                >
                  Add contact
                </button>
              </div>
              {form.contacts.map((contact, index) => (
                <div className="tracker-repeater-item" key={index}>
                  <div className="tracker-form-grid">
                    <div className="field">
                      <label htmlFor={`application-contact-${index}-name`}>
                        Contact {index + 1} name
                      </label>
                      <input
                        autoComplete="name"
                        id={`application-contact-${index}-name`}
                        maxLength={160}
                        required
                        value={contact.name}
                        onChange={(event) =>
                          updateContact(index, "name", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`application-contact-${index}-role`}>
                        Contact {index + 1} role
                      </label>
                      <input
                        autoComplete="organization-title"
                        id={`application-contact-${index}-role`}
                        maxLength={160}
                        value={contact.role}
                        onChange={(event) =>
                          updateContact(index, "role", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`application-contact-${index}-email`}>
                        Contact {index + 1} email
                      </label>
                      <input
                        autoComplete="email"
                        id={`application-contact-${index}-email`}
                        maxLength={254}
                        type="email"
                        value={contact.email}
                        onChange={(event) =>
                          updateContact(index, "email", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`application-contact-${index}-phone`}>
                        Contact {index + 1} phone
                      </label>
                      <input
                        autoComplete="tel"
                        id={`application-contact-${index}-phone`}
                        maxLength={50}
                        type="tel"
                        value={contact.phone}
                        onChange={(event) =>
                          updateContact(index, "phone", event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <button
                    aria-label={`Remove contact ${index + 1}`}
                    className="tracker-repeater-remove"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        contacts: current.contacts.filter(
                          (_, contactIndex) => contactIndex !== index,
                        ),
                      }))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="tracker-repeater">
              <div className="tracker-repeater-heading">
                <div>
                  <strong>Additional links</strong>
                  <small>Interview details, profiles, or hiring portals</small>
                </div>
                <div className="tracker-repeater-actions">
                  <button
                    className="tracker-button tracker-button-quiet"
                    disabled={form.links.length >= 10}
                    onClick={() => {
                      setEmailImportOpen((current) => !current);
                      setEmailImportError(undefined);
                    }}
                    type="button"
                  >
                    Import from email
                  </button>
                  <button
                    className="tracker-button tracker-button-quiet"
                    disabled={form.links.length >= 10}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        links: [...current.links, { label: "", url: "" }],
                      }))
                    }
                    type="button"
                  >
                    Add additional link
                  </button>
                </div>
              </div>
              {emailImportOpen && (
                <div className="tracker-email-import">
                  <div className="tracker-email-import-heading">
                    <div>
                      <strong>Find job links in an email</strong>
                      <small>
                        The message is scanned only for likely job URLs and is
                        never stored.
                      </small>
                    </div>
                    <button
                      type="button"
                      aria-label="Close email link importer"
                      onClick={() => setEmailImportOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <label className="field tracker-form-wide">
                    <span>Email content</span>
                    <textarea
                      maxLength={200_000}
                      rows={5}
                      value={emailContent}
                      onChange={(event) => {
                        setEmailContent(event.target.value);
                        setEmailFilename(undefined);
                        setEmailImportError(undefined);
                      }}
                    />
                  </label>
                  <div className="tracker-email-import-controls">
                    <label>
                      Choose .eml file
                      <input
                        accept=".eml,message/rfc822,text/plain"
                        type="file"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (file.size > 200_000) {
                            setEmailImportError(
                              "Choose an .eml file no larger than 200 KB.",
                            );
                            return;
                          }
                          void file
                            .text()
                            .then((content) => {
                              if (content.length > 200_000) {
                                setEmailImportError(
                                  "Decoded email content must be 200,000 characters or less.",
                                );
                                return;
                              }
                              setEmailContent(content);
                              setEmailFilename(file.name);
                              setEmailImportError(undefined);
                            })
                            .catch(() => {
                              setEmailImportError(
                                "The .eml file could not be read.",
                              );
                            });
                        }}
                      />
                    </label>
                    {emailFilename && <span>{emailFilename}</span>}
                    <button
                      className="tracker-button tracker-button-primary"
                      disabled={scanningEmail}
                      type="button"
                      onClick={scanEmail}
                    >
                      {scanningEmail ? "Scanning…" : "Scan email"}
                    </button>
                  </div>
                  {emailImportError && (
                    <p className="form-error" role="alert">
                      {emailImportError}
                    </p>
                  )}
                  {emailCandidates.length > 0 && (
                    <div className="tracker-email-candidates">
                      <strong>Choose links to add</strong>
                      {emailCandidates.map((candidate) => (
                        <label key={candidate.url}>
                          <input
                            type="checkbox"
                            checked={selectedEmailLinks.includes(candidate.url)}
                            onChange={() =>
                              setSelectedEmailLinks((current) =>
                                current.includes(candidate.url)
                                  ? current.filter(
                                      (url) => url !== candidate.url,
                                    )
                                  : [...current, candidate.url],
                              )
                            }
                          />
                          <span>
                            <strong>{candidate.host}</strong>
                            <small>{candidate.url}</small>
                          </span>
                        </label>
                      ))}
                      <button
                        className="tracker-button tracker-button-primary"
                        disabled={selectedEmailLinks.length === 0}
                        type="button"
                        onClick={addSelectedEmailLinks}
                      >
                        Add selected links
                      </button>
                    </div>
                  )}
                </div>
              )}
              {form.links.map((link, index) => (
                <div className="tracker-repeater-item" key={index}>
                  <div className="tracker-form-grid">
                    <div className="field">
                      <label htmlFor={`application-link-${index}-label`}>
                        Additional link {index + 1} label
                      </label>
                      <input
                        id={`application-link-${index}-label`}
                        maxLength={80}
                        required
                        value={link.label}
                        onChange={(event) =>
                          updateLink(index, "label", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`application-link-${index}-url`}>
                        Additional link {index + 1} URL
                      </label>
                      <input
                        autoComplete="url"
                        id={`application-link-${index}-url`}
                        maxLength={2048}
                        required
                        type="url"
                        value={link.url}
                        onChange={(event) =>
                          updateLink(index, "url", event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <button
                    aria-label={`Remove additional link ${index + 1}`}
                    className="tracker-repeater-remove"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        links: current.links.filter(
                          (_, linkIndex) => linkIndex !== index,
                        ),
                      }))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset className="tracker-form-section">
            <legend>
              <span>04</span> Next step
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
