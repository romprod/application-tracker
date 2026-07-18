# ADR 0001: Greenfield public reconstruction

## Status

Accepted

## Context

Application Tracker needs a public history whose every revision is suitable for
publication. Importing or rewriting an older private repository would require
trusting that every historical object, configuration file, authoring artifact,
and deleted path had been found and sanitized.

## Decision

Build the public edition in a new Git repository. Existing behavior may inform
requirements and tests, but source enters this repository only through reviewed,
public-safe commits. Do not add the private repository as a remote, copy its
`.git` directory, preserve its object identifiers, or replay its commits.

Each public commit must be coherent, buildable for its stage, and free from
private deployment identity. The private implementation remains independent
until the public edition reaches tested feature parity.

## Consequences

- Public history begins with the project contract and records the genuine
  reconstruction work.
- Private operational history remains available only in the private repository.
- Porting takes longer than a snapshot import but creates reviewable boundaries
  for authentication, authorization, storage, document processing, and MCP.
- Production continues to use the private implementation until a deliberate
  migration is approved.
