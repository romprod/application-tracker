# ADR 0002: Established workspace experience

## Status

Accepted

## Context

The private predecessor established a useful visual hierarchy and interaction
model: fixed workspace navigation, a metrics dashboard, dense sortable tables,
detail drawers, and modal data entry. Replacing that experience with a different
shell during the public reconstruction would create unnecessary product drift.

The public edition must still preserve the clean-history and security boundaries
defined in ADR 0001. Private source history, deployment configuration, data, and
infrastructure details cannot enter this repository.

## Decision

Treat the established user experience as the product contract and reimplement
it through reviewed public code. Keep the dark evergreen navigation, warm paper
surfaces, coral actions, dashboard hierarchy, shared application table, detail
drawer, and modal form workflow.

Only expose capabilities supported by the public backend. Do not add placeholder
data for private-only features such as documents, next actions, configurable
lists, or contacts. Preserve the public edition's session, authorization,
workspace isolation, validation, migration, and API boundaries.

## Consequences

- Existing users retain a familiar workflow while the implementation remains a
  clean reconstruction.
- Dashboard and table behavior can be tested independently of private data.
- Deferred features remain visibly separate from implemented capabilities.
- Later parity work extends the established shell instead of redesigning it.
