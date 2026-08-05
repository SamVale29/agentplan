# ADR 0003: Deterministic deny-by-default policy

## Context

LLM-only risk or authorization decisions are non-deterministic and difficult to explain. Agent actions need a predictable user-controlled boundary.

## Decision

Evaluate explicit action rules first, deny invalid or unsafe boundaries, preserve `require-approval`, then apply a deny-by-default fallback. Return rule, path and reason with every decision.

## Alternatives

- Allow by default: lower friction but unsafe for unknown tools.
- LLM-only policy: expressive but not reproducible or auditable.
- OS permissions only: necessary but does not express human review intent.

## Consequences

New action types require an explicit configuration decision or remain denied. Policy changes are security changes and should be reviewed like code.

## Risks

Broad globs can authorize more than intended. Deny-first matching and examples reduce, but do not eliminate, configuration risk.
