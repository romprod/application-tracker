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

const navigationItems = ["Overview", "Applications", "Documents", "Settings"];

type AppView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "setup"; tokenConfigured: boolean }
  | { kind: "login"; notice?: string }
  | {
      kind: "ready";
      logoutError?: string;
      notice?: string;
      session: AuthenticatedSession;
      signingOut: boolean;
    };

interface AppProps {
  authClient?: AuthClient;
  setupClient?: SetupClient;
}

export function App({
  authClient = browserAuthClient,
  setupClient = browserSetupClient,
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
            ? { kind: "ready", session, signingOut: false }
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
    setView({ kind: "ready", session: currentSession, signingOut: true });
    void authClient
      .logout()
      .then(() =>
        setView({ kind: "login", notice: "You have signed out safely." }),
      )
      .catch(() =>
        setView({
          kind: "ready",
          logoutError: "Sign out could not be completed. Please try again.",
          session: currentSession,
          signingOut: false,
        }),
      );
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
        <Sidebar mode={isSetup ? "setup" : isLogin ? "login" : "workspace"} />
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
                session: authenticated,
                signingOut: false,
              })
            }
            {...(view.notice ? { notice: view.notice } : {})}
          />
        )}
        {view.kind === "ready" && (
          <Overview
            session={view.session}
            {...(view.logoutError ? { error: view.logoutError } : {})}
            {...(view.notice ? { notice: view.notice } : {})}
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

function Sidebar({ mode }: { mode: "login" | "setup" | "workspace" }) {
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
          {navigationItems.map((item, index) => (
            <li key={item}>
              {index === 0 ? (
                <a href="#main-content" aria-current="page">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {item}
                </a>
              ) : (
                <span className="future-navigation" aria-disabled="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {item}
                  <small>soon</small>
                </span>
              )}
            </li>
          ))}
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
