# Limitations and safe boundaries

AgentPlan is an authorization layer around cooperating adapters. It is not a universal security boundary for arbitrary code.

## Not implemented in the MVP

- Universal OS/container sandboxing.
- Perfect prediction of future agent actions or hidden side effects.
- Guaranteed rollback for arbitrary network, database, financial or communication actions.
- Complete MCP transport, session and capability semantics.
- Complete API clients for OpenAI, Anthropic or other providers.
- Distributed remote execution and enterprise identity.
- Billing, marketplace and production-grade multi-tenant dashboard authentication.
- SQLite persistence and remote approval adapters.

## Consequences

A tool can bypass AgentPlan if the application gives it a second execution path. The user must ensure that all side-effecting tools are registered and that adapter callbacks do not perform hidden extra effects. An executor can affect more resources than its preview reports; drift detection catches some mismatches after the fact but cannot undo them.

Configuration is an authority boundary. A broad glob or allow decision can authorize more than intended. Review configuration changes, use OS-level permissions and keep sensitive workloads isolated.

The dashboard is local and unauthenticated. Do not expose it on a shared network. The JSON store is appropriate for a local MVP, not for concurrent enterprise workloads or tamper-evident compliance retention.
