import { useEffect, useState, type FormEvent } from "react";

import {
  browserAuthClient,
  AuthClientError,
  type AuthClient,
  type AuthenticatedSession,
} from "./auth_client";
import {
  browserApplicationsClient,
  ApplicationsClientError,
  type ApplicationRecord,
  type ApplicationsClient,
  type ApplicationStatus,
  type CreateApplicationInput,
} from "./applications_client";
import {
  browserMcpStatusClient,
  type McpStatus,
  type McpStatusClient,
} from "./mcp_status_client";
import {
  browserSetupClient,
  SetupClientError,
  type InitialSetupInput,
  type SetupClient,
} from "./setup_client";
import {
  browserUsersClient,
  UsersClientError,
  type CreateLocalUserInput,
  type ManagedUser,
  type UsersClient,
} from "./users_client";

const buildSteps = [
  {
    label: "Foundation",
    status: "Ready",
    summary: "Typed runtime, accessible shell, and automated quality gates.",
  },
  {
    label: "Identity",
    status: "Ready",
    summary: "Closed administrator setup and revocable local sessions.",
  },
  {
    label: "Application ledger",
    status: "Active",
    summary: "Workspace-scoped application intake and review.",
  },
] as const;

type ReadyPage =
  "applications" | "overview" | "settings-mcp" | "settings-users";

type AppView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "setup"; tokenConfigured: boolean }
  | { kind: "login"; notice?: string }
  | {
      kind: "ready";
      logoutError?: string;
      notice?: string;
      page: ReadyPage;
      session: AuthenticatedSession;
      signingOut: boolean;
    };

interface AppProps {
  applicationsClient?: ApplicationsClient;
  authClient?: AuthClient;
  mcpStatusClient?: McpStatusClient;
  setupClient?: SetupClient;
  usersClient?: UsersClient;
}

export function App({
  applicationsClient = browserApplicationsClient,
  authClient = browserAuthClient,
  mcpStatusClient = browserMcpStatusClient,
  setupClient = browserSetupClient,
  usersClient = browserUsersClient,
}: AppProps) {
  const [view, setView] = useState<AppView>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await setupClient.getStatus();
        if (!active) return;
        if (status.required) {
          setView({
            kind: "setup",
            tokenConfigured: status.tokenConfigured,
          });
          return;
        }

        const session = await authClient.getSession();
        if (!active) return;
        setView(
          session.authenticated
            ? {
                kind: "ready",
                page: "overview",
                session,
                signingOut: false,
              }
            : { kind: "login" },
        );
      } catch {
        if (active) setView({ kind: "error" });
      }
    })();

    return () => {
      active = false;
    };
  }, [authClient, setupClient]);

  function signOut() {
    if (view.kind !== "ready" || view.signingOut) return;
    const currentSession = view.session;
    const currentPage = view.page;
    setView({
      kind: "ready",
      page: currentPage,
      session: currentSession,
      signingOut: true,
    });
    void authClient
      .logout()
      .then(() =>
        setView({ kind: "login", notice: "You have signed out safely." }),
      )
      .catch(() =>
        setView({
          kind: "ready",
          logoutError: "Sign out could not be completed. Please try again.",
          page: currentPage,
          session: currentSession,
          signingOut: false,
        }),
      );
  }

  function navigate(page: ReadyPage) {
    if (view.kind !== "ready") return;
    setView({
      kind: "ready",
      page,
      session: view.session,
      signingOut: view.signingOut,
    });
  }

  const isSetup = view.kind === "setup";
  const isLogin = view.kind === "login";
  const statusLabel =
    view.kind === "loading"
      ? "Checking installation"
      : isSetup
        ? "Setup required"
        : isLogin
          ? "Sign in required"
          : view.kind === "ready"
            ? "Signed in"
            : "Connection unavailable";
  const session = view.kind === "ready" ? view.session : undefined;

  return (
    <div className="app-shell">
      <Masthead
        onLogout={view.kind === "ready" ? signOut : undefined}
        session={session}
        signingOut={view.kind === "ready" && view.signingOut}
        statusLabel={statusLabel}
      />
      <div
        className={`workspace-frame${isSetup || isLogin ? " identity-frame" : ""}`}
      >
        <Sidebar
          activePage={view.kind === "ready" ? view.page : "overview"}
          canManageUsers={
            view.kind === "ready" && view.session.user.role === "admin"
          }
          mode={isSetup ? "setup" : isLogin ? "login" : "workspace"}
          onNavigate={navigate}
        />
        {view.kind === "loading" && <LoadingView />}
        {view.kind === "error" && <StatusErrorView />}
        {view.kind === "setup" && !view.tokenConfigured && <MissingTokenView />}
        {view.kind === "setup" && view.tokenConfigured && (
          <SetupView
            setupClient={setupClient}
            onComplete={() =>
              setView({
                kind: "login",
                notice: "Administrator created. Sign in with your new account.",
              })
            }
          />
        )}
        {view.kind === "login" && (
          <LoginView
            authClient={authClient}
            onAuthenticated={(authenticated) =>
              setView({
                kind: "ready",
                notice: `Welcome, ${authenticated.user.displayName}.`,
                page: "overview",
                session: authenticated,
                signingOut: false,
              })
            }
            {...(view.notice ? { notice: view.notice } : {})}
          />
        )}
        {view.kind === "ready" && view.page === "overview" && (
          <Overview
            session={view.session}
            {...(view.logoutError ? { error: view.logoutError } : {})}
            {...(view.notice ? { notice: view.notice } : {})}
          />
        )}
        {view.kind === "ready" && view.page === "applications" && (
          <ApplicationsView applicationsClient={applicationsClient} />
        )}
        {view.kind === "ready" && view.page === "settings-users" && (
          <UsersSettingsView navigate={navigate} usersClient={usersClient} />
        )}
        {view.kind === "ready" && view.page === "settings-mcp" && (
          <McpSettingsView
            mcpStatusClient={mcpStatusClient}
            navigate={navigate}
          />
        )}
      </div>
    </div>
  );
}

function Masthead({
  onLogout,
  session,
  signingOut,
  statusLabel,
}: {
  onLogout: (() => void) | undefined;
  session: AuthenticatedSession | undefined;
  signingOut: boolean;
  statusLabel: string;
}) {
  return (
    <header className="masthead">
      <a
        className="brand"
        href="#main-content"
        aria-label="Application Tracker home"
      >
        <span className="brand-mark" aria-hidden="true">
          AT
        </span>
        <span className="brand-copy">
          <strong>Application Tracker</strong>
          <span>Private application ledger</span>
        </span>
      </a>
      <div className="masthead-actions">
        {session && (
          <div className="account-summary">
            <span>
              <strong>{session.user.displayName}</strong>
              <small>{session.user.role}</small>
            </span>
            <button type="button" disabled={signingOut} onClick={onLogout}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
        <div className="build-label" aria-label="Installation status">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </div>
      </div>
    </header>
  );
}

function Sidebar({
  activePage,
  canManageUsers,
  mode,
  onNavigate,
}: {
  activePage: ReadyPage;
  canManageUsers: boolean;
  mode: "login" | "setup" | "workspace";
  onNavigate: (page: ReadyPage) => void;
}) {
  if (mode !== "workspace") {
    return (
      <aside className="sidebar setup-sidebar">
        <p className="sidebar-label">Installation</p>
        <nav aria-label="Primary navigation">
          <ul>
            {mode === "setup" ? (
              <>
                <li>
                  <a href="#main-content" aria-current="page">
                    <span>01</span>
                    Administrator
                  </a>
                </li>
                <li>
                  <span className="future-navigation" aria-disabled="true">
                    <span>02</span>
                    Sign in
                    <small>next</small>
                  </span>
                </li>
              </>
            ) : (
              <>
                <li>
                  <span className="completed-navigation">
                    <span>01</span>
                    Administrator
                    <small>ready</small>
                  </span>
                </li>
                <li>
                  <a href="#main-content" aria-current="page">
                    <span>02</span>
                    Sign in
                  </a>
                </li>
              </>
            )}
          </ul>
        </nav>
        <p className="privacy-note">
          <span aria-hidden="true">●</span>
          Closed by default
        </p>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <p className="sidebar-label">Workspace</p>
      <nav aria-label="Primary navigation">
        <ul>
          <li>
            <button
              type="button"
              aria-current={activePage === "overview" ? "page" : undefined}
              className={activePage === "overview" ? "active-navigation" : ""}
              onClick={() => onNavigate("overview")}
            >
              <span aria-hidden="true">01</span>
              Overview
            </button>
          </li>
          <li>
            <button
              type="button"
              aria-current={activePage === "applications" ? "page" : undefined}
              className={
                activePage === "applications" ? "active-navigation" : ""
              }
              onClick={() => onNavigate("applications")}
            >
              <span aria-hidden="true">02</span>
              Applications
            </button>
          </li>
          <li>
            <span className="future-navigation" aria-disabled="true">
              <span>03</span>
              Documents
              <small>soon</small>
            </span>
          </li>
          <li>
            {canManageUsers ? (
              <button
                type="button"
                aria-current={
                  activePage.startsWith("settings-") ? "page" : undefined
                }
                className={
                  activePage.startsWith("settings-") ? "active-navigation" : ""
                }
                onClick={() => onNavigate("settings-users")}
              >
                <span aria-hidden="true">04</span>
                Settings
              </button>
            ) : (
              <span className="future-navigation" aria-disabled="true">
                <span>04</span>
                Settings
                <small>admin</small>
              </span>
            )}
          </li>
        </ul>
      </nav>
      <p className="privacy-note">
        <span aria-hidden="true">●</span>
        Local by default
      </p>
    </aside>
  );
}

function LoadingView() {
  return (
    <main id="main-content" tabIndex={-1} className="status-view">
      <p className="eyebrow">Installation state</p>
      <h1>Opening your ledger.</h1>
      <p>Checking whether this installation needs its first administrator.</p>
    </main>
  );
}

function StatusErrorView() {
  return (
    <main id="main-content" tabIndex={-1} className="status-view">
      <p className="eyebrow">Connection unavailable</p>
      <h1>Application Tracker could not start.</h1>
      <p>Confirm that the server is running, then reload this page.</p>
    </main>
  );
}

function MissingTokenView() {
  return (
    <main id="main-content" tabIndex={-1} className="setup-main">
      <section className="setup-intro" aria-labelledby="setup-title">
        <p className="eyebrow">Closed first-run setup · Step 01</p>
        <h1 id="setup-title">A setup token is required.</h1>
        <p className="lede">
          This installation is empty and closed. Its operator must generate a
          one-time token before an administrator can be created.
        </p>
      </section>
      <section className="operator-card" aria-labelledby="operator-title">
        <span className="index-number">01</span>
        <div>
          <h2 id="operator-title">Operator action</h2>
          <p>
            Generate a token with <code>openssl rand -hex 32</code>, set it as
            <code> SETUP_TOKEN</code>, and restart Application Tracker.
          </p>
          <p>No account or default password has been created.</p>
        </div>
      </section>
    </main>
  );
}

function LoginView({
  authClient,
  notice,
  onAuthenticated,
}: {
  authClient: AuthClient;
  notice?: string;
  onAuthenticated: (session: AuthenticatedSession) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    void authClient
      .login({ password, username })
      .then(onAuthenticated)
      .catch((caught: unknown) => {
        const message =
          caught instanceof AuthClientError &&
          caught.code === "invalid_credentials"
            ? "The username or password was not accepted."
            : "Sign in could not be completed. Check the connection and try again.";
        setError(message);
        setPassword("");
        setSubmitting(false);
      });
  }

  return (
    <main id="main-content" tabIndex={-1} className="login-main">
      {notice && (
        <div className="success-notice login-notice" role="status">
          {notice}
        </div>
      )}
      <div className="login-layout">
        <section className="login-intro" aria-labelledby="login-title">
          <p className="eyebrow">Local identity · Step 02</p>
          <h1 id="login-title">Sign in to your workspace.</h1>
          <p className="lede">
            Continue to the private ledger with the local account created for
            this installation.
          </p>
          <dl className="session-details">
            <div>
              <dt>Credential storage</dt>
              <dd>One-way password hash</dd>
            </div>
            <div>
              <dt>Browser session</dt>
              <dd>HttpOnly cookie</dd>
            </div>
            <div>
              <dt>Account recovery</dt>
              <dd>Operator controlled</dd>
            </div>
          </dl>
        </section>

        <form
          className="login-form"
          aria-labelledby="credentials-title"
          onSubmit={submit}
        >
          <div className="login-form-heading">
            <span className="index-number">02</span>
            <div>
              <p className="eyebrow">Workspace credentials</p>
              <h2 id="credentials-title">Local account</h2>
            </div>
          </div>
          <div className="field">
            <label htmlFor="login-username">Username</label>
            <input
              autoCapitalize="none"
              autoComplete="username"
              autoFocus
              id="login-username"
              maxLength={64}
              minLength={3}
              required
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              autoComplete="current-password"
              id="login-password"
              maxLength={128}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="login-actions">
            <p>
              Credentials stay in this request and are never stored by the
              browser app.
            </p>
            <button type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function SetupView({
  onComplete,
  setupClient,
}: {
  onComplete: () => void;
  setupClient: SetupClient;
}) {
  const [form, setForm] = useState<InitialSetupInput>({
    displayName: "",
    password: "",
    setupToken: "",
    username: "",
    workspaceName: "Applications",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function update(field: keyof InitialSetupInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    void setupClient
      .completeSetup(form)
      .then(() => onComplete())
      .catch((caught: unknown) => {
        const message =
          caught instanceof SetupClientError &&
          caught.code === "invalid_setup_token"
            ? "The one-time setup token did not match."
            : "Setup could not be completed. Check the details and try again.";
        setError(message);
        setSubmitting(false);
      });
  }

  return (
    <main id="main-content" tabIndex={-1} className="setup-main">
      <section className="setup-intro" aria-labelledby="setup-title">
        <p className="eyebrow">Closed first-run setup · Step 01</p>
        <h1 id="setup-title">Create the first administrator.</h1>
        <p className="lede">
          Name the private workspace and create its local recovery account. No
          known or generated default password is used.
        </p>
      </section>

      <form
        className="setup-form"
        aria-labelledby="form-title"
        onSubmit={submit}
      >
        <div className="form-heading">
          <span className="index-number">01</span>
          <div>
            <p className="eyebrow">Administrator record</p>
            <h2 id="form-title">Workspace identity</h2>
          </div>
        </div>

        <div className="field-grid">
          <div className="field field-wide">
            <label htmlFor="workspace-name">Workspace name</label>
            <input
              autoComplete="organization"
              id="workspace-name"
              maxLength={120}
              required
              value={form.workspaceName}
              onChange={(event) => update("workspaceName", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="display-name">Display name</label>
            <input
              autoComplete="name"
              id="display-name"
              maxLength={120}
              required
              value={form.displayName}
              onChange={(event) => update("displayName", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              autoCapitalize="none"
              autoComplete="username"
              id="username"
              maxLength={64}
              minLength={3}
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
              required
              spellCheck={false}
              value={form.username}
              onChange={(event) => update("username", event.target.value)}
            />
          </div>
          <div className="field field-wide">
            <label htmlFor="new-password">Password</label>
            <input
              aria-describedby="password-help"
              autoComplete="new-password"
              id="new-password"
              maxLength={128}
              minLength={12}
              required
              type="password"
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
            />
            <small id="password-help">
              Use at least 12 characters. A longer passphrase is welcome.
            </small>
          </div>
          <div className="field field-wide">
            <label htmlFor="setup-token">One-time setup token</label>
            <input
              aria-describedby="setup-token-help"
              autoComplete="off"
              id="setup-token"
              maxLength={512}
              minLength={32}
              required
              spellCheck={false}
              type="password"
              value={form.setupToken}
              onChange={(event) => update("setupToken", event.target.value)}
            />
            <small id="setup-token-help">
              The token is compared in constant time and is never stored.
            </small>
          </div>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <p>
            The workspace, user, credential, and admin role are created
            together.
          </p>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create administrator"}
          </button>
        </div>
      </form>
    </main>
  );
}

interface ApplicationFormState {
  appliedOn: string;
  companyName: string;
  location: string;
  notes: string;
  roleTitle: string;
  sourceUrl: string;
  status: ApplicationStatus;
}

const emptyApplicationForm: ApplicationFormState = {
  appliedOn: "",
  companyName: "",
  location: "",
  notes: "",
  roleTitle: "",
  sourceUrl: "",
  status: "prospect",
};

type ApplicationTextField = Exclude<keyof ApplicationFormState, "status">;

function applicationInput(form: ApplicationFormState): CreateApplicationInput {
  const appliedOn = form.appliedOn.trim();
  const location = form.location.trim();
  const notes = form.notes.trim();
  const sourceUrl = form.sourceUrl.trim();
  return {
    companyName: form.companyName.trim(),
    roleTitle: form.roleTitle.trim(),
    status: form.status,
    ...(appliedOn ? { appliedOn } : {}),
    ...(location ? { location } : {}),
    ...(notes ? { notes } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function ApplicationsView({
  applicationsClient,
}: {
  applicationsClient: ApplicationsClient;
}) {
  const [applications, setApplications] = useState<ApplicationRecord[]>();
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<ApplicationFormState>(emptyApplicationForm);
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

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

  function updateText(field: ApplicationTextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    setNotice(undefined);
    void applicationsClient
      .createApplication(applicationInput(form))
      .then((created) => {
        setApplications((current) => [created, ...(current ?? [])]);
        setForm(emptyApplicationForm);
        setNotice(`${created.companyName} was added to the ledger.`);
        setSubmitting(false);
      })
      .catch((caught: unknown) => {
        setFormError(
          caught instanceof ApplicationsClientError &&
            caught.code === "validation_error"
            ? "Review the application details and try again."
            : "The application could not be added. Please try again.",
        );
        setSubmitting(false);
      });
  }

  const openCount = applications?.filter(
    (application) => application.status !== "closed",
  ).length;
  const interviewCount = applications?.filter(
    (application) => application.status === "interview",
  ).length;

  return (
    <main id="main-content" tabIndex={-1} className="applications-main">
      <section
        className="application-hero"
        aria-labelledby="applications-title"
      >
        <div>
          <p className="eyebrow">Workspace · Application records</p>
          <h1 id="applications-title">Application ledger.</h1>
          <p className="lede">
            Record each opportunity once. Stage changes, history, actions, and
            outcomes follow in later ledger chapters.
          </p>
        </div>
        <dl className="application-totals" aria-label="Application summary">
          <div>
            <dt>Records</dt>
            <dd>{applications?.length ?? "—"}</dd>
          </div>
          <div>
            <dt>Open</dt>
            <dd>{openCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Interviews</dt>
            <dd>{interviewCount ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {notice && (
        <div className="ledger-notice" role="status">
          {notice}
        </div>
      )}

      <div className="application-workspace">
        <section
          className="application-register"
          aria-labelledby="register-title"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Opportunity register</p>
              <h2 id="register-title">Current records</h2>
            </div>
            <span>{applications?.length ?? 0} filed</span>
          </div>

          {!applications && !loadError && (
            <p className="panel-state">Opening the ledger…</p>
          )}
          {loadError && (
            <p className="form-error" role="alert">
              Applications could not be loaded. Reload the page to try again.
            </p>
          )}
          {applications?.length === 0 && (
            <div className="empty-ledger">
              <span aria-hidden="true">00</span>
              <div>
                <h3>The ledger is empty.</h3>
                <p>Add the first opportunity with the intake form.</p>
              </div>
            </div>
          )}
          {applications && applications.length > 0 && (
            <ol className="application-list">
              {applications.map((application, index) => (
                <li key={application.id}>
                  <span className="application-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <article>
                    <header>
                      <div>
                        <h3>{application.companyName}</h3>
                        <p>{application.roleTitle}</p>
                      </div>
                      <span data-stage={application.status}>
                        {titleCase(application.status)}
                      </span>
                    </header>
                    <dl className="application-details">
                      <div>
                        <dt>Location</dt>
                        <dd>{application.location ?? "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Applied</dt>
                        <dd>{application.appliedOn ?? "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Listing</dt>
                        <dd>
                          {application.sourceUrl ? (
                            <a
                              href={application.sourceUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open source
                            </a>
                          ) : (
                            "Not recorded"
                          )}
                        </dd>
                      </div>
                    </dl>
                    {application.notes && (
                      <p className="application-notes">{application.notes}</p>
                    )}
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>

        <form
          className="application-intake"
          aria-labelledby="application-intake-title"
          onSubmit={submit}
        >
          <div className="panel-heading intake-heading">
            <div>
              <p className="eyebrow">New opportunity</p>
              <h2 id="application-intake-title">Add an application</h2>
            </div>
            <span className="index-number">+</span>
          </div>
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
              onChange={(event) => updateText("roleTitle", event.target.value)}
            />
          </div>
          <div className="intake-pair">
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
          <div className="field">
            <label htmlFor="application-location">Location</label>
            <input
              autoComplete="off"
              id="application-location"
              maxLength={160}
              value={form.location}
              onChange={(event) => updateText("location", event.target.value)}
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
              onChange={(event) => updateText("sourceUrl", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="application-notes">Notes</label>
            <textarea
              id="application-notes"
              maxLength={5000}
              rows={4}
              value={form.notes}
              onChange={(event) => updateText("notes", event.target.value)}
            />
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="application-intake-actions">
            <p>You can add history and follow-up details in later stages.</p>
            <button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add application"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

const emptyUserForm: CreateLocalUserInput = {
  displayName: "",
  password: "",
  role: "member",
  username: "",
};

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function SettingsNavigation({
  activePage,
  navigate,
}: {
  activePage: "settings-mcp" | "settings-users";
  navigate: (page: ReadyPage) => void;
}) {
  return (
    <nav className="settings-navigation" aria-label="Settings navigation">
      <span aria-disabled="true">
        <small>01</small>
        Lists
        <em>planned</em>
      </span>
      <button
        type="button"
        aria-current={activePage === "settings-users" ? "page" : undefined}
        onClick={() => navigate("settings-users")}
      >
        <small aria-hidden="true">02</small>
        Users
      </button>
      <button
        type="button"
        aria-current={activePage === "settings-mcp" ? "page" : undefined}
        onClick={() => navigate("settings-mcp")}
      >
        <small aria-hidden="true">03</small>
        MCP
      </button>
    </nav>
  );
}

function UsersSettingsView({
  navigate,
  usersClient,
}: {
  navigate: (page: ReadyPage) => void;
  usersClient: UsersClient;
}) {
  const [users, setUsers] = useState<ManagedUser[]>();
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<CreateLocalUserInput>(emptyUserForm);
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string>();
  const [statusError, setStatusError] = useState<string>();

  useEffect(() => {
    let active = true;
    void usersClient
      .listUsers()
      .then((loadedUsers) => {
        if (active) setUsers(loadedUsers);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [usersClient]);

  function updateForm(field: keyof CreateLocalUserInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    setNotice(undefined);
    void usersClient
      .createUser(form)
      .then((created) => {
        setUsers((current) => (current ? [...current, created] : [created]));
        setForm(emptyUserForm);
        setNotice(`${created.displayName} is ready to sign in.`);
        setSubmitting(false);
      })
      .catch((caught: unknown) => {
        const message =
          caught instanceof UsersClientError &&
          caught.code === "username_unavailable"
            ? "That username is already in use."
            : "The account could not be created. Please try again.";
        setForm((current) => ({ ...current, password: "" }));
        setFormError(message);
        setSubmitting(false);
      });
  }

  function changeStatus(user: ManagedUser) {
    if (pendingUserId) return;
    const nextStatus = user.status === "active" ? "disabled" : "active";
    setPendingUserId(user.id);
    setStatusError(undefined);
    setNotice(undefined);
    void usersClient
      .setStatus(user.id, nextStatus)
      .then((updated) => {
        setUsers((current) =>
          current?.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        );
        setNotice(
          nextStatus === "disabled"
            ? `${updated.displayName} can no longer sign in.`
            : `${updated.displayName} can sign in again.`,
        );
        setPendingUserId(undefined);
      })
      .catch(() => {
        setStatusError("The account status could not be changed.");
        setPendingUserId(undefined);
      });
  }

  const activeCount = users?.filter((user) => user.status === "active").length;
  const adminCount = users?.filter((user) => user.role === "admin").length;

  return (
    <main id="main-content" tabIndex={-1} className="settings-main">
      <section className="settings-hero" aria-labelledby="settings-title">
        <div>
          <p className="eyebrow">Settings · Local identity</p>
          <h1 id="settings-title">Users and access.</h1>
          <p className="lede">
            Decide who can enter this workspace, what they can administer, and
            when their access should stop.
          </p>
        </div>
        <dl className="settings-totals" aria-label="Account summary">
          <div>
            <dt>Accounts</dt>
            <dd>{users?.length ?? "—"}</dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd>{activeCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Admins</dt>
            <dd>{adminCount ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <SettingsNavigation activePage="settings-users" navigate={navigate} />

      {notice && (
        <div className="settings-notice" role="status">
          {notice}
        </div>
      )}
      {statusError && (
        <div className="settings-error" role="alert">
          {statusError}
        </div>
      )}

      <div className="users-workspace" id="users-panel">
        <section className="users-roster" aria-labelledby="roster-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Workspace directory</p>
              <h2 id="roster-title">Local accounts</h2>
            </div>
            <span>{users?.length ?? 0} total</span>
          </div>

          {!users && !loadError && (
            <p className="panel-state">Loading accounts…</p>
          )}
          {loadError && (
            <p className="form-error" role="alert">
              Accounts could not be loaded. Reload the page to try again.
            </p>
          )}
          {users && (
            <ul className="user-list">
              {users.map((user, index) => (
                <li key={user.id}>
                  <span className="user-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="user-identity">
                    <div>
                      <strong>{user.displayName}</strong>
                      {user.isCurrentUser && <span>Current session</span>}
                    </div>
                    <p>@{user.username}</p>
                    <small>
                      {user.localAccount
                        ? "Local password"
                        : "External identity"}
                    </small>
                  </div>
                  <div className="user-badges">
                    <span data-role={user.role}>{titleCase(user.role)}</span>
                    <span data-status={user.status}>
                      {titleCase(user.status)}
                    </span>
                  </div>
                  <div className="user-action">
                    {user.isCurrentUser ? (
                      <span>Protected</span>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingUserId !== undefined}
                        onClick={() => changeStatus(user)}
                        aria-label={`${user.status === "active" ? "Disable" : "Enable"} ${user.displayName}`}
                      >
                        {pendingUserId === user.id
                          ? "Saving…"
                          : user.status === "active"
                            ? "Disable"
                            : "Enable"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          className="create-user-form"
          aria-labelledby="create-user-title"
          onSubmit={createUser}
        >
          <div className="panel-heading create-heading">
            <div>
              <p className="eyebrow">New workspace identity</p>
              <h2 id="create-user-title">Add a local account</h2>
            </div>
            <span className="index-number">+</span>
          </div>
          <div className="field">
            <label htmlFor="user-display-name">Display name</label>
            <input
              autoComplete="off"
              id="user-display-name"
              maxLength={120}
              required
              value={form.displayName}
              onChange={(event) =>
                updateForm("displayName", event.target.value)
              }
            />
          </div>
          <div className="field">
            <label htmlFor="user-username">Username</label>
            <input
              autoCapitalize="none"
              autoComplete="off"
              id="user-username"
              maxLength={64}
              minLength={3}
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
              required
              spellCheck={false}
              value={form.username}
              onChange={(event) => updateForm("username", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="user-password">Password</label>
            <input
              aria-describedby="user-password-help"
              autoComplete="new-password"
              id="user-password"
              maxLength={128}
              minLength={12}
              required
              type="password"
              value={form.password}
              onChange={(event) => updateForm("password", event.target.value)}
            />
            <small id="user-password-help">12 to 128 characters.</small>
          </div>
          <div className="field">
            <label htmlFor="user-role">Workspace role</label>
            <select
              id="user-role"
              value={form.role}
              onChange={(event) => updateForm("role", event.target.value)}
            >
              <option value="member">Member</option>
              <option value="admin">Administrator</option>
            </select>
            <small>
              Administrators can manage users and security settings.
            </small>
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="create-user-actions">
            <p>
              No welcome email is sent. Share credentials through a safe
              channel.
            </p>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
}

function statusLabel(value: string): string {
  return value.split("_").map(titleCase).join(" ");
}

function McpSettingsView({
  mcpStatusClient,
  navigate,
}: {
  mcpStatusClient: McpStatusClient;
  navigate: (page: ReadyPage) => void;
}) {
  const [status, setStatus] = useState<McpStatus>();
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void mcpStatusClient
      .getStatus()
      .then((loadedStatus) => {
        if (active) setStatus(loadedStatus);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [mcpStatusClient]);

  return (
    <main id="main-content" tabIndex={-1} className="settings-main">
      <section className="settings-hero mcp-hero" aria-labelledby="mcp-title">
        <div>
          <p className="eyebrow">Settings · Protocol boundary</p>
          <h1 id="mcp-title">MCP, without blind spots.</h1>
          <p className="lede">
            Inspect the Model Context Protocol boundary without revealing
            deployment addresses, identity claims, credentials, or internal
            topology.
          </p>
        </div>
        <dl className="settings-totals" aria-label="MCP summary">
          <div>
            <dt>Runtime</dt>
            <dd className="status-word">
              {status ? statusLabel(status.availability) : "—"}
            </dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd>{status?.sessions.active ?? "—"}</dd>
          </div>
          <div>
            <dt>Tools</dt>
            <dd>{status?.capabilities.registeredTools ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <SettingsNavigation activePage="settings-mcp" navigate={navigate} />

      {loadError && (
        <div className="settings-error" role="alert">
          MCP status could not be loaded. Reload the page to try again.
        </div>
      )}

      {!status && !loadError && (
        <p className="mcp-loading">Reading the protocol boundary…</p>
      )}

      {status && (
        <div className="mcp-workspace">
          <section className="mcp-ledger" aria-labelledby="transport-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Transport register</p>
                <h2 id="transport-title">Closed until implemented</h2>
              </div>
              <span data-state={status.availability}>
                {statusLabel(status.availability)}
              </span>
            </div>
            <p className="mcp-boundary-note">
              The status boundary is ready. No MCP transport or tool is active
              in this build.
            </p>
            <dl className="transport-list">
              <div>
                <dt>
                  <span>01</span>
                  Local process
                  <small>stdio</small>
                </dt>
                <dd data-state={status.transports.local.state}>
                  {statusLabel(status.transports.local.state)}
                </dd>
              </div>
              <div>
                <dt>
                  <span>02</span>
                  Remote clients
                  <small>Streamable HTTP</small>
                </dt>
                <dd data-state={status.transports.remote.state}>
                  {statusLabel(status.transports.remote.state)}
                </dd>
              </div>
            </dl>
          </section>

          <aside className="mcp-policy" aria-labelledby="policy-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Future session policy</p>
                <h2 id="policy-title">Configured, not enforced</h2>
              </div>
              <span>{status.sessions.globalLimit} session ceiling</span>
            </div>
            <p>
              These values are ready for the session registry planned in the
              next MCP implementation stage.
            </p>
            <dl className="policy-list">
              <div>
                <dt>Global limit</dt>
                <dd>{status.sessions.globalLimit}</dd>
              </div>
              <div>
                <dt>Per actor</dt>
                <dd>{status.sessions.perActorLimit}</dd>
              </div>
              <div>
                <dt>Idle expiry</dt>
                <dd>{formatDuration(status.sessions.idleTimeoutSeconds)}</dd>
              </div>
              <div>
                <dt>Absolute expiry</dt>
                <dd>
                  {formatDuration(status.sessions.absoluteLifetimeSeconds)}
                </dd>
              </div>
            </dl>
            <ul className="capability-list" aria-label="MCP security controls">
              <li data-ready={status.capabilities.oauthVerification}>
                <span>OAuth verification</span>
                <strong>
                  {status.capabilities.oauthVerification ? "Ready" : "Pending"}
                </strong>
              </li>
              <li data-ready={status.capabilities.auditEvents}>
                <span>Audit events</span>
                <strong>
                  {status.capabilities.auditEvents ? "Ready" : "Pending"}
                </strong>
              </li>
              <li data-ready={status.sessions.enforcement === "active"}>
                <span>Session enforcement</span>
                <strong>
                  {status.sessions.enforcement === "active"
                    ? "Active"
                    : "Pending"}
                </strong>
              </li>
            </ul>
          </aside>
        </div>
      )}
    </main>
  );
}

function Overview({
  error,
  notice,
  session,
}: {
  error?: string;
  notice?: string;
  session: AuthenticatedSession;
}) {
  return (
    <main id="main-content" tabIndex={-1}>
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="error-notice" role="alert">
          {error}
        </div>
      )}
      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">
            {session.workspace.name} · Application ledger · Build 007
          </p>
          <h1 id="page-title">Your search, kept in order.</h1>
          <p className="lede">
            A calm, self-hosted record for every application, conversation,
            document, decision, and next move.
          </p>
        </div>
        <div className="index-card" aria-label="Foundation summary">
          <span className="index-number">03</span>
          <div>
            <p>Current chapter</p>
            <strong>Application ledger</strong>
            <span>Workspace-scoped intake and records are ready.</span>
          </div>
        </div>
      </section>

      <section className="build-sequence" aria-labelledby="sequence-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Reconstruction sequence</p>
            <h2 id="sequence-title">Built in inspectable layers</h2>
          </div>
          <p>
            Each stage remains buildable, tested, and free from private
            deployment details.
          </p>
        </div>

        <ol className="sequence-list">
          {buildSteps.map((step, index) => (
            <li key={step.label} data-state={step.status.toLowerCase()}>
              <span className="sequence-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="sequence-copy">
                <div>
                  <h3>{step.label}</h3>
                  <span className="step-status">{step.status}</span>
                </div>
                <p>{step.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="page-footer">
        <p>Designed for one private workspace. Ready to grow deliberately.</p>
        <span>Application Tracker / Ledger</span>
      </footer>
    </main>
  );
}
