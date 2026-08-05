# Initial threat model

## Assets

- Integrity of a concrete plan and its approval.
- Confidentiality of credentials, file contents and audit data.
- Workspace, process and network boundaries.
- Human intent and approval metadata.
- Availability of the review gate and audit trail.

## Trust boundaries

```text
untrusted agent/provider input
        ↓ schema + normalization
core risk/policy engine ← local configuration and user approval
        ↓ approved action only
side-effecting executor → external system
        ↓ sanitized result
local store and dashboard
```

## Threats and mitigations

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Malicious agent or prompt injection | Treat tool input as untrusted; concrete actions are reviewed; prose intent is not a plan. | A tool can bypass the SDK if the host application exposes another path. |
| Compromised tool or adapter | Inject executors at apply; require action/resource metadata; compare affected resources for drift. | Hidden side effects inside a callback may not be observable. |
| Plan modification after approval | SHA-256 content hash, approval hash binding and apply-time verification. | An attacker who controls code/store can replace the whole runtime. |
| Unauthorized approval | Record approver, method, expiration and action IDs; expose external adapter interface. | MVP local approval has no enterprise identity or quorum. |
| Secret exfiltration | Recursive redaction before storage/output/dashboard; no remote telemetry. | Unknown secret formats or maliciously encoded data may evade detectors. |
| Path traversal or external symlink | Workspace resolution, relative-boundary checks and adapter symlink checks. | OS permissions and races still matter. |
| Command injection | Structured argv, `shell: false`, command policy and bounded execution. | A permitted binary may itself interpret arguments dangerously. |
| SSRF and private network access | URL parsing, private-host deny, host policy, no redirects and external egress controls recommended. | DNS rebinding and network-layer behavior require infrastructure controls. |
| Policy bypass through globs | Deny-first matching, explainable config paths, runtime schema and tests. | A broad user-authored allow rule remains powerful. |
| Supply-chain compromise | Lockfile, pinned versions, CI audit step, no unreviewed provider SDKs in core. | Dependencies and build infrastructure remain external trust. |
| Sensitive logs | Sanitized JSONL, configurable input retention and dashboard omission of raw input. | Operators can still log data in their own callbacks. |

## Security assumptions

The host controls the workspace, config file, Node runtime and installed dependencies. AgentPlan improves authorization predictability inside that trust boundary; it cannot establish trust in a compromised host.

## Review questions

Before production use, verify that all side effects flow through one engine, the config is reviewed, the dashboard is not exposed, approval identities are strong enough and executor previews accurately describe the resources they may affect.
