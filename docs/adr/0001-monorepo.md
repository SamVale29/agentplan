# ADR 0001: Use a TypeScript workspace monorepo

## Context

The core, CLI, SDK, adapters and dashboard have different dependency and release boundaries, but they must share canonical schemas and tests.

## Decision

Use pnpm workspaces with strict TypeScript project references. `packages/core` remains framework-independent; applications and adapters depend on it through explicit workspace packages.

## Alternatives

- A single package would make the first build simpler but would blur trust boundaries.
- Multiple repositories would make cross-package schema changes and local testing slower.

## Consequences

Build order and package exports are explicit. The repository can publish focused packages later. Users need pnpm and a build step during development.

## Risks

Workspace links can hide missing package declarations. CI must install from the lockfile and build all references.
