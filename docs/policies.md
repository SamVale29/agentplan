# Policy engine

Policy evaluation is deterministic, ordered and explanatory. Every result contains:

- `decision`: `allow`, `require-approval` or `deny`;
- `rule`: the human-readable rule that matched;
- `configPath`: the exact YAML path;
- `reason`: why the decision was produced.

## Precedence

1. Invalid input, workspace escape, private-network violation and explicit deny are denied.
2. Action-specific rules are evaluated next: filesystem patterns, shell patterns, network hosts, database, Git, finance or MCP.
3. An explicit `require-approval` survives an allow match.
4. If no specific rule matches, `defaults.decision` applies.
5. Risk thresholds add a human approval requirement even when policy allows the action.

## Filesystem example

```yaml
workspace:
  allowRead:
    - ./src/**
  allowWrite:
    - ./tests/**
  deny:
    - ./.env
    - ./secrets/**
```

The deny list is checked first. A path outside `workspace.root` is denied before glob evaluation. The adapter performs an additional symlink check.

## Shell example

```yaml
shell:
  allow:
    - pnpm test
  requireApproval:
    - pnpm install *
  deny:
    - rm -rf *
    - curl * | sh
```

Patterns are applied to a display form of argv. They do not enable shell parsing; the shell adapter remains argv-only.

## Safe changes

Policy changes are authorization changes. Review them as code, keep patterns narrow, add a policy test and run `agentplan policy check` against representative actions. A plan approved under one policy snapshot should not be silently reused after its action content changes.
