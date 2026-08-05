# ADR 0002: Use one canonical action model

## Context

Providers and frameworks represent tool calls differently. Policy, risk and audit need stable fields to reason about the same side effect.

## Decision

Normalize every concrete request to `AgentPlanAction` with source, type, resource, input, effects, permissions, reversibility, risk, policy results, status and timestamps. Validate persisted objects with runtime schemas.

## Alternatives

- Keep provider payloads in policy code: flexible but provider-coupled and difficult to audit.
- Use untyped JSON: fast initially but unsafe at a security boundary.

## Consequences

Adapters do small normalization work and the core can remain provider-neutral. Provider-specific detail must remain in sanitized input or adapter-owned metadata.

## Risks

An incomplete normalizer can understate effects. Adapters must document supported event shapes and include tests.
