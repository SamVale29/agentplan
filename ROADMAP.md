# Roadmap

The roadmap is directional, not a promise of dates. Security, correctness and a usable approval boundary take priority over surface area.

## Phase 1 — Foundation

- Monorepo and strict TypeScript build.
- Runtime schemas and canonical action model.
- Configuration, glob matching, policy engine and deterministic risk engine.
- Redaction, audit events, local storage, plan hashing and approval records.

## Phase 2 — Functional CLI

- `init`, `inspect`, `plan`, `approve`, `apply`, `show`, `diff`, `audit` and `doctor`.
- JSON output, non-interactive behavior and documented exit codes.
- Plan/apply integrity and drift reporting.

## Phase 3 — Core adapters

- Workspace-bound filesystem operations.
- Shell argv execution with timeout and bounded output.
- HTTP executor with host and private-network safeguards.
- Generic SDK for application-owned tools.

## Phase 4 — Agent integrations

- MCP discovery and gateway improvements.
- Broader event coverage for OpenAI and Anthropic provider APIs.
- Additional provider normalizers only when official payloads and lifecycle semantics are verified.
- GitHub approval adapter with explicit collaborator permission and plan-hash validation.

## Phase 5 — Developer experience

- Local dashboard search, filters and richer diffs.
- GitHub Action capability diffs, SARIF export and pull request reporting.
- More examples, fixtures and adapter authoring guidance.
- Optional SQLite storage behind the same `PlanStore` interface.

## Phase 6 — Public release

- Security review and dependency hardening.
- Published packages and reproducible release artifacts.
- External approval adapters with explicit trust models.
- Community-driven adapters, translations and operational guidance.

## Explicitly out of the near-term MVP

Universal sandboxing, perfect prediction of future agent chains, guaranteed rollback for arbitrary side effects, complete support for every MCP/provider behavior, distributed execution, enterprise identity, billing and a marketplace remain outside the initial release boundary.
