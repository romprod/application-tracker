import { useEffect, useState, type FormEvent } from "react";

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
    status: "In progress",
    summary: "Closed administrator setup is ready; local login comes next.",
  },
  {
    label: "Application ledger",
    status: "Planned",
    summary: "Applications, events, documents, actions, and outcomes.",
  },
] as const;

const navigationItems = ["Overview", "Applications", "Documents", "Settings"];

type AppView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "setup"; tokenConfigured: boolean }
  | { kind: "ready"; notice?: string };

interface AppProps {
  setupClient?: SetupClient;
}

export function App({ setupClient = browserSetupClient }: AppProps) {
  const [view, setView] = useState<AppView>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void setupClient
      .getStatus()
      .then((status) => {
        if (!active) return;
        setView(
          status.required
            ? { kind: "setup", tokenConfigured: status.tokenConfigured }
            : { kind: "ready" },
        );
      })
      .catch(() => {
        if (active) setView({ kind: "error" });
      });

    return () => {
      active = false;
    };
  }, [setupClient]);

  const isSetup = view.kind === "setup";
  const statusLabel =
    view.kind === "loading"
      ? "Checking installation"
      : isSetup
        ? "Setup required"
        : "Foundation ready";

  return (
    <div className="app-shell">
      <Masthead statusLabel={statusLabel} />
      <div className={`workspace-frame${isSetup ? " setup-frame" : ""}`}>
        <Sidebar setupMode={isSetup} />
        {view.kind === "loading" && <LoadingView />}
        {view.kind === "error" && <StatusErrorView />}
        {view.kind === "setup" && !view.tokenConfigured && <MissingTokenView />}
        {view.kind === "setup" && view.tokenConfigured && (
          <SetupView
            setupClient={setupClient}
            onComplete={() =>
              setView({
                kind: "ready",
                notice: "Administrator created. Setup is now closed.",
              })
            }
          />
        )}
        {view.kind === "ready" && (
          <Overview {...(view.notice ? { notice: view.notice } : {})} />
        )}
      </div>
    </div>
  );
}

function Masthead({ statusLabel }: { statusLabel: string }) {
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
      <div className="build-label" aria-label="Installation status">
        <span className="status-dot" aria-hidden="true" />
        {statusLabel}
      </div>
    </header>
  );
}

function Sidebar({ setupMode }: { setupMode: boolean }) {
  if (setupMode) {
    return (
      <aside className="sidebar setup-sidebar">
        <p className="sidebar-label">Installation</p>
        <nav aria-label="Primary navigation">
          <ul>
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

function Overview({ notice }: { notice?: string }) {
  return (
    <main id="main-content" tabIndex={-1}>
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">Application ledger · Build 004</p>
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
            <span>Administrator setup is closed; sign-in comes next.</span>
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
