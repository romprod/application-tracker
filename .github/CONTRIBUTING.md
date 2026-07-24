# Contributing

Contributions are welcome through GitHub pull requests. The repository owner
retains merge control; contributors do not need direct write access.

## Propose a change

1. Open an issue for a large behavior or schema change before writing code.
2. Fork the repository and create a focused branch.
3. Add the narrowest tests that prove the change.
4. Run `npm run check`.
5. Open a pull request and explain the behavior, tests, migration effect, and
   security impact.

Keep each pull request small enough to review as one coherent change. Do not
combine feature work, broad formatting, generated output, and unrelated
refactoring.

## Job-email agent skill impact

Pull requests that change application, email, evidence, event, document-import,
or MCP behavior must review the bundled job-email agent skill. Update both
`.agents/skills/application-tracker-job-email/SKILL.md` and
`.agents/skills/application-tracker-job-email/references/current-mcp-contract.md`
in the same pull request when the workflow, decisions, required tools, schemas,
errors, verification, or reporting change.

When monitored files change but the skill remains accurate, select the pull
request template's not-applicable option and give a concrete reason. The quality
workflow rejects a missing review, an unexplained exception, or an update to
only one of the two required documents.

This review supplements the MCP schema guard. Tool metadata changes still
require a schema-version increment, regenerated manifest, connector
publication, and fresh-task verification.

## Public-content rules

Use synthetic data in source, tests, screenshots, and documentation. Never
commit:

- credentials, setup tokens, session tokens, or MCP bearer tokens;
- a populated `.env` or machine-specific `.mcp.json`;
- private hostnames, addresses, paths, or deployment configuration;
- real applications, contacts, email content, documents, databases, or
  backups.

Use `example.com` for domains and the documentation address ranges reserved by
RFC 5737 for network examples.

## Security reports

Do not disclose a suspected vulnerability in a public issue or pull request.
Follow the [security policy](SECURITY.md) instead.
