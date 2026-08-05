# ADR 0004: Bind approval to an immutable content hash

## Context

An approval must not silently authorize changed action input. Lifecycle updates must still be possible after approval.

## Decision

Compute a SHA-256 hash over immutable plan content and exclude status, timestamps, approval and execution results. Store the hash in the plan and approval; verify it before apply and require expiration.

## Alternatives

- Hash the entire document: lifecycle updates would invalidate a valid approval.
- Trust file timestamps: not tamper-evident.
- Sign with a key in the MVP: stronger identity but introduces key management before the core workflow is stable.

## Consequences

Plan edits fail closed. A future signing adapter can build on the same content projection.

## Risks

SHA-256 proves content equality, not authorship. External approval adapters and repository permissions must provide stronger identity when needed.
