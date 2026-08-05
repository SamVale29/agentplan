# ADR 0005: Use a local file store for the MVP

## Context

The first workflow should work offline with one developer and no database service. Plans and audit records need a stable interface for later storage changes.

## Decision

Implement `PlanStore` with JSON plan files and JSONL audit files under `.agentplan/`, using atomic plan writes and restrictive file modes where supported.

## Alternatives

- SQLite now: useful query semantics but adds native/runtime choices and distracts from the authorization path.
- Remote database: violates local-first defaults and requires credentials.

## Consequences

The MVP is easy to inspect, backup and test. Concurrent writers, tamper-evident retention and large-scale queries are not solved.

## Risks

Users may mistake local files for compliance-grade immutable logs. Documentation must state the limitation and future storage can implement the same interface.
