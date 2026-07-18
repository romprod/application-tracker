const buildSteps = [
  {
    label: "Foundation",
    status: "Ready",
    summary: "Typed runtime, accessible shell, and automated quality gates.",
  },
  {
    label: "Identity",
    status: "Next",
    summary: "Workspaces, local users, secure setup, and signed-in sessions.",
  },
  {
    label: "Application ledger",
    status: "Planned",
    summary: "Applications, events, documents, actions, and outcomes.",
  },
] as const;

const navigationItems = ["Overview", "Applications", "Documents", "Settings"];

export function App() {
  return (
    <div className="app-shell">
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
        <div className="build-label" aria-label="Build status">
          <span className="status-dot" aria-hidden="true" />
          Foundation ready
        </div>
      </header>

      <div className="workspace-frame">
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

        <main id="main-content" tabIndex={-1}>
          <section className="hero" aria-labelledby="page-title">
            <div className="hero-copy">
              <p className="eyebrow">Application ledger · Build 001</p>
              <h1 id="page-title">Your search, kept in order.</h1>
              <p className="lede">
                A calm, self-hosted record for every application, conversation,
                document, decision, and next move.
              </p>
            </div>
            <div className="index-card" aria-label="Foundation summary">
              <span className="index-number">01</span>
              <div>
                <p>Current chapter</p>
                <strong>Reliable foundations</strong>
                <span>Public-safe from the first commit.</span>
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
            <p>
              Designed for one private workspace. Ready to grow deliberately.
            </p>
            <span>Application Tracker / Foundation</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
