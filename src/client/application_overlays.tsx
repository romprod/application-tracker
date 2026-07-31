import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type {
  AddApplicationActivityInput,
  ApplicationActivityEvent,
  ApplicationActivityType,
  ApplicationEvidence,
  ApplicationEvent,
  ApplicationFieldProvenanceAssessment,
  ApplicationRecord,
  CreateApplicationInput,
  UpdateApplicationInput,
} from "./applications_client";
import {
  StatusChip,
  applicationReference,
  formatDate,
  formatDateTime,
  formatWorkArrangement,
} from "./application_table";
import { dueLabel } from "./application_next_action";
import type { ReferenceValue } from "./reference_values_client";
import type { OutlookGraphConnectionOption } from "./outlook_connections_client";
import {
  EmailLinksClientError,
  jobBoardProviderLabel,
  type EmailLinkCandidate,
  type EmailLinksClient,
} from "./email_links_client";

export interface ApplicationFormState {
  agency: string;
  appliedOn: string;
  companyName: string;
  contacts: ApplicationContactForm[];
  links: ApplicationLinkForm[];
  location: string;
  nextAction: string;
  nextActionDue: string;
  notes: string;
  outlookGraphConnectionId: string;
  rating: string;
  roleTypeId: string;
  roleTitle: string;
  salary: string;
  salaryCurrency: string;
  salaryDisclosed: "no" | "yes";
  salaryMaximum: string;
  salaryMinimum: string;
  salaryNegotiable: "no" | "yes";
  salaryPeriod: "" | "annual" | "daily" | "hourly" | "monthly" | "weekly";
  sourceId: string;
  sourceUrl: string;
  statusId: string;
  workArrangement: "" | NonNullable<ApplicationRecord["workArrangement"]>;
  workArrangementText: string;
  officeDaysPerWeek: string;
  remoteDaysPerWeek: string;
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
    agency: "",
    appliedOn: "",
    companyName: "",
    contacts: [],
    links: [],
    location: "",
    nextAction: "",
    nextActionDue: "",
    notes: "",
    outlookGraphConnectionId: "",
    rating: "",
    roleTypeId: "",
    roleTitle: "",
    salary: "",
    salaryCurrency: "",
    salaryDisclosed: "yes",
    salaryMaximum: "",
    salaryMinimum: "",
    salaryNegotiable: "no",
    salaryPeriod: "",
    sourceId: "",
    sourceUrl: "",
    statusId:
      referenceValues.find(
        ({ category, isActive }) => category === "status" && isActive,
      )?.id ?? "",
    workArrangement: "",
    workArrangementText: "",
    officeDaysPerWeek: "",
    remoteDaysPerWeek: "",
  };
}

type ApplicationTextField = Exclude<
  keyof ApplicationFormState,
  | "contacts"
  | "links"
  | "roleTypeId"
  | "sourceId"
  | "statusId"
  | "workArrangement"
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

function salaryDetailsInput(form: ApplicationFormState) {
  const currency = form.salaryCurrency.trim().toUpperCase();
  if (
    !currency &&
    !form.salaryPeriod &&
    !form.salaryMinimum &&
    !form.salaryMaximum
  ) {
    return undefined;
  }
  return {
    currency,
    disclosed: form.salaryDisclosed === "yes",
    ...(form.salaryMaximum ? { maximum: Number(form.salaryMaximum) } : {}),
    ...(form.salaryMinimum ? { minimum: Number(form.salaryMinimum) } : {}),
    negotiable: form.salaryNegotiable === "yes",
    period: form.salaryPeriod as NonNullable<
      CreateApplicationInput["salaryDetails"]
    >["period"],
  };
}

function workArrangementDetailsInput(form: ApplicationFormState) {
  const originalText = form.workArrangementText.trim();
  if (!originalText && !form.officeDaysPerWeek && !form.remoteDaysPerWeek) {
    return undefined;
  }
  return {
    ...(form.officeDaysPerWeek
      ? { officeDaysPerWeek: Number(form.officeDaysPerWeek) }
      : {}),
    ...(originalText ? { originalText } : {}),
    ...(form.remoteDaysPerWeek
      ? { remoteDaysPerWeek: Number(form.remoteDaysPerWeek) }
      : {}),
  };
}

export function applicationInput(
  form: ApplicationFormState,
): CreateApplicationInput {
  const agency = form.agency.trim();
  const appliedOn = form.appliedOn.trim();
  const location = form.location.trim();
  const nextAction = form.nextAction.trim();
  const nextActionDue = form.nextActionDue.trim();
  const notes = form.notes.trim();
  const rating = form.rating ? Number(form.rating) : undefined;
  const salary = form.salary.trim();
  const sourceUrl = form.sourceUrl.trim();
  const salaryDetails = salaryDetailsInput(form);
  const workArrangementDetails = workArrangementDetailsInput(form);
  return {
    companyName: form.companyName.trim(),
    contacts: form.contacts.map(contactInput),
    links: form.links.map(linkInput),
    roleTitle: form.roleTitle.trim(),
    statusId: form.statusId,
    ...(agency ? { agency } : {}),
    ...(appliedOn ? { appliedOn } : {}),
    ...(location ? { location } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(nextActionDue ? { nextActionDue } : {}),
    ...(notes ? { notes } : {}),
    ...(form.outlookGraphConnectionId
      ? { outlookGraphConnectionId: form.outlookGraphConnectionId }
      : {}),
    ...(rating ? { rating } : {}),
    ...(form.roleTypeId ? { roleTypeId: form.roleTypeId } : {}),
    ...(salary ? { salary } : {}),
    ...(salaryDetails ? { salaryDetails } : {}),
    ...(form.sourceId ? { sourceId: form.sourceId } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(form.workArrangement ? { workArrangement: form.workArrangement } : {}),
    ...(workArrangementDetails ? { workArrangementDetails } : {}),
  };
}

export function applicationUpdateInput(
  form: ApplicationFormState,
  expectedUpdatedAt: string,
): UpdateApplicationInput {
  return {
    agency: form.agency.trim() || null,
    appliedOn: form.appliedOn.trim() || null,
    companyName: form.companyName.trim(),
    contacts: form.contacts.map(contactInput),
    expectedUpdatedAt,
    links: form.links.map(linkInput),
    location: form.location.trim() || null,
    nextAction: form.nextAction.trim() || null,
    nextActionDue: form.nextActionDue.trim() || null,
    notes: form.notes.trim() || null,
    outlookGraphConnectionId: form.outlookGraphConnectionId || null,
    rating: form.rating ? Number(form.rating) : null,
    roleTypeId: form.roleTypeId || null,
    roleTitle: form.roleTitle.trim(),
    salary: form.salary.trim() || null,
    salaryDetails: salaryDetailsInput(form) ?? null,
    sourceId: form.sourceId || null,
    sourceUrl: form.sourceUrl.trim() || null,
    statusId: form.statusId,
    workArrangement: form.workArrangement || null,
    workArrangementDetails: workArrangementDetailsInput(form) ?? null,
  };
}

function applicationForm(application: ApplicationRecord): ApplicationFormState {
  return {
    agency: application.agency ?? "",
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
    outlookGraphConnectionId: application.outlookGraphConnectionId ?? "",
    rating: application.rating?.toString() ?? "",
    roleTypeId: application.roleTypeId ?? "",
    roleTitle: application.roleTitle,
    salary: application.salary ?? "",
    salaryCurrency: application.salaryDetails?.currency ?? "",
    salaryDisclosed:
      application.salaryDetails?.disclosed === false ? "no" : "yes",
    salaryMaximum: application.salaryDetails?.maximum?.toString() ?? "",
    salaryMinimum: application.salaryDetails?.minimum?.toString() ?? "",
    salaryNegotiable: application.salaryDetails?.negotiable ? "yes" : "no",
    salaryPeriod: application.salaryDetails?.period ?? "",
    sourceId: application.sourceId ?? "",
    sourceUrl: application.sourceUrl ?? "",
    statusId: application.statusId,
    workArrangement: application.workArrangement ?? "",
    workArrangementText: application.workArrangementDetails?.originalText ?? "",
    officeDaysPerWeek:
      application.workArrangementDetails?.officeDaysPerWeek?.toString() ?? "",
    remoteDaysPerWeek:
      application.workArrangementDetails?.remoteDaysPerWeek?.toString() ?? "",
  };
}

function eventHeading(event: ApplicationEvent): string {
  if (event.type === "application_created") return "Application created";
  if (event.type === "status_changed") {
    return `${event.fromStatus} → ${event.toStatus}`;
  }
  return isActivityEvent(event) ? activityTypeLabels[event.type] : "Activity";
}

function eventDetail(event: ApplicationEvent): string {
  if (event.type === "application_created") return `Filed in ${event.toStatus}`;
  if (isActivityEvent(event)) return event.summary;
  if (!event.sourceEmailMessageId) return "Stage changed";
  const processingDetail = `Email status · processed ${formatDateTime(event.processedAt)}`;
  return event.statusOverrideReason
    ? `${processingDetail} · Override: ${event.statusOverrideReason}`
    : processingDetail;
}

function isActivityEvent(
  event: ApplicationEvent,
): event is ApplicationActivityEvent {
  return (
    event.type !== "application_created" && event.type !== "status_changed"
  );
}

const activityTypeLabels: Record<ApplicationActivityType, string> = {
  follow_up_sent: "Follow-up sent",
  interview_completed: "Interview completed",
  interview_scheduled: "Interview scheduled",
  note: "Note",
  offer: "Offer",
  other: "Other activity",
  recruiter_contact: "Recruiter contact",
  recruiter_screen: "Recruiter screen",
  rejection: "Rejection",
  role_closed: "Role closed",
  salary_discussion: "Salary discussion",
  withdrawal: "Withdrawal",
};

function localDateTimeValue(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function linkHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

interface DrawerRelatedLink {
  detail: string;
  label: string;
  url: string;
}

function relatedLinks(
  application: ApplicationRecord,
  evidence: ApplicationEvidence | undefined,
): DrawerRelatedLink[] {
  const links = application.links.map((link) => ({
    detail: linkHost(link.url),
    label: link.label,
    url: link.url,
  }));
  const seen = new Set([
    ...(application.sourceUrl ? [application.sourceUrl] : []),
    ...application.links.map(({ url }) => url),
  ]);
  if (!evidence) return links;

  for (const email of evidence.emailEvidence) {
    if (!email.webUrl || seen.has(email.webUrl)) continue;
    seen.add(email.webUrl);
    links.push({
      detail: `${linkHost(email.webUrl)} · Received ${formatDateTime(email.receivedAt)}`,
      label: "Source email",
      url: email.webUrl,
    });
  }
  for (const posting of evidence.jobPostings) {
    if (!posting.canonicalUrl || seen.has(posting.canonicalUrl)) continue;
    seen.add(posting.canonicalUrl);
    const provider = jobBoardProviderLabel(posting.provider);
    links.push({
      detail: [
        linkHost(posting.canonicalUrl),
        posting.externalPostingId
          ? `Posting ${posting.externalPostingId}`
          : undefined,
      ]
        .filter((value): value is string => value !== undefined)
        .join(" · "),
      label:
        posting.provider === "generic"
          ? "Job posting"
          : `${provider} job posting`,
      url: posting.canonicalUrl,
    });
  }
  return links;
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
  evidence,
  evidenceError,
  evidenceLoading,
  events,
  eventsError,
  eventsLoading,
  eventsLoadingMore,
  eventsNextOffset,
  onAddActivity,
  onClose,
  onDelete,
  onEdit,
  onLoadMoreEvents,
  onVerifyProvenance,
  provenance,
  provenanceError,
  provenanceLoading,
  provenanceVerifyingId,
}: {
  application: ApplicationRecord;
  evidence: ApplicationEvidence | undefined;
  evidenceError: boolean;
  evidenceLoading: boolean;
  events: ApplicationEvent[] | undefined;
  eventsError: boolean;
  eventsLoading: boolean;
  eventsLoadingMore: boolean;
  eventsNextOffset: number | null;
  onAddActivity: (input: AddApplicationActivityInput) => Promise<void>;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onLoadMoreEvents: () => Promise<void>;
  onVerifyProvenance: (provenanceId: string) => Promise<void>;
  provenance: ApplicationFieldProvenanceAssessment[] | undefined;
  provenanceError: boolean;
  provenanceLoading: boolean;
  provenanceVerifyingId: string | undefined;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityType, setActivityType] =
    useState<ApplicationActivityType>("recruiter_contact");
  const [activityOccurredAt, setActivityOccurredAt] =
    useState(localDateTimeValue);
  const [activitySummary, setActivitySummary] = useState("");
  const [activityEvidenceId, setActivityEvidenceId] = useState("");
  const [activitySubmitting, setActivitySubmitting] = useState(false);
  const [activityError, setActivityError] = useState<string>();
  const [activityNotice, setActivityNotice] = useState<string>();
  const nextActionDue = dueLabel(application.nextActionDue);
  const applicationRelatedLinks = relatedLinks(application, evidence);
  const supersededEventIds = new Set(
    (events ?? []).flatMap((event) =>
      isActivityEvent(event) && event.supersedesEventId
        ? [event.supersedesEventId]
        : [],
    ),
  );
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
          <p className="tracker-drawer-company">
            <span>End company</span>
            <strong>{application.companyName}</strong>
          </p>
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
              <dt>Work arrangement</dt>
              <dd>
                {formatWorkArrangement(application.workArrangement)}
                {application.workArrangementDetails?.originalText
                  ? ` · ${application.workArrangementDetails.originalText}`
                  : ""}
              </dd>
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
              <dt>Graph origin</dt>
              <dd>
                {application.outlookGraphConnectionName ?? "Not assigned"}
              </dd>
            </div>
            <div>
              <dt>Role type</dt>
              <dd>{application.roleType ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Agency</dt>
              <dd>{application.agency ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Salary</dt>
              <dd>
                {application.salary ?? "Not recorded"}
                {application.salaryDetails
                  ? ` · ${application.salaryDetails.currency} ${application.salaryDetails.minimum ?? "?"}–${application.salaryDetails.maximum ?? "?"} ${application.salaryDetails.period}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Rating</dt>
              <dd>
                {application.rating
                  ? `${application.rating} out of 5`
                  : "Not rated"}
              </dd>
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
            {applicationRelatedLinks.length > 0 && (
              <ul className="tracker-related-links">
                {applicationRelatedLinks.map((link, index) => (
                  <li key={`${link.url}-${index}`}>
                    <a
                      aria-label={`${link.label} — ${link.detail} (opens in a new tab)`}
                      href={link.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span aria-hidden="true">↗</span>
                      <span>
                        <strong>{link.label}</strong>
                        <small>{link.detail}</small>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {evidenceLoading && (
              <p className="tracker-loading" role="status">
                Loading related links…
              </p>
            )}
            {evidenceError && (
              <p className="tracker-load-error" role="alert">
                Some related links could not be loaded. Try again.
              </p>
            )}
            {!evidenceLoading &&
              !evidenceError &&
              applicationRelatedLinks.length === 0 && (
                <p>No related links have been recorded.</p>
              )}
          </section>
          <section
            className="tracker-drawer-section"
            aria-labelledby="provenance-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>03</span>
              <h3 id="provenance-title">Evidence provenance</h3>
            </div>
            {provenanceLoading && (
              <p className="tracker-loading" role="status">
                Loading field evidence…
              </p>
            )}
            {provenanceError && (
              <p className="tracker-load-error" role="alert">
                Field evidence could not be loaded or verified. Try again.
              </p>
            )}
            {!provenanceLoading &&
              !provenanceError &&
              provenance?.length === 0 && (
                <p>No machine-derived field evidence has been recorded.</p>
              )}
            {provenance && provenance.length > 0 && (
              <ul className="tracker-provenance-list">
                {provenance.flatMap((assessment) =>
                  assessment.records.map((record) => (
                    <li key={record.id}>
                      <div>
                        <strong>
                          {assessment.field} · {record.relationship}
                        </strong>
                        <small>
                          {record.source.type.replaceAll("_", " ")} · observed{" "}
                          {formatDateTime(record.observedAt)} · confidence{" "}
                          {Math.round(record.confidence * 100)}%
                        </small>
                        <p>
                          {record.value === null
                            ? record.fieldState.replaceAll("_", " ")
                            : String(record.value)}
                        </p>
                        {record.verifiedAt && (
                          <small>
                            Verified by {record.verifiedByDisplayName} ·{" "}
                            {formatDateTime(record.verifiedAt)}
                          </small>
                        )}
                      </div>
                      {!record.verifiedAt && (
                        <button
                          className="tracker-button tracker-button-quiet"
                          disabled={provenanceVerifyingId !== undefined}
                          type="button"
                          onClick={() => void onVerifyProvenance(record.id)}
                        >
                          {provenanceVerifyingId === record.id
                            ? "Verifying…"
                            : "Verify"}
                        </button>
                      )}
                    </li>
                  )),
                )}
              </ul>
            )}
          </section>
          <section
            className="tracker-drawer-section"
            aria-labelledby="notes-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>04</span>
              <h3 id="notes-title">Notes</h3>
            </div>
            <p>{application.notes ?? "No notes have been recorded."}</p>
          </section>
          <section
            className="tracker-drawer-section"
            aria-labelledby="history-title"
          >
            <div className="tracker-drawer-section-heading">
              <span>05</span>
              <h3 id="history-title">Activity</h3>
            </div>
            <div className="tracker-activity-actions">
              <button
                className="tracker-button tracker-button-quiet"
                type="button"
                aria-expanded={activityOpen}
                aria-controls="application-activity-form"
                onClick={() => {
                  setActivityError(undefined);
                  setActivityNotice(undefined);
                  setActivityOpen((open) => !open);
                }}
              >
                {activityOpen ? "Cancel activity" : "Record activity"}
              </button>
            </div>
            {activityOpen && (
              <form
                className="tracker-activity-form"
                id="application-activity-form"
                onSubmit={(submitEvent) => {
                  submitEvent.preventDefault();
                  setActivitySubmitting(true);
                  setActivityError(undefined);
                  setActivityNotice(undefined);
                  void onAddActivity({
                    occurredAt: new Date(activityOccurredAt).toISOString(),
                    ...(activityEvidenceId
                      ? { sourceEmailEvidenceId: activityEvidenceId }
                      : {}),
                    summary: activitySummary,
                    type: activityType,
                  })
                    .then(() => {
                      setActivitySummary("");
                      setActivityEvidenceId("");
                      setActivityOccurredAt(localDateTimeValue());
                      setActivityOpen(false);
                      setActivityNotice("Activity recorded.");
                    })
                    .catch(() => {
                      setActivityError(
                        "Activity could not be recorded. Check the details and try again.",
                      );
                    })
                    .finally(() => setActivitySubmitting(false));
                }}
              >
                <label>
                  <span>Activity type</span>
                  <select
                    value={activityType}
                    onChange={(changeEvent) =>
                      setActivityType(
                        changeEvent.target.value as ApplicationActivityType,
                      )
                    }
                  >
                    {Object.entries(activityTypeLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  <span>When it happened</span>
                  <input
                    required
                    type="datetime-local"
                    value={activityOccurredAt}
                    onChange={(changeEvent) =>
                      setActivityOccurredAt(changeEvent.target.value)
                    }
                  />
                </label>
                <label className="tracker-activity-summary-field">
                  <span>Concise summary</span>
                  <textarea
                    maxLength={1000}
                    required
                    rows={3}
                    value={activitySummary}
                    onChange={(changeEvent) =>
                      setActivitySummary(changeEvent.target.value)
                    }
                  />
                </label>
                {evidence && evidence.emailEvidence.length > 0 && (
                  <label className="tracker-activity-summary-field">
                    <span>Linked email evidence (optional)</span>
                    <select
                      value={activityEvidenceId}
                      onChange={(changeEvent) =>
                        setActivityEvidenceId(changeEvent.target.value)
                      }
                    >
                      <option value="">No linked email</option>
                      {evidence.emailEvidence.map((email) => (
                        <option key={email.id} value={email.id}>
                          {email.evidenceType.replaceAll("_", " ")} ·{" "}
                          {formatDateTime(email.receivedAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {activityError && (
                  <p className="tracker-load-error" role="alert">
                    {activityError}
                  </p>
                )}
                <button
                  className="tracker-button tracker-button-primary"
                  disabled={activitySubmitting}
                  type="submit"
                >
                  {activitySubmitting ? "Recording…" : "Record activity"}
                </button>
              </form>
            )}
            {activityNotice && <p role="status">{activityNotice}</p>}
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
                  <li
                    key={event.id}
                    className={
                      supersededEventIds.has(event.id)
                        ? "tracker-timeline-superseded"
                        : undefined
                    }
                  >
                    <span aria-hidden="true" />
                    <div>
                      <strong>{eventHeading(event)}</strong>
                      <small>{eventDetail(event)}</small>
                      {isActivityEvent(event) && event.supersedesEventId && (
                        <small>Correction · {event.correctionReason}</small>
                      )}
                      {supersededEventIds.has(event.id) && (
                        <small>Superseded by a later correction</small>
                      )}
                      {isActivityEvent(event) &&
                        event.sourceEmailEvidenceId && (
                          <small>Linked email evidence</small>
                        )}
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
            {eventsNextOffset !== null && (
              <button
                className="tracker-button tracker-button-quiet tracker-load-more-activity"
                disabled={eventsLoadingMore}
                type="button"
                onClick={() => void onLoadMoreEvents()}
              >
                {eventsLoadingMore ? "Loading more…" : "Load more activity"}
              </button>
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
  onConfirm: (reason: string) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [reason, setReason] = useState("");
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
            history and deletion reason remain stored.
          </p>
          <label className="tracker-field">
            <span>Reason for deletion</span>
            <textarea
              autoComplete="off"
              disabled={deleting}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: duplicate record created during import"
              required
              rows={3}
              value={reason}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="tracker-modal-footer">
          <p>
            You can review and restore this record from Deleted applications.
          </p>
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
              disabled={deleting || reason.trim().length < 3}
              onClick={() => onConfirm(reason.trim())}
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
  onReloadLatest,
  onSave,
  outlookConnections,
  referenceValues,
  submitting,
}: {
  application: ApplicationRecord | undefined;
  emailLinksClient: EmailLinksClient;
  error: string | undefined;
  mode: "create" | "edit";
  onClose: () => void;
  onReloadLatest?: () => void;
  onSave: (form: ApplicationFormState) => void;
  outlookConnections: OutlookGraphConnectionOption[];
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
      .map(({ externalPostingId, host, provider, url }) => ({
        label: `Job posting · ${jobBoardProviderLabel(provider)}${
          externalPostingId ? ` · ${externalPostingId}` : ` · ${host}`
        }`.slice(0, 80),
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
                <label htmlFor="application-company">End company</label>
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
                <label htmlFor="application-agency">Agency</label>
                <input
                  autoComplete="organization"
                  id="application-agency"
                  maxLength={160}
                  placeholder="Leave blank for a direct opportunity"
                  value={form.agency}
                  onChange={(event) => updateText("agency", event.target.value)}
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
              <div className="field">
                <label htmlFor="application-salary">Salary</label>
                <input
                  autoComplete="off"
                  id="application-salary"
                  maxLength={160}
                  placeholder="e.g. £70,000–£80,000"
                  value={form.salary}
                  onChange={(event) => updateText("salary", event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="application-salary-currency">
                  Salary currency
                </label>
                <input
                  id="application-salary-currency"
                  maxLength={3}
                  placeholder="GBP"
                  value={form.salaryCurrency}
                  onChange={(event) =>
                    updateText(
                      "salaryCurrency",
                      event.target.value.toUpperCase(),
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-salary-period">Salary period</label>
                <select
                  id="application-salary-period"
                  value={form.salaryPeriod}
                  onChange={(event) =>
                    updateText("salaryPeriod", event.target.value)
                  }
                >
                  <option value="">Not normalized</option>
                  <option value="annual">Annual</option>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                  <option value="hourly">Hourly</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="application-salary-minimum">
                  Minimum salary
                </label>
                <input
                  id="application-salary-minimum"
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.salaryMinimum}
                  onChange={(event) =>
                    updateText("salaryMinimum", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-salary-maximum">
                  Maximum salary
                </label>
                <input
                  id="application-salary-maximum"
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.salaryMaximum}
                  onChange={(event) =>
                    updateText("salaryMaximum", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-salary-disclosed">
                  Salary disclosed
                </label>
                <select
                  id="application-salary-disclosed"
                  value={form.salaryDisclosed}
                  onChange={(event) =>
                    updateText("salaryDisclosed", event.target.value)
                  }
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="application-salary-negotiable">
                  Salary negotiable
                </label>
                <select
                  id="application-salary-negotiable"
                  value={form.salaryNegotiable}
                  onChange={(event) =>
                    updateText("salaryNegotiable", event.target.value)
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="application-rating">Rating</label>
                <select
                  id="application-rating"
                  value={form.rating}
                  onChange={(event) => updateText("rating", event.target.value)}
                >
                  <option value="">Not rated</option>
                  <option value="1">1 — low priority</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5 — top opportunity</option>
                </select>
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
                <label htmlFor="application-graph-origin">Graph origin</label>
                <select
                  id="application-graph-origin"
                  value={form.outlookGraphConnectionId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      outlookGraphConnectionId: event.target.value,
                    }))
                  }
                >
                  <option value="">Not assigned</option>
                  {outlookConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} — {connection.mailbox}
                      {connection.enabled ? "" : " (disabled)"}
                    </option>
                  ))}
                </select>
                <small>
                  Email evidence synchronization uses only this connection.
                </small>
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
                <label htmlFor="application-work-arrangement">
                  Work arrangement
                </label>
                <select
                  id="application-work-arrangement"
                  value={form.workArrangement}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      workArrangement: event.target
                        .value as ApplicationFormState["workArrangement"],
                    }))
                  }
                >
                  <option value="">Not recorded</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="remote">Remote</option>
                  <option value="office">Office</option>
                </select>
              </div>
              <div className="field tracker-form-wide">
                <label htmlFor="application-work-arrangement-text">
                  Original arrangement wording
                </label>
                <input
                  id="application-work-arrangement-text"
                  maxLength={500}
                  value={form.workArrangementText}
                  onChange={(event) =>
                    updateText("workArrangementText", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-office-days">
                  Office days per week
                </label>
                <input
                  id="application-office-days"
                  max="7"
                  min="0"
                  type="number"
                  value={form.officeDaysPerWeek}
                  onChange={(event) =>
                    updateText("officeDaysPerWeek", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="application-remote-days">
                  Remote days per week
                </label>
                <input
                  id="application-remote-days"
                  max="7"
                  min="0"
                  type="number"
                  value={form.remoteDaysPerWeek}
                  onChange={(event) =>
                    updateText("remoteDaysPerWeek", event.target.value)
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
                            <strong>
                              {jobBoardProviderLabel(candidate.provider)}
                              {candidate.externalPostingId
                                ? ` · ${candidate.externalPostingId}`
                                : ""}
                            </strong>
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
            <div className="form-error" role="alert">
              <p>{error}</p>
              {onReloadLatest && (
                <button
                  className="tracker-button tracker-button-quiet"
                  onClick={onReloadLatest}
                  type="button"
                >
                  Reload latest version
                </button>
              )}
            </div>
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
