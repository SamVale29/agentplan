# Changelog

All notable changes to AgentPlan are documented here. The project follows semantic versioning while it remains pre-1.0.

## [Unreleased]

### Added

- Capability snapshot diffing with deterministic severity classification and SARIF export.
- GitHub approval adapter with collaborator permission checks, exact plan-hash commands and timeout fail-closed behavior.
- GitHub capability comments that update in place instead of duplicating PR reports.
- CLI and GitHub Action support for capability review in pull requests.
- End-to-end smoke coverage for the compiled CLI, filesystem executor and dashboard API.

### Security and maintenance

- Fixed the high-severity transitive `nanoid` audit finding by refreshing the Vite/PostCSS lockfile chain.
- Prevented approval replay for terminal plans, hardened local store permissions and rejected dangerous shell environment overrides.
- Added DNS-resolution checks for HTTP targets, immutable GitHub Action pins and release-version consistency checks.

## [0.1.0] — 2026-08-04

### Added

- Strict TypeScript monorepo with `@agentplan/core`, SDK, CLI, adapters and local dashboard.
- Canonical action model, runtime validation, deterministic risk scoring and explainable policy results.
- SHA-256 plan integrity, approval expiration, sanitized audit events and drift detection.
- Workspace-safe filesystem executor, shell executor using `shell: false`, SSRF-aware HTTP executor and MCP/provider normalizers.
- CLI commands for initialization, inspection, plan/apply, approval, diff, audit, policy checks, doctor and dashboard.
- Executable file, shell, support and MCP examples.
- Documentation, security model, ADRs, community templates, CI workflow and Apache-2.0 licensing.

### Limitations

- No universal sandbox, remote approval adapter, full MCP lifecycle or provider API client.
- Local JSON storage is used instead of SQLite.
- The dashboard is unauthenticated and intended for trusted local use only.
