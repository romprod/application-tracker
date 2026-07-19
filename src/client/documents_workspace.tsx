import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type {
  ApplicationRecord,
  ApplicationsClient,
} from "./applications_client";
import {
  DocumentsClientError,
  type DocumentPreview,
  type DocumentRecord,
  type DocumentsClient,
} from "./documents_client";
import type {
  ReferenceValue,
  ReferenceValuesClient,
} from "./reference_values_client";

export function DocumentsWorkspace({
  applicationsClient,
  documentsClient,
  referenceValuesClient,
}: {
  applicationsClient: ApplicationsClient;
  documentsClient: DocumentsClient;
  referenceValuesClient: ReferenceValuesClient;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>();
  const [maxUploadBytes, setMaxUploadBytes] = useState<number>();
  const [applications, setApplications] = useState<ApplicationRecord[]>();
  const [referenceValues, setReferenceValues] = useState<ReferenceValue[]>();
  const [loadError, setLoadError] = useState(false);
  const [supportingDataError, setSupportingDataError] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [previewTarget, setPreviewTarget] = useState<DocumentRecord>();
  const [preview, setPreview] = useState<DocumentPreview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>();

  useEffect(() => {
    let active = true;
    void documentsClient
      .listDocuments()
      .then((directory) => {
        if (!active) return;
        setDocuments(directory.documents);
        setMaxUploadBytes(directory.maxUploadBytes);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [documentsClient]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      applicationsClient.listApplications(),
      referenceValuesClient.listValues(),
    ])
      .then(([loadedApplications, loadedReferenceValues]) => {
        if (!active) return;
        setApplications(loadedApplications);
        setReferenceValues(loadedReferenceValues);
      })
      .catch(() => {
        if (active) setSupportingDataError(true);
      });
    return () => {
      active = false;
    };
  }, [applicationsClient, referenceValuesClient]);

  function openUpload() {
    if (!applications || !referenceValues || maxUploadBytes === undefined) {
      setNotice(
        supportingDataError
          ? "Document types or applications could not be loaded. Reload the page to try again."
          : "Document options are still loading. Please try again.",
      );
      return;
    }
    setNotice(undefined);
    setUploadOpen(true);
  }

  function openPreview(document: DocumentRecord) {
    setPreviewTarget(document);
    setPreview(undefined);
    setPreviewError(undefined);
    setPreviewLoading(true);
    void documentsClient
      .getDocumentPreview(document.id)
      .then((loaded) => {
        setPreview(loaded);
        setPreviewLoading(false);
      })
      .catch((caught: unknown) => {
        setPreviewError(previewLoadError(caught));
        setPreviewLoading(false);
      });
  }

  return (
    <main id="main-content" tabIndex={-1} className="workspace-main">
      {notice && (
        <div className="workspace-notice" role="status">
          {notice}
        </div>
      )}
      <div className="workspace-page documents-page">
        <header className="tracker-page-header">
          <div>
            <span className="eyebrow">Private document register</span>
            <h1>Documents</h1>
            <p>
              Keep each original file with the role it supports, without
              scattering copies across your application records.
            </p>
          </div>
          <button
            className="tracker-button tracker-button-primary"
            type="button"
            onClick={openUpload}
          >
            <span aria-hidden="true">＋</span>
            Upload document
          </button>
        </header>

        {loadError && (
          <p className="tracker-load-error" role="alert">
            Documents could not be loaded. Reload the page to try again.
          </p>
        )}
        {!documents && !loadError && (
          <p className="tracker-loading">Opening your document library…</p>
        )}
        {documents && (
          <DocumentLibrary
            documents={documents}
            onPreview={openPreview}
            onUpload={openUpload}
          />
        )}
      </div>
      {previewTarget && (
        <DocumentPreviewDialog
          document={previewTarget}
          error={previewError}
          loading={previewLoading}
          onClose={() => {
            setPreviewTarget(undefined);
            setPreview(undefined);
            setPreviewError(undefined);
            setPreviewLoading(false);
          }}
          preview={preview}
        />
      )}
      {uploadOpen && applications && referenceValues && maxUploadBytes && (
        <UploadDocumentDialog
          applications={applications}
          documentTypes={referenceValues.filter(
            ({ category, isActive }) =>
              category === "document_type" && isActive,
          )}
          documentsClient={documentsClient}
          maxUploadBytes={maxUploadBytes}
          onClose={() => setUploadOpen(false)}
          onStored={(stored) => {
            setDocuments((current) => [
              stored,
              ...(current ?? []).filter(({ id }) => id !== stored.id),
            ]);
            setUploadOpen(false);
            setNotice(`${stored.originalFilename} was stored.`);
          }}
        />
      )}
    </main>
  );
}

function DocumentLibrary({
  documents,
  onPreview,
  onUpload,
}: {
  documents: DocumentRecord[];
  onPreview: (document: DocumentRecord) => void;
  onUpload: () => void;
}) {
  const totalBytes = documents.reduce(
    (total, document) => total + document.byteSize,
    0,
  );
  const linkedApplications = new Set(
    documents.flatMap(({ applications }) =>
      applications.map((application) => application.id),
    ),
  ).size;

  return (
    <>
      <section className="document-metrics" aria-label="Document summary">
        <DocumentMetric
          label="Original files"
          note="stored in this workspace"
          value={String(documents.length)}
        />
        <DocumentMetric
          label="Library size"
          note="included in database backups"
          value={formatBytes(totalBytes)}
        />
        <DocumentMetric
          label="Linked roles"
          note="applications with supporting files"
          value={String(linkedApplications)}
        />
      </section>
      {documents.length === 0 ? (
        <section className="tracker-empty-state document-empty-state">
          <span aria-hidden="true">▱</span>
          <h2>Your document library is empty.</h2>
          <p>
            Store a CV, cover letter, or supporting file and optionally connect
            it to one or more applications.
          </p>
          <button
            className="tracker-button tracker-button-primary"
            type="button"
            onClick={onUpload}
          >
            Upload your first document
          </button>
        </section>
      ) : (
        <div className="document-library-shell">
          <div className="document-library-heading">
            <div>
              <span className="eyebrow">Stored originals</span>
              <h2>Document library</h2>
            </div>
            <span>
              {documents.length} {documents.length === 1 ? "file" : "files"}
            </span>
          </div>
          <div className="document-table-scroll">
            <table className="document-table" aria-label="Documents">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Type</th>
                  <th scope="col">Linked applications</th>
                  <th scope="col">Stored</th>
                  <th scope="col">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <div className="document-file-cell">
                        <span aria-hidden="true">
                          {fileMonogram(document.originalFilename)}
                        </span>
                        <div>
                          <strong>{document.originalFilename}</strong>
                          <small>
                            {formatBytes(document.byteSize)} ·{" "}
                            {document.mediaType}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="tracker-reference">
                        {document.documentType}
                      </span>
                    </td>
                    <td>
                      {document.applications.length === 0 ? (
                        <span className="document-unlinked">Not linked</span>
                      ) : (
                        <ul className="document-associations">
                          {document.applications.map((application) => (
                            <li key={application.id}>
                              <strong>{application.companyName}</strong>
                              <span>{application.roleTitle}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="document-stored-cell">
                      <strong>{formatStoredDate(document.createdAt)}</strong>
                      <small>by {document.uploadedByDisplayName}</small>
                    </td>
                    <td>
                      <div className="document-actions">
                        <button
                          className="document-preview-button"
                          type="button"
                          aria-label={`Preview ${document.originalFilename}`}
                          onClick={() => onPreview(document)}
                        >
                          Preview
                        </button>
                        <a
                          className="document-download"
                          href={`/api/documents/${encodeURIComponent(document.id)}/download`}
                        >
                          Download
                          <span aria-hidden="true">↓</span>
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function DocumentPreviewDialog({
  document,
  error,
  loading,
  onClose,
  preview,
}: {
  document: DocumentRecord;
  error: string | undefined;
  loading: boolean;
  onClose: () => void;
  preview: DocumentPreview | undefined;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus =
      globalThis.document.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : undefined;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  return (
    <div
      className="tracker-modal-backdrop document-preview-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="tracker-modal document-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-preview-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="tracker-modal-header">
          <div>
            <span className="eyebrow">Plain-text preview</span>
            <h2 id="document-preview-title">
              Preview {document.originalFilename}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close document preview"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="document-preview-content">
          {loading && <p className="tracker-loading">Preparing preview…</p>}
          {error && (
            <p className="tracker-load-error" role="alert">
              {error}
            </p>
          )}
          {preview?.status === "unsupported" && (
            <div className="document-preview-unavailable">
              <span aria-hidden="true">▱</span>
              <h3>Preview unavailable for this format.</h3>
              <p>
                The original remains available through the authorized download
                action.
              </p>
            </div>
          )}
          {preview?.status === "ready" && (
            <>
              <div className="document-preview-meta">
                <span>{preview.mediaType}</span>
                {preview.truncated && <strong>Preview truncated safely</strong>}
              </div>
              <pre>{preview.text}</pre>
            </>
          )}
        </div>
        <footer className="tracker-modal-footer">
          <p>Preview text is generated inside a resource-limited worker.</p>
          <div>
            <a
              className="tracker-button tracker-button-quiet"
              href={`/api/documents/${encodeURIComponent(document.id)}/download`}
            >
              Download original
            </a>
            <button
              className="tracker-button tracker-button-primary"
              type="button"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function DocumentMetric({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function UploadDocumentDialog({
  applications,
  documentTypes,
  documentsClient,
  maxUploadBytes,
  onClose,
  onStored,
}: {
  applications: ApplicationRecord[];
  documentTypes: ReferenceValue[];
  documentsClient: DocumentsClient;
  maxUploadBytes: number;
  onClose: () => void;
  onStored: (document: DocumentRecord) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [documentTypeId, setDocumentTypeId] = useState(
    documentTypes[0]?.id ?? "",
  );
  const [applicationIds, setApplicationIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    fileInputRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  function close() {
    if (!submitting) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
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

  function toggleApplication(applicationId: string) {
    setApplicationIds((current) =>
      current.includes(applicationId)
        ? current.filter((id) => id !== applicationId)
        : current.length < 20
          ? [...current, applicationId]
          : current,
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a file to store.");
      return;
    }
    if (file.size > maxUploadBytes) {
      setError(`Choose a file no larger than ${formatBytes(maxUploadBytes)}.`);
      return;
    }
    if (!documentTypeId) {
      setError("Choose a document type.");
      return;
    }
    setError(undefined);
    setSubmitting(true);
    void documentsClient
      .uploadDocument({ applicationIds, documentTypeId, file })
      .then(onStored)
      .catch((caught: unknown) => {
        setError(uploadError(caught, maxUploadBytes));
        setSubmitting(false);
      });
  }

  return (
    <div
      className="tracker-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <section
        ref={dialogRef}
        className="tracker-modal document-upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-upload-title"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <header className="tracker-modal-header">
          <div>
            <span className="eyebrow">Store an original</span>
            <h2 id="document-upload-title">Add a document</h2>
          </div>
          <button
            type="button"
            aria-label="Close document upload"
            disabled={submitting}
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <form onSubmit={submit}>
          <fieldset className="tracker-form-section">
            <legend>
              <span>01</span> Original file
            </legend>
            <div className="document-file-picker">
              <label htmlFor="document-file">Choose file</label>
              <input
                ref={fileInputRef}
                id="document-file"
                type="file"
                disabled={submitting}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  setFile(selected);
                  setError(
                    selected && selected.size > maxUploadBytes
                      ? `Choose a file no larger than ${formatBytes(maxUploadBytes)}.`
                      : undefined,
                  );
                }}
              />
              <div aria-hidden="true">
                <span>{file ? fileMonogram(file.name) : "＋"}</span>
                <strong>{file ? file.name : "Select an original file"}</strong>
                <small>
                  {file
                    ? `${formatBytes(file.size)} · ${file.type || "unknown type"}`
                    : `Up to ${formatBytes(maxUploadBytes)}`}
                </small>
              </div>
            </div>
            <label className="field document-type-field">
              <span>Document type</span>
              <select
                value={documentTypeId}
                required
                disabled={submitting || documentTypes.length === 0}
                onChange={(event) => setDocumentTypeId(event.target.value)}
              >
                {documentTypes.length === 0 && (
                  <option value="">No active document types</option>
                )}
                {documentTypes.map((documentType) => (
                  <option key={documentType.id} value={documentType.id}>
                    {documentType.label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset className="tracker-form-section document-link-section">
            <legend>
              <span>02</span> Link to applications
            </legend>
            <p>
              Optional. One original can support several applications without
              storing duplicate copies.
            </p>
            {applications.length === 0 ? (
              <p className="document-no-applications">
                There are no applications to link yet.
              </p>
            ) : (
              <div className="document-application-picker">
                {applications.map((application) => (
                  <label key={application.id}>
                    <input
                      type="checkbox"
                      aria-label={`${application.companyName} · ${application.roleTitle}`}
                      checked={applicationIds.includes(application.id)}
                      disabled={
                        submitting ||
                        (applicationIds.length >= 20 &&
                          !applicationIds.includes(application.id))
                      }
                      onChange={() => toggleApplication(application.id)}
                    />
                    <span>
                      <strong>{application.companyName}</strong>
                      <small>{application.roleTitle}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {error && (
            <p className="form-error document-upload-error" role="alert">
              {error}
            </p>
          )}
          <footer className="tracker-modal-footer">
            <p>
              Files remain private to this workspace. Downloads always require
              an active signed-in session.
            </p>
            <div>
              <button
                className="tracker-button tracker-button-quiet"
                type="button"
                disabled={submitting}
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="tracker-button tracker-button-primary"
                type="submit"
                disabled={submitting || documentTypes.length === 0}
              >
                {submitting ? "Storing…" : "Store document"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function uploadError(caught: unknown, maxUploadBytes: number): string {
  if (caught instanceof DocumentsClientError) {
    if (caught.code === "document_too_large") {
      return `Choose a file no larger than ${formatBytes(maxUploadBytes)}.`;
    }
    if (
      caught.code === "validation_error" ||
      caught.code === "invalid_upload" ||
      caught.code === "invalid_document_content"
    ) {
      return "Review the file and document details, then try again.";
    }
    if (caught.code === "invalid_document_reference") {
      return "A selected document type or application is no longer available.";
    }
    if (caught.code === "document_storage_quota_exceeded") {
      return "The document storage limit has been reached. Ask an administrator to increase the configured quota.";
    }
  }
  return "The document could not be stored. Please try again.";
}

function previewLoadError(caught: unknown): string {
  if (caught instanceof DocumentsClientError) {
    if (caught.code === "document_preview_too_large") {
      return "This original is larger than the configured preview limit. Download remains available.";
    }
    if (caught.code === "document_preview_timeout") {
      return "Preview generation exceeded its time limit. Download remains available.";
    }
    if (caught.code === "document_preview_failed") {
      return "This file could not be converted to a safe plain-text preview.";
    }
    if (caught.code === "document_preview_busy") {
      return "Preview capacity is busy. Wait a moment and try again; download remains available.";
    }
  }
  return "The preview could not be loaded. Please try again.";
}

function fileMonogram(filename: string): string {
  const extension = filename.split(".").at(-1)?.trim().toUpperCase();
  return extension && extension !== filename.toUpperCase()
    ? extension.slice(0, 4)
    : "FILE";
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatStoredDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
