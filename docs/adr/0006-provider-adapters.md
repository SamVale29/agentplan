# ADR 0006: Normalize provider tool calls without owning provider clients

## Context

AgentPlan must remain provider-agnostic while still making common tool-call payloads reviewable. Provider APIs and streaming behaviors change independently.

## Decision

Ship small OpenAI and Anthropic normalizers for documented function/tool-use payloads. Do not add provider SDKs, endpoints or credential handling to the core. Mark unsupported streaming and lifecycle behaviors explicitly.

## Alternatives

- Build full provider clients: broad scope and unnecessary credential responsibility.
- No provider adapters: less maintenance but a higher barrier to the first integration.
- One universal abstraction: likely to erase important provider semantics.

## Consequences

Applications can feed normalized calls into the same policy engine without replacing their provider client. Support remains intentionally partial and must follow official documentation.

## Risks

Payload drift can cause missed calls. Fixtures and versioned tests are required before expanding coverage.
