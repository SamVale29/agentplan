# Configuration

`agentplan.yaml` is the user-controlled policy boundary. Configuration is parsed with a runtime schema and unknown values are not used as implicit permissions.

## Secure baseline

```yaml
version: "1"
project:
  name: customer-support-agent
  environment: development
defaults:
  decision: deny
  requireApprovalFrom: medium
  preApproveLowRisk: true
workspace:
  root: .
  allowRead:
    - ./src/**
    - ./package.json
  allowWrite:
    - ./src/**
  deny:
    - ./.env
    - ./secrets/**
    - ./.git/**
shell:
  allow:
    - pnpm test
  requireApproval:
    - pnpm install *
  deny:
    - rm -rf *
    - sudo *
network:
  allowHosts:
    - api.openai.com
  denyPrivateNetworks: true
  requireApprovalForUnknownHosts: true
mcp:
  invoke: require-approval
```

## Decisions

Each policy decision is `allow`, `require-approval` or `deny`. A specific deny always wins. When no specific rule matches, `defaults.decision` applies. The core returns the rule, config path and reason with every evaluation.

## Workspace paths

Paths are resolved relative to `workspace.root`. A path outside the workspace is denied even if a glob appears to match it. Explicit deny patterns are checked before allow patterns. The filesystem executor separately checks existing path components for symlinks that resolve outside the workspace.

## Shell patterns

Shell rules match the display form of an argv action. The executor still receives an argv array and uses `spawn` with `shell: false`; a glob match never turns a string into shell source. Prefer exact commands for sensitive operations.

## Network

HTTP and HTTPS are the only supported protocols. Private and loopback destinations are denied when `denyPrivateNetworks` is true. Known hosts use `allowHosts`; unknown hosts can require approval. Host matching is not a substitute for DNS egress controls.

## Approval thresholds

`requireApprovalFrom` is a risk level. With the default `medium`, low-risk actions may be pre-approved when their policy allows them; medium, high and critical actions require approval. A policy-level `require-approval` always wins.

## Redaction and audit

`redaction.environmentVariables` contains glob patterns such as `*_API_KEY`. Common authorization headers, tokens, keys, cookies, passwords and connection-string credentials are masked. `audit.storeInputs: sanitized` is the safe default. Keep secrets in the process environment or a dedicated secret manager, not in plan documents.
