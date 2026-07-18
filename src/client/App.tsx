import { useEffect, useState, type FormEvent } from "react";

import {
  browserAuthClient,
  AuthClientError,
  type AuthClient,
  type AuthenticatedSession,
} from "./auth_client";
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
    status: "Next",
    summary: "Applications, events, documents, actions, and outcomes.",
  },
] as const;

type ReadyPage = "overview" | "settings-users";

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
  authClient?: AuthClient;
  setupClient?: SetupClient;
  usersClient?: UsersClient;
}

export function App({
  authClient = browserAuthClient,
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
        {view.kind === "ready" && view.page === "settings-users" && (
          <UsersSettingsView usersClient={usersClient} />
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
            <span className="future-navigation" aria-disabled="true">
              <span>02</span>
              Applications
              <small>soon</small>
            </span>
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
                  activePage === "settings-users" ? "page" : undefined
                }
                className={
                  activePage === "settings-users" ? "active-navigation" : ""
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

const emptyUserForm: CreateLocalUserInput = {
  displayName: "",
  password: "",
  role: "member",
  username: "",
};

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function UsersSettingsView({ usersClient }: { usersClient: UsersClient }) {
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

      <nav className="settings-navigation" aria-label="Settings navigation">
        <span aria-disabled="true">
          <small>01</small>
          Lists
          <em>planned</em>
        </span>
        <a href="#users-panel" aria-current="page">
          <small>02</small>
          Users
        </a>
        <span aria-disabled="true">
          <small>03</small>
          MCP
          <em>next</em>
        </span>
      </nav>

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
            {session.workspace.name} · Application ledger · Build 005
          </p>
          <h1 id="page-title">Your search, kept in order.</h1>
          <p className="lede">
            A calm, self-hosted record for every application, conversation,
            document, decision, and next move.
          </p>
        </div>
        <div className="index-card" aria-label="Foundation summary">
          <span className="index-number">02</span>
          <div>
            <p>Current chapter</p>
            <strong>Local identity</strong>
            <span>Administrator setup and browser sessions are ready.</span>
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
        <span>Application Tracker / Identity</span>
      </footer>
    </main>
  );
}
