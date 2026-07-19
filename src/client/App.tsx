import { useEffect, useState, type FormEvent } from "react";

import {
  browserAuthClient,
  AuthClientError,
  type AuthClient,
  type AuthenticatedSession,
} from "./auth_client";
import {
  browserApplicationsClient,
  type ApplicationsClient,
} from "./applications_client";
import { ApplicationWorkspace } from "./application_workspace";
import {
  browserDocumentsClient,
  type DocumentsClient,
} from "./documents_client";
import { DocumentsWorkspace } from "./documents_workspace";
import {
  browserEmailLinksClient,
  type EmailLinksClient,
} from "./email_links_client";
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
import {
  browserReferenceValuesClient,
  ReferenceValuesClientError,
  type ReferenceCategory,
  type ReferenceValue,
  type ReferenceValuesClient,
} from "./reference_values_client";

type ReadyPage =
  | "applications"
  | "documents"
  | "overview"
  | "settings-lists"
  | "settings-mcp"
  | "settings-users";

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
  documentsClient?: DocumentsClient;
  emailLinksClient?: EmailLinksClient;
  mcpStatusClient?: McpStatusClient;
  referenceValuesClient?: ReferenceValuesClient;
  setupClient?: SetupClient;
  usersClient?: UsersClient;
}

export function App({
  applicationsClient = browserApplicationsClient,
  authClient = browserAuthClient,
  documentsClient = browserDocumentsClient,
  emailLinksClient = browserEmailLinksClient,
  mcpStatusClient = browserMcpStatusClient,
  referenceValuesClient = browserReferenceValuesClient,
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
    <div
      className={`app-shell${
        view.kind === "ready" ? " workspace-app-shell" : ""
      }`}
    >
      {view.kind !== "ready" && (
        <Masthead
          onLogout={undefined}
          session={session}
          signingOut={false}
          statusLabel={statusLabel}
        />
      )}
      <div
        className={`workspace-frame${isSetup || isLogin ? " identity-frame" : ""}`}
      >
        <Sidebar
          activePage={view.kind === "ready" ? view.page : "overview"}
          mode={isSetup ? "setup" : isLogin ? "login" : "workspace"}
          onNavigate={navigate}
          onLogout={view.kind === "ready" ? signOut : undefined}
          session={session}
          signingOut={view.kind === "ready" && view.signingOut}
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
        {view.kind === "ready" &&
          (view.page === "overview" || view.page === "applications") && (
            <ApplicationWorkspace
              applicationsClient={applicationsClient}
              emailLinksClient={emailLinksClient}
              page={view.page}
              referenceValuesClient={referenceValuesClient}
              session={view.session}
              navigate={navigate}
              {...(view.logoutError ? { error: view.logoutError } : {})}
              {...(view.notice ? { notice: view.notice } : {})}
            />
          )}
        {view.kind === "ready" && view.page === "settings-users" && (
          <UsersSettingsView navigate={navigate} usersClient={usersClient} />
        )}
        {view.kind === "ready" && view.page === "documents" && (
          <DocumentsWorkspace
            applicationsClient={applicationsClient}
            documentsClient={documentsClient}
            referenceValuesClient={referenceValuesClient}
          />
        )}
        {view.kind === "ready" && view.page === "settings-lists" && (
          <ListsSettingsView
            canManage={view.session.user.role === "admin"}
            navigate={navigate}
            referenceValuesClient={referenceValuesClient}
          />
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
  mode,
  onNavigate,
  onLogout,
  session,
  signingOut,
}: {
  activePage: ReadyPage;
  mode: "login" | "setup" | "workspace";
  onNavigate: (page: ReadyPage) => void;
  onLogout: (() => void) | undefined;
  session: AuthenticatedSession | undefined;
  signingOut: boolean;
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
    <aside className="sidebar workspace-sidebar">
      <div className="workspace-brand" aria-label="Application Tracker">
        <span aria-hidden="true">AT</span>
        <div>
          <strong>Application Tracker</strong>
          <small>{session?.workspace.name ?? "Workspace"}</small>
        </div>
      </div>
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
              Dashboard
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
            <button
              type="button"
              aria-current={activePage === "documents" ? "page" : undefined}
              className={activePage === "documents" ? "active-navigation" : ""}
              onClick={() => onNavigate("documents")}
            >
              <span aria-hidden="true">03</span>
              Documents
            </button>
          </li>
          <li>
            <button
              type="button"
              aria-current={
                activePage.startsWith("settings-") ? "page" : undefined
              }
              className={
                activePage.startsWith("settings-") ? "active-navigation" : ""
              }
              onClick={() => onNavigate("settings-lists")}
            >
              <span aria-hidden="true">04</span>
              Settings
            </button>
          </li>
        </ul>
      </nav>
      <div className="workspace-account">
        <span className="live-dot" aria-hidden="true" />
        <div>
          <strong>{session?.user.displayName}</strong>
          <small>{session?.user.role} · local account</small>
        </div>
      </div>
      <button
        className="workspace-sign-out"
        type="button"
        disabled={signingOut}
        onClick={onLogout}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
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

function SettingsNavigation({
  activePage,
  canManage,
  navigate,
}: {
  activePage: "settings-lists" | "settings-mcp" | "settings-users";
  canManage: boolean;
  navigate: (page: ReadyPage) => void;
}) {
  return (
    <nav className="settings-navigation" aria-label="Settings navigation">
      <button
        type="button"
        aria-current={activePage === "settings-lists" ? "page" : undefined}
        onClick={() => navigate("settings-lists")}
      >
        <small aria-hidden="true">01</small>
        Lists
      </button>
      {canManage ? (
        <>
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
        </>
      ) : (
        <>
          <span aria-disabled="true">
            <small>02</small>
            Users
            <em>admin</em>
          </span>
          <span aria-disabled="true">
            <small>03</small>
            MCP
            <em>admin</em>
          </span>
        </>
      )}
    </nav>
  );
}

const referenceGroups: ReadonlyArray<{
  category: ReferenceCategory;
  plural: string;
  singular: string;
}> = [
  {
    category: "status",
    plural: "Statuses",
    singular: "status",
  },
  {
    category: "source",
    plural: "Sources",
    singular: "source",
  },
  {
    category: "role_type",
    plural: "Role types",
    singular: "role type",
  },
  {
    category: "document_type",
    plural: "Document types",
    singular: "document type",
  },
];

function listsError(error: unknown): string {
  if (error instanceof ReferenceValuesClientError) {
    if (error.code === "reference_value_conflict") {
      return "That label is already present in this list.";
    }
    if (error.code === "reference_value_required") {
      return "Keep at least one active value in each list and one closed status.";
    }
    if (error.code === "reference_value_in_use") {
      return "This value is used by an application. Disable it to keep history intact.";
    }
  }
  return "The list could not be changed. Please try again.";
}

function ListsSettingsView({
  canManage,
  navigate,
  referenceValuesClient,
}: {
  canManage: boolean;
  navigate: (page: ReadyPage) => void;
  referenceValuesClient: ReferenceValuesClient;
}) {
  const [values, setValues] = useState<ReferenceValue[]>();
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<ReferenceCategory, string>>({
    document_type: "",
    role_type: "",
    source: "",
    status: "",
  });
  const [newStatusTerminal, setNewStatusTerminal] = useState(false);
  const [addingCategory, setAddingCategory] = useState<ReferenceCategory>();
  const [editingId, setEditingId] = useState<string>();
  const [editLabel, setEditLabel] = useState("");
  const [pendingId, setPendingId] = useState<string>();
  const [confirmingId, setConfirmingId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void referenceValuesClient
      .listValues()
      .then((loaded) => {
        if (active) setValues(loaded);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [referenceValuesClient]);

  function replaceValue(updated: ReferenceValue) {
    setValues((current) =>
      current?.map((value) => (value.id === updated.id ? updated : value)),
    );
  }

  function createValue(
    event: FormEvent<HTMLFormElement>,
    category: ReferenceCategory,
  ) {
    event.preventDefault();
    const label = drafts[category].trim();
    if (!label || pendingId) return;
    setError(undefined);
    setNotice(undefined);
    setPendingId(`new-${category}`);
    void referenceValuesClient
      .createValue({
        category,
        isTerminal: category === "status" && newStatusTerminal,
        label,
      })
      .then((created) => {
        setValues((current) => [...(current ?? []), created]);
        setDrafts((current) => ({ ...current, [category]: "" }));
        if (category === "status") setNewStatusTerminal(false);
        setAddingCategory(undefined);
        setNotice(
          `${created.label} was added to ${referenceGroups.find((group) => group.category === category)?.plural.toLowerCase() ?? "the list"}.`,
        );
      })
      .catch((caught: unknown) => setError(listsError(caught)))
      .finally(() => setPendingId(undefined));
  }

  function updateValue(
    value: ReferenceValue,
    input: { isActive?: boolean; isTerminal?: boolean; label?: string },
    success: string,
  ) {
    if (pendingId) return;
    setError(undefined);
    setNotice(undefined);
    setPendingId(value.id);
    void referenceValuesClient
      .updateValue(value.id, input)
      .then((updated) => {
        replaceValue(updated);
        setEditingId(undefined);
        setNotice(success);
      })
      .catch((caught: unknown) => setError(listsError(caught)))
      .finally(() => setPendingId(undefined));
  }

  function deleteValue(value: ReferenceValue) {
    if (pendingId) return;
    setError(undefined);
    setNotice(undefined);
    setPendingId(value.id);
    void referenceValuesClient
      .deleteValue(value.id)
      .then(() => {
        setValues((current) => current?.filter(({ id }) => id !== value.id));
        setConfirmingId(undefined);
        setNotice(`${value.label} was removed.`);
      })
      .catch((caught: unknown) => setError(listsError(caught)))
      .finally(() => setPendingId(undefined));
  }

  return (
    <main id="main-content" tabIndex={-1} className="settings-main">
      <section
        className="settings-hero lists-hero"
        aria-labelledby="lists-title"
      >
        <div>
          <p className="eyebrow">Settings · Workspace vocabulary</p>
          <h1 id="lists-title">Make the tracker fit your search.</h1>
          <p className="lede">
            These values power forms, filters, and MCP tools. Select any value
            to make a change.
          </p>
        </div>
      </section>

      <SettingsNavigation
        activePage="settings-lists"
        canManage={canManage}
        navigate={navigate}
      />

      {!canManage && (
        <p className="settings-notice">
          Only workspace administrators can change these values.
        </p>
      )}
      {notice && (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {loadError && (
        <p className="settings-error" role="alert">
          Lists could not be loaded. Reload the page to try again.
        </p>
      )}
      {!values && !loadError && <p className="mcp-loading">Reading lists…</p>}

      {values && (
        <div className="lists-workspace">
          {referenceGroups.map((group, groupIndex) => {
            const groupValues = values
              .filter(({ category }) => category === group.category)
              .sort((left, right) =>
                left.label.localeCompare(right.label, undefined, {
                  sensitivity: "base",
                }),
              );
            const selectedValue = groupValues.find(
              ({ id }) => id === editingId,
            );
            return (
              <section
                className="reference-group"
                aria-labelledby={`reference-${group.category}`}
                key={group.category}
              >
                <div className="reference-card-heading">
                  <div>
                    <p className="eyebrow">Collection</p>
                    <h2 id={`reference-${group.category}`}>{group.plural}</h2>
                    <small>{groupValues.length} values · A–Z</small>
                  </div>
                  <span aria-hidden="true">
                    {String(groupIndex + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="reference-chip-grid">
                  {groupValues.map((value) =>
                    canManage ? (
                      <button
                        aria-label={`Edit ${value.label}; ${value.isActive ? "active" : "inactive"}${value.isTerminal ? "; closed outcome" : ""}`}
                        aria-pressed={editingId === value.id}
                        data-inactive={!value.isActive}
                        data-terminal={value.isTerminal}
                        key={value.id}
                        onClick={() => {
                          setAddingCategory(undefined);
                          setConfirmingId(undefined);
                          setEditingId(value.id);
                          setEditLabel(value.label);
                        }}
                        type="button"
                      >
                        {value.label}
                      </button>
                    ) : (
                      <span
                        aria-label={`${value.label}; ${value.isActive ? "active" : "inactive"}${value.isTerminal ? "; closed outcome" : ""}`}
                        data-inactive={!value.isActive}
                        data-terminal={value.isTerminal}
                        key={value.id}
                      >
                        {value.label}
                      </span>
                    ),
                  )}
                  {canManage && addingCategory !== group.category && (
                    <button
                      className="reference-add-chip"
                      onClick={() => {
                        setEditingId(undefined);
                        setConfirmingId(undefined);
                        setAddingCategory(group.category);
                      }}
                      type="button"
                      aria-label={`Add ${group.singular}`}
                    >
                      <span aria-hidden="true">+</span> Add value
                    </button>
                  )}
                </div>
                {canManage && selectedValue && (
                  <div className="reference-editor">
                    <form
                      className="reference-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const label = editLabel.trim();
                        if (label) {
                          updateValue(
                            selectedValue,
                            { label },
                            `${label} was saved.`,
                          );
                        }
                      }}
                    >
                      <label htmlFor={`edit-${selectedValue.id}`}>
                        Edit {group.singular} {selectedValue.label}
                      </label>
                      <input
                        autoFocus
                        id={`edit-${selectedValue.id}`}
                        maxLength={80}
                        required
                        value={editLabel}
                        onChange={(event) => setEditLabel(event.target.value)}
                      />
                      <button type="submit" disabled={pendingId !== undefined}>
                        Save label
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(undefined)}
                      >
                        Cancel
                      </button>
                    </form>
                    <div className="reference-editor-actions">
                      {group.category === "status" && (
                        <button
                          type="button"
                          disabled={pendingId !== undefined}
                          onClick={() =>
                            updateValue(
                              selectedValue,
                              { isTerminal: !selectedValue.isTerminal },
                              `${selectedValue.label} outcome behavior was updated.`,
                            )
                          }
                        >
                          {selectedValue.isTerminal
                            ? "Mark as open"
                            : "Treat as closed"}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={pendingId !== undefined}
                        onClick={() =>
                          updateValue(
                            selectedValue,
                            { isActive: !selectedValue.isActive },
                            `${selectedValue.label} is now ${selectedValue.isActive ? "inactive" : "active"}.`,
                          )
                        }
                      >
                        {selectedValue.isActive ? "Disable" : "Enable"}
                      </button>
                      {confirmingId === selectedValue.id ? (
                        <>
                          <span>Remove this value?</span>
                          <button
                            type="button"
                            disabled={pendingId !== undefined}
                            onClick={() => deleteValue(selectedValue)}
                          >
                            Confirm remove
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(undefined)}
                          >
                            Keep value
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingId(selectedValue.id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {canManage && addingCategory === group.category && (
                  <form
                    className="reference-add-form"
                    onSubmit={(event) => createValue(event, group.category)}
                  >
                    <label htmlFor={`new-${group.category}`}>
                      New {group.singular}
                    </label>
                    <div>
                      <input
                        id={`new-${group.category}`}
                        maxLength={80}
                        required
                        value={drafts[group.category]}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [group.category]: event.target.value,
                          }))
                        }
                      />
                      <button type="submit" disabled={pendingId !== undefined}>
                        Add value
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingCategory(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                    {group.category === "status" && (
                      <label className="reference-checkbox">
                        <input
                          type="checkbox"
                          checked={newStatusTerminal}
                          onChange={(event) =>
                            setNewStatusTerminal(event.target.checked)
                          }
                        />
                        Treat as a closed outcome
                      </label>
                    )}
                  </form>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
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
  const [
    externalIdentityProviderConfigured,
    setExternalIdentityProviderConfigured,
  ] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<CreateLocalUserInput>(emptyUserForm);
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string>();
  const [statusError, setStatusError] = useState<string>();
  const [linkingUserId, setLinkingUserId] = useState<string>();
  const [identitySubjects, setIdentitySubjects] = useState<
    Record<string, string>
  >({});
  const [selectedIdentity, setSelectedIdentity] = useState<{
    identityId: string;
    userId: string;
  }>();
  const [identityPending, setIdentityPending] = useState(false);
  const [identityError, setIdentityError] = useState<string>();

  useEffect(() => {
    let active = true;
    void usersClient
      .listUsers()
      .then((directory) => {
        if (active) {
          setUsers(directory.users);
          setExternalIdentityProviderConfigured(
            directory.externalIdentityProviderConfigured,
          );
        }
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

  function replaceUser(updated: ManagedUser) {
    setUsers((current) =>
      current?.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    );
  }

  function linkExternalIdentity(
    event: FormEvent<HTMLFormElement>,
    user: ManagedUser,
  ) {
    event.preventDefault();
    const subject = identitySubjects[user.id] ?? "";
    setIdentityPending(true);
    setIdentityError(undefined);
    setNotice(undefined);
    void usersClient
      .linkExternalIdentity(user.id, subject)
      .then((updated) => {
        replaceUser(updated);
        setIdentitySubjects((current) => ({ ...current, [user.id]: "" }));
        setLinkingUserId(undefined);
        setNotice(`Remote identity linked to ${updated.displayName}.`);
        setIdentityPending(false);
      })
      .catch((caught: unknown) => {
        const message =
          caught instanceof UsersClientError &&
          caught.code === "external_identity_unavailable"
            ? "That external identity is already linked."
            : "The external identity could not be linked.";
        setIdentityError(message);
        setIdentityPending(false);
      });
  }

  function unlinkExternalIdentity(user: ManagedUser, identityId: string) {
    if (identityPending) return;
    setIdentityPending(true);
    setIdentityError(undefined);
    setNotice(undefined);
    void usersClient
      .unlinkExternalIdentity(user.id, identityId)
      .then((updated) => {
        replaceUser(updated);
        setSelectedIdentity(undefined);
        setNotice(`Remote identity removed from ${updated.displayName}.`);
        setIdentityPending(false);
      })
      .catch(() => {
        setIdentityError("The external identity could not be removed.");
        setIdentityPending(false);
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

      <SettingsNavigation
        activePage="settings-users"
        canManage
        navigate={navigate}
      />

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
      {identityError && (
        <div className="settings-error" role="alert">
          {identityError}
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
          {users && !externalIdentityProviderConfigured && (
            <p className="identity-provider-note">
              External identity linking appears here after the OAuth verifier is
              configured. Local accounts remain available.
            </p>
          )}
          {users && (
            <ul className="user-list">
              {users.map((user, index) => {
                const selected = user.externalIdentities.find(
                  ({ id }) =>
                    selectedIdentity?.userId === user.id &&
                    selectedIdentity.identityId === id,
                );
                return (
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
                        {user.externalIdentities.length > 0
                          ? ` · ${String(user.externalIdentities.length)} remote ${user.externalIdentities.length === 1 ? "link" : "links"}`
                          : ""}
                      </small>
                      {user.externalIdentities.length > 0 && (
                        <div
                          className="external-identity-chips"
                          aria-label={`Remote identities for ${user.displayName}`}
                        >
                          {user.externalIdentities.map((identity) => (
                            <button
                              aria-pressed={selected?.id === identity.id}
                              key={identity.id}
                              onClick={() => {
                                setLinkingUserId(undefined);
                                setSelectedIdentity({
                                  identityId: identity.id,
                                  userId: user.id,
                                });
                              }}
                              title={identity.subject}
                              type="button"
                            >
                              {identity.subject}
                            </button>
                          ))}
                        </div>
                      )}
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
                      {externalIdentityProviderConfigured && (
                        <button
                          aria-label={`Link remote identity to ${user.displayName}`}
                          disabled={identityPending}
                          onClick={() => {
                            setSelectedIdentity(undefined);
                            setLinkingUserId(user.id);
                          }}
                          type="button"
                        >
                          Link identity
                        </button>
                      )}
                    </div>
                    {selected && (
                      <div className="external-identity-editor">
                        <div>
                          <span>Selected remote subject</span>
                          <code>{selected.subject}</code>
                        </div>
                        <button
                          disabled={identityPending}
                          onClick={() =>
                            unlinkExternalIdentity(user, selected.id)
                          }
                          type="button"
                        >
                          {identityPending ? "Removing…" : "Remove link"}
                        </button>
                        <button
                          disabled={identityPending}
                          onClick={() => setSelectedIdentity(undefined)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {linkingUserId === user.id && (
                      <form
                        className="external-identity-form"
                        onSubmit={(event) => linkExternalIdentity(event, user)}
                      >
                        <label htmlFor={`external-subject-${user.id}`}>
                          OAuth subject for {user.displayName}
                        </label>
                        <input
                          autoCapitalize="none"
                          autoComplete="off"
                          id={`external-subject-${user.id}`}
                          maxLength={512}
                          onChange={(event) =>
                            setIdentitySubjects((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          required
                          spellCheck={false}
                          value={identitySubjects[user.id] ?? ""}
                        />
                        <button disabled={identityPending} type="submit">
                          {identityPending ? "Linking…" : "Link subject"}
                        </button>
                        <button
                          disabled={identityPending}
                          onClick={() => setLinkingUserId(undefined)}
                          type="button"
                        >
                          Cancel
                        </button>
                        <small>
                          Copy the exact <code>sub</code> claim from the
                          configured provider.
                        </small>
                      </form>
                    )}
                  </li>
                );
              })}
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

function formatAuditTime(value: string): string {
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
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
  const [accessError, setAccessError] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const localReady = status?.transports.local.state === "ready";
  const remoteReady = status?.transports.remote.state === "ready";
  const registryReady = status?.sessions.enforcement === "active";

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

  function setAccessMode(accessMode: "read_only" | "read_write") {
    if (!status || status.access.mode === accessMode || savingAccess) return;
    setAccessError(false);
    setSavingAccess(true);
    void mcpStatusClient
      .setAccessMode(accessMode)
      .then(setStatus)
      .catch(() => setAccessError(true))
      .finally(() => setSavingAccess(false));
  }

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
            <dt>Access</dt>
            <dd className="status-word">
              {status ? statusLabel(status.access.mode) : "—"}
            </dd>
          </div>
          <div>
            <dt>Tools</dt>
            <dd>{status?.capabilities.registeredTools ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <SettingsNavigation
        activePage="settings-mcp"
        canManage
        navigate={navigate}
      />

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
          <section className="mcp-access" aria-labelledby="mcp-access-title">
            <div>
              <p className="eyebrow">Workspace authority</p>
              <h2 id="mcp-access-title">Choose what MCP clients can change.</h2>
              <p>
                This policy applies immediately to local and remote MCP
                sessions. It never changes website permissions or the actor and
                workspace bound to a client.
              </p>
            </div>
            <div>
              <div
                className="mcp-access-options"
                role="radiogroup"
                aria-label="MCP access mode"
              >
                <button
                  aria-checked={status.access.mode === "read_only"}
                  disabled={savingAccess}
                  onClick={() => setAccessMode("read_only")}
                  role="radio"
                  type="button"
                >
                  <strong>Read only</strong>
                  <span>Inspect workspace data; block every mutation.</span>
                </button>
                <button
                  aria-checked={status.access.mode === "read_write"}
                  disabled={savingAccess}
                  onClick={() => setAccessMode("read_write")}
                  role="radio"
                  type="button"
                >
                  <strong>Read and write</strong>
                  <span>Create, update, and soft-delete applications.</span>
                </button>
              </div>
              <p className="mcp-access-note" data-mode={status.access.mode}>
                {status.access.mode === "read_write"
                  ? "Write access is active. MCP clients can change shared workspace records until an administrator switches this back."
                  : "Safe default active. Write tools remain discoverable but return write_access_disabled without changing data."}
              </p>
              {accessError && (
                <p className="mcp-access-error" role="alert">
                  MCP access could not be changed. The previous policy remains
                  active.
                </p>
              )}
            </div>
          </section>

          <section className="mcp-ledger" aria-labelledby="transport-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Transport register</p>
                <h2 id="transport-title">
                  {localReady
                    ? "Local tools ready"
                    : "Closed until implemented"}
                </h2>
              </div>
              <span data-state={status.availability}>
                {statusLabel(status.availability)}
              </span>
            </div>
            <p className="mcp-boundary-note">
              {localReady ? (
                <>
                  <strong>
                    {status.capabilities.registeredTools} tools registered
                  </strong>{" "}
                  over local stdio
                  {remoteReady
                    ? " and authenticated Streamable HTTP."
                    : " with an explicit actor and workspace binding."}{" "}
                  {status.access.mode === "read_write"
                    ? "Workspace mutations are enabled."
                    : "Workspace mutations are blocked."}
                </>
              ) : (
                "The status boundary is ready. No MCP transport or tool is active in this build."
              )}
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
                <p className="eyebrow">Remote session policy</p>
                <h2 id="policy-title">
                  {registryReady
                    ? "Registry ready"
                    : "Configured, not enforced"}
                </h2>
              </div>
              <span>{status.sessions.globalLimit} session ceiling</span>
            </div>
            <p>
              {registryReady
                ? remoteReady
                  ? "The remote registry enforces admission, idle and absolute expiry, explicit close, and shutdown cleanup for authenticated HTTP sessions."
                  : "The remote registry enforces admission, idle and absolute expiry, explicit close, and shutdown cleanup. HTTP activates only after complete network and OAuth configuration."
                : "These limits remain reserved for the remote session registry. Local stdio processes rely on operating-system access and their configured actor binding."}
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

          <section className="mcp-audit" aria-labelledby="mcp-audit-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Append-only security record</p>
                <h2 id="mcp-audit-title">Recent MCP activity</h2>
              </div>
              <span>{status.recentAuditEvents.length} shown</span>
            </div>
            {status.recentAuditEvents.length === 0 ? (
              <p className="mcp-audit-empty">
                No MCP tool calls have been recorded for this workspace.
              </p>
            ) : (
              <ol className="mcp-audit-list">
                {status.recentAuditEvents.map((event, index) => (
                  <li
                    key={`${event.occurredAt}-${event.action}-${String(index)}`}
                  >
                    <div>
                      <strong>{statusLabel(event.action)}</strong>
                      <span>
                        {event.actor.displayName} · @{event.actor.username}
                      </span>
                    </div>
                    <div>
                      <span data-result={event.result}>
                        {statusLabel(event.result)}
                      </span>
                      <small>
                        {statusLabel(event.targetType)} ·{" "}
                        {statusLabel(event.transport)}
                      </small>
                      <time dateTime={event.occurredAt}>
                        {formatAuditTime(event.occurredAt)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
