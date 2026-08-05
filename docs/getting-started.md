# Getting started

## Requirements

- Node.js 20.19 or newer.
- pnpm 11 or newer.
- A project directory that can contain `agentplan.yaml` and `.agentplan/`.

## Build the repository

```bash
pnpm install
pnpm build
pnpm test
```

The workspace root declares the CLI and SDK so examples can resolve them after installation. Published packages will use the same package boundaries.

## Initialize a project

From a new project directory:

```bash
pnpm exec agentplan init
```

The command creates a conservative deny-by-default configuration, local state directories and `.gitignore` entries. It refuses to replace an existing `agentplan.yaml` unless `--force` is explicitly passed.

## Create a plan document

An action document is YAML or JSON. The smallest useful document is:

```yaml
agent: example-agent
actions:
  - type: filesystem.read
    title: Read the package manifest
    resource:
      kind: file
      identifier: ./package.json
    input:
      path: ./package.json
    effects:
      - Read one workspace file
    permissions:
      - filesystem.read
    reversible: true
```

Generate a plan without applying it:

```bash
pnpm exec agentplan plan --input actions.yaml
```

Copy the plan ID from the output. A low-risk action may receive a pre-approved policy decision. Medium and higher risk actions remain waiting for approval by default.

## Approve and apply

```bash
pnpm exec agentplan approve <PLAN_ID> --by local-user
pnpm exec agentplan apply <PLAN_ID>
```

`apply` verifies the plan hash, approval hash and expiration, selects a registered executor and records the result. A changed plan fails integrity verification rather than reusing the old approval.

## Run an SDK agent

```bash
pnpm exec agentplan run -- node examples/file-agent/index.mjs
```

The parent process passes the config path and runner context to the child without a shell. The SDK creates plans for each registered tool call, requests interactive approval when required and keeps the real callback input in memory rather than persisting it unsanitized.

## Inspect and troubleshoot

```bash
pnpm exec agentplan inspect --json
pnpm exec agentplan doctor
pnpm exec agentplan audit list
pnpm exec agentplan show
```

If an action is blocked, read its policy result and `configPath`. If an apply reports integrity failure, compare the stored plan with version control and create a new plan instead of editing the approved file.
