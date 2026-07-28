import { useEffect, useState, type FormEvent } from "react";

import {
  OutlookConnectionsClientError,
  type OutlookConnectionsClient,
  type OutlookGraphConnection,
  type OutlookGraphConnectionStatus,
} from "./outlook_connections_client";

interface ConnectionForm {
  clientId: string;
  clientSecret: string;
  folderPath: string;
  mailbox: string;
  name: string;
  tenantId: string;
}

const emptyForm: ConnectionForm = {
  clientId: "",
  clientSecret: "",
  folderPath: "Inbox\\Jobs",
  mailbox: "",
  name: "",
  tenantId: "",
};

function connectionForm(connection: OutlookGraphConnection): ConnectionForm {
  return {
    clientId: connection.clientId,
    clientSecret: "",
    folderPath: connection.folderPath,
    mailbox: connection.mailbox,
    name: connection.name,
    tenantId: connection.tenantId,
  };
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function applicationCount(count: number): string {
  return `${count} ${count === 1 ? "application" : "applications"}`;
}

function errorMessage(code: string): string {
  const messages: Record<string, string> = {
    outlook_client_secret_required:
      "Enter a client secret when creating a connection or changing its tenant or application ID.",
    outlook_connection_impact_changed:
      "The number of assigned applications changed. Review the updated deletion warning and confirm again.",
    outlook_connection_name_conflict:
      "Another connection already uses that name. Choose a different name.",
    outlook_connection_not_found:
      "This connection no longer exists. Reload the page and try again.",
    outlook_connection_storage_failed:
      "The saved credential could not be opened securely. Replace the connection credentials.",
    outlook_folder_not_found:
      "The mailbox was reached, but the configured Inbox folder path was not found.",
    outlook_graph_authentication_failed:
      "Microsoft rejected the tenant ID, application ID, or client secret.",
    outlook_graph_forbidden:
      "Microsoft authenticated the application but denied access to this mailbox.",
    outlook_graph_throttled:
      "Microsoft Graph is temporarily limiting requests. Wait a moment and test again.",
    outlook_graph_unavailable:
      "Microsoft Graph could not be reached or returned an invalid response.",
    outlook_mailbox_unavailable:
      "Microsoft Graph could not find the configured mailbox.",
    outlook_secure_storage_unavailable:
      "Secure credential storage has not been configured on this server.",
    validation_error:
      "Check every field. Tenant and application IDs must be UUIDs, and the folder must begin with Inbox.",
  };
  return (
    messages[code] ??
    "The Outlook connection could not be changed. Existing settings were preserved."
  );
}

type BusyAction = "delete" | "save" | "state" | "verify";

interface BusyState {
  action: BusyAction;
  connectionId?: string;
}

export function OutlookConnectionSettings({
  client,
}: {
  client: OutlookConnectionsClient;
}) {
  const [status, setStatus] = useState<OutlookGraphConnectionStatus>();
  const [form, setForm] = useState<ConnectionForm>(emptyForm);
  const [editingConnectionId, setEditingConnectionId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<BusyState>();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    void client
      .getStatus()
      .then((loaded) => {
        if (active) setStatus(loaded);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof OutlookConnectionsClientError
            ? errorMessage(caught.code)
            : errorMessage("request_failed"),
        );
      });
    return () => {
      active = false;
    };
  }, [client]);

  function updateField(field: keyof ConnectionForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function complete(
    nextStatus: OutlookGraphConnectionStatus,
    nextNotice: string,
  ) {
    setStatus(nextStatus);
    setNotice(nextNotice);
    setError(undefined);
    setConfirmingDeleteId(undefined);
  }

  function fail(caught: unknown) {
    setNotice(undefined);
    if (
      caught instanceof OutlookConnectionsClientError &&
      caught.code === "outlook_connection_impact_changed" &&
      caught.assignedApplicationCount !== undefined &&
      confirmingDeleteId
    ) {
      setStatus((current) =>
        current
          ? {
              ...current,
              connections: current.connections.map((connection) =>
                connection.id === confirmingDeleteId
                  ? {
                      ...connection,
                      assignedApplicationCount:
                        caught.assignedApplicationCount ?? 0,
                    }
                  : connection,
              ),
            }
          : current,
      );
      setConfirmingDeleteId(undefined);
    }
    setError(
      caught instanceof OutlookConnectionsClientError
        ? errorMessage(caught.code)
        : errorMessage("request_failed"),
    );
  }

  function beginAdd() {
    setAdding(true);
    setEditingConnectionId(undefined);
    setConfirmingDeleteId(undefined);
    setForm(emptyForm);
    setError(undefined);
    setNotice(undefined);
  }

  function beginEdit(connection: OutlookGraphConnection) {
    setAdding(false);
    setEditingConnectionId(connection.id);
    setConfirmingDeleteId(undefined);
    setForm(connectionForm(connection));
    setError(undefined);
    setNotice(undefined);
  }

  function cancelForm() {
    if (busy) return;
    setAdding(false);
    setEditingConnectionId(undefined);
    setForm(emptyForm);
    setError(undefined);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const editing = status?.connections.find(
      ({ id }) => id === editingConnectionId,
    );
    setBusy({
      action: "save",
      ...(editing ? { connectionId: editing.id } : {}),
    });
    setError(undefined);
    setNotice("Testing Microsoft Graph before saving…");
    const input = {
      clientId: form.clientId.trim(),
      folderPath: form.folderPath.trim(),
      mailbox: form.mailbox.trim(),
      name: form.name.trim(),
      tenantId: form.tenantId.trim(),
    };
    const operation = editing
      ? client.update(editing.id, {
          ...input,
          ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
        })
      : client.create({
          ...input,
          clientSecret: form.clientSecret,
        });
    void operation
      .then((updated) => {
        complete(
          updated,
          editing
            ? `${input.name} was tested and updated.`
            : `${input.name} is connected and ready.`,
        );
        setAdding(false);
        setEditingConnectionId(undefined);
        setForm(emptyForm);
      })
      .catch(fail)
      .finally(() => {
        setForm((current) => ({ ...current, clientSecret: "" }));
        setBusy(undefined);
      });
  }

  function verify(connection: OutlookGraphConnection) {
    if (busy) return;
    setBusy({ action: "verify", connectionId: connection.id });
    setError(undefined);
    setNotice(`Testing ${connection.name} and its configured folder…`);
    void client
      .verify(connection.id)
      .then((updated) =>
        complete(updated, `${connection.name} was verified successfully.`),
      )
      .catch(fail)
      .finally(() => setBusy(undefined));
  }

  function setEnabled(connection: OutlookGraphConnection, enabled: boolean) {
    if (busy) return;
    setBusy({ action: "state", connectionId: connection.id });
    setError(undefined);
    setNotice(
      enabled ? `Testing ${connection.name} before enabling…` : undefined,
    );
    void client
      .setEnabled(connection.id, enabled)
      .then((updated) =>
        complete(
          updated,
          enabled
            ? `${connection.name} was verified and enabled.`
            : `${connection.name} is disabled. Assigned applications are preserved, but their email synchronization is paused.`,
        ),
      )
      .catch(fail)
      .finally(() => setBusy(undefined));
  }

  function deleteConnection(connection: OutlookGraphConnection) {
    if (busy) return;
    if (confirmingDeleteId !== connection.id) {
      setConfirmingDeleteId(connection.id);
      setNotice(undefined);
      setError(undefined);
      return;
    }
    setBusy({ action: "delete", connectionId: connection.id });
    setError(undefined);
    void client
      .deleteConnection(connection.id, connection.assignedApplicationCount)
      .then((updated) =>
        complete(
          updated,
          `${connection.name} and its saved credential were permanently deleted. Applications and evidence were preserved.`,
        ),
      )
      .catch(fail)
      .finally(() => setBusy(undefined));
  }

  const loading = !status && !error;
  const unavailable = status?.secureStorageConfigured === false;
  const editingConnection = status?.connections.find(
    ({ id }) => id === editingConnectionId,
  );
  const showingForm = Boolean(adding || editingConnection);
  const busyFor = (connection: OutlookGraphConnection, action: BusyAction) =>
    busy?.connectionId === connection.id && busy.action === action;

  return (
    <section
      className="outlook-connection"
      aria-labelledby="outlook-connection-title"
    >
      <div className="outlook-connection-heading">
        <div>
          <p className="eyebrow">Microsoft Graph · Outlook evidence</p>
          <h2 id="outlook-connection-title">Mailbox connections.</h2>
          <p>
            Connect one or more Microsoft 365 mailboxes. Each application keeps
            the connection it came from, so evidence is always read from the
            right tenant and mailbox.
          </p>
        </div>
        <span
          className="outlook-connection-state"
          data-state={unavailable ? "unavailable" : "enabled"}
        >
          <i aria-hidden="true" />
          {unavailable
            ? "Storage unavailable"
            : `${status?.connections.filter(({ enabled }) => enabled).length ?? 0} enabled`}
        </span>
      </div>

      <div className="outlook-setup-guide">
        <div className="outlook-setup-guide-heading">
          <span aria-hidden="true">M365</span>
          <div>
            <strong>Prepare Microsoft 365 first</strong>
            <p>
              You need a Microsoft Entra application with application-only
              Mail.Read permission. The tracker never asks for a user password.
            </p>
          </div>
        </div>
        <ol>
          <li>
            <span>1</span>
            <div>
              <strong>Register an application</strong>
              <p>
                Create an app, then copy its Directory (tenant) ID and
                Application (client) ID.
              </p>
              <div className="outlook-setup-links">
                <a
                  href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  rel="noreferrer"
                  target="_blank"
                >
                  Microsoft Entra app registrations
                </a>
              </div>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Grant Mail.Read</strong>
              <p>
                Under API permissions, add Microsoft Graph Mail.Read and grant
                administrator consent.
              </p>
              <div className="outlook-setup-links">
                <a
                  href="https://learn.microsoft.com/graph/permissions-reference#mailread"
                  rel="noreferrer"
                  target="_blank"
                >
                  Mail.Read application permission
                </a>
              </div>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Restrict mailbox access</strong>
              <p>
                Limit the application to the mailbox that this connection will
                use.
              </p>
              <div className="outlook-setup-links">
                <a
                  href="https://admin.exchange.microsoft.com/#/"
                  rel="noreferrer"
                  target="_blank"
                >
                  Exchange admin centre
                </a>
                <a
                  href="https://learn.microsoft.com/exchange/permissions-exo/application-rbac"
                  rel="noreferrer"
                  target="_blank"
                >
                  Application RBAC guidance
                </a>
              </div>
            </div>
          </li>
          <li>
            <span>4</span>
            <div>
              <strong>Create a client secret</strong>
              <p>
                In the app registration, open Certificates &amp; secrets, create
                a secret, and copy its value now. Microsoft will not show it
                again.
              </p>
            </div>
          </li>
        </ol>
      </div>

      {loading && (
        <p className="outlook-connection-loading">
          Reading the mailbox connections…
        </p>
      )}

      {unavailable && (
        <div className="outlook-connection-warning" role="alert">
          <strong>Secure storage is not ready.</strong>
          <span>
            A server operator must add the Outlook connection encryption key
            once. Microsoft credentials cannot be saved until then.
          </span>
        </div>
      )}

      {notice && (
        <p className="outlook-connection-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="outlook-connection-error" role="alert">
          {error}
        </p>
      )}

      {status && !unavailable && (
        <div className="outlook-connection-toolbar">
          <div>
            <strong>
              {status.connections.length}{" "}
              {status.connections.length === 1 ? "connection" : "connections"}
            </strong>
            <span>Credentials are encrypted and never shown again.</span>
          </div>
          <button
            type="button"
            onClick={beginAdd}
            disabled={Boolean(busy || showingForm)}
          >
            Add connection
          </button>
        </div>
      )}

      {status &&
        status.connections.length === 0 &&
        !showingForm &&
        !unavailable && (
          <div className="outlook-connection-empty">
            <strong>No Microsoft Graph connections yet.</strong>
            <p>
              Complete the Microsoft 365 steps above, then add the first
              mailbox.
            </p>
            <button type="button" onClick={beginAdd}>
              Add first connection
            </button>
          </div>
        )}

      {status && status.connections.length > 0 && (
        <div className="outlook-connection-list" aria-label="Graph connections">
          {status.connections.map((connection) => (
            <article
              className="outlook-connection-card"
              key={connection.id}
              aria-labelledby={`outlook-connection-${connection.id}`}
            >
              <header>
                <div>
                  <span
                    className="outlook-connection-state"
                    data-state={connection.enabled ? "enabled" : "disabled"}
                  >
                    <i aria-hidden="true" />
                    {connection.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <h3 id={`outlook-connection-${connection.id}`}>
                    {connection.name}
                  </h3>
                  <p>{connection.mailbox}</p>
                </div>
                <strong className="outlook-assignment-count">
                  {applicationCount(connection.assignedApplicationCount)}
                </strong>
              </header>
              <div className="outlook-connection-route" aria-label="Mail route">
                <div>
                  <small>Tenant</small>
                  <strong title={connection.tenantId}>
                    {connection.tenantId}
                  </strong>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>Mailbox</small>
                  <strong>{connection.mailbox}</strong>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>Folder</small>
                  <strong>{connection.folderPath}</strong>
                </div>
              </div>
              <dl className="outlook-connection-facts">
                <div>
                  <dt>Application ID</dt>
                  <dd title={connection.clientId}>{connection.clientId}</dd>
                </div>
                <div>
                  <dt>Credential</dt>
                  <dd>Encrypted · not displayed</dd>
                </div>
                <div>
                  <dt>Last verified</dt>
                  <dd>{formattedTime(connection.verifiedAt)}</dd>
                </div>
                <div>
                  <dt>Last test</dt>
                  <dd>
                    {connection.lastErrorCode
                      ? "Failed"
                      : formattedTime(connection.lastTestedAt)}
                  </dd>
                </div>
              </dl>
              {confirmingDeleteId === connection.id && (
                <div className="outlook-delete-warning" role="alert">
                  <strong>
                    Permanently delete {connection.name} and its encrypted
                    credential?
                  </strong>
                  <p>
                    {applicationCount(connection.assignedApplicationCount)} will
                    remain in the tracker with all existing evidence, but will
                    become unassigned and cannot synchronize Outlook evidence
                    until another connection is selected.
                  </p>
                </div>
              )}
              <div className="outlook-connection-actions">
                <button
                  type="button"
                  onClick={() => verify(connection)}
                  disabled={Boolean(busy || showingForm)}
                >
                  {busyFor(connection, "verify")
                    ? "Testing…"
                    : "Test connection"}
                </button>
                <button
                  type="button"
                  onClick={() => beginEdit(connection)}
                  disabled={Boolean(busy || showingForm)}
                >
                  Edit details
                </button>
                <button
                  type="button"
                  onClick={() => setEnabled(connection, !connection.enabled)}
                  disabled={Boolean(busy || showingForm)}
                >
                  {busyFor(connection, "state")
                    ? "Working…"
                    : connection.enabled
                      ? "Disable"
                      : "Enable"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => deleteConnection(connection)}
                  disabled={Boolean(busy || showingForm)}
                >
                  {busyFor(connection, "delete")
                    ? "Deleting…"
                    : confirmingDeleteId === connection.id
                      ? "Confirm permanent delete"
                      : "Delete"}
                </button>
                {confirmingDeleteId === connection.id &&
                  !busyFor(connection, "delete") && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(undefined)}
                    >
                      Keep connection
                    </button>
                  )}
              </div>
            </article>
          ))}
        </div>
      )}

      {!unavailable && status && showingForm && (
        <form className="outlook-connection-form" onSubmit={save}>
          <div className="outlook-form-intro">
            <span aria-hidden="true">↗</span>
            <div>
              <strong>
                {editingConnection
                  ? `Update ${editingConnection.name}.`
                  : "Connect another mailbox."}
              </strong>
              <p>
                Saving performs a live authentication, mailbox, and folder check
                first. Existing settings remain unchanged if Microsoft rejects
                an edit.
              </p>
            </div>
          </div>
          <div className="outlook-form-grid">
            <label>
              Connection name
              <input
                required
                autoComplete="off"
                maxLength={80}
                value={form.name}
                onChange={(event) =>
                  updateField("name", event.currentTarget.value)
                }
                placeholder="Work tenant"
              />
            </label>
            <label>
              Mailbox
              <input
                required
                autoComplete="email"
                type="email"
                value={form.mailbox}
                onChange={(event) =>
                  updateField("mailbox", event.currentTarget.value)
                }
                placeholder="jobs@example.com"
              />
            </label>
            <label>
              Tenant ID
              <input
                required
                autoComplete="off"
                value={form.tenantId}
                onChange={(event) =>
                  updateField("tenantId", event.currentTarget.value)
                }
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </label>
            <label>
              Application ID
              <input
                required
                autoComplete="off"
                value={form.clientId}
                onChange={(event) =>
                  updateField("clientId", event.currentTarget.value)
                }
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </label>
            <label className="outlook-secret-field">
              Client secret
              <input
                required={!editingConnection}
                autoComplete="new-password"
                type="password"
                value={form.clientSecret}
                onChange={(event) =>
                  updateField("clientSecret", event.currentTarget.value)
                }
                placeholder={
                  editingConnection
                    ? "Leave blank to keep the saved secret"
                    : "Paste the secret value"
                }
              />
            </label>
            <label>
              Inbox folder path
              <input
                required
                autoComplete="off"
                value={form.folderPath}
                onChange={(event) =>
                  updateField("folderPath", event.currentTarget.value)
                }
                placeholder="Inbox\\Jobs"
              />
            </label>
          </div>
          <div className="outlook-form-actions">
            <button type="button" onClick={cancelForm} disabled={Boolean(busy)}>
              Cancel
            </button>
            <button type="submit" disabled={Boolean(busy)}>
              {busy?.action === "save"
                ? "Testing…"
                : editingConnection
                  ? "Test and save"
                  : "Test and connect"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
