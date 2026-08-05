# Contributing to AgentPlan

Thanks for helping build a trustworthy authorization layer for agent actions.

## Before you start

Read [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), the relevant ADRs in `docs/adr/` and [docs/limitations.md](docs/limitations.md). The project is early-stage and prioritizes a small, auditable core over broad but implicit integrations.

## Local setup

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Useful checks:

```bash
pnpm format:check
pnpm check:docs
pnpm check:examples
pnpm run ci
```

The repository uses a strict TypeScript monorepo. Source identifiers, comments, tests, CLI output, technical docs and commit messages use English. Community issues and discussions may use English or Brazilian Portuguese.

## Making a change

1. Open or choose an issue that explains the problem and security boundary.
2. Keep the change focused; avoid unrelated formatting churn.
3. Add or update runtime schemas when changing public data.
4. Add unit tests for deterministic logic and integration tests for adapters or storage.
5. Update English documentation and the Portuguese README when a user-facing workflow changes.
6. Run the full CI command before opening a pull request.

Security-sensitive changes should explain the threat, the invariant that prevents the issue and how the tests exercise the boundary. Never add real credentials, destructive examples or a provider integration that has not been verified against official documentation.

## Pull requests

Use the pull request template. A good PR describes:

- the user-visible outcome;
- the design and alternatives considered;
- policy and risk implications;
- test commands and their results;
- documentation and migration impact;
- known limitations or follow-up work.

Prefer small commits with imperative English messages. Do not claim that an integration is complete when the repository only contains a normalizer or interface.

## Adding an adapter

Keep provider and framework code outside `@agentplan/core`. Implement the smallest adapter boundary possible, normalize to `RawAction` or `AgentPlanAction`, sanitize data before logs, and document exactly which event shapes are supported. Use mocks or fixtures in tests; external credentials are not required for the main suite.

## Reporting security issues

Do not open a public issue for an exploitable vulnerability. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is provided under the Apache License 2.0.
