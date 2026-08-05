# Security Policy

AgentPlan handles proposed actions that may affect files, commands, networks and business systems. Treat it as security-sensitive infrastructure and review its boundaries before deployment.

## Supported versions

| Version | Support |
| --- | --- |
| `0.1.x` | Security fixes and triage |
| `<0.1.0` | Not supported |

The project is pre-1.0. APIs and policy semantics may change between minor releases. Pin versions in production and review changelogs before upgrades.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting when it is enabled for the repository. If that channel is unavailable, contact the maintainers privately with:

- a concise description and impact;
- affected version and environment;
- a minimal reproduction that does not contain secrets;
- proposed mitigation, if known.

Do not publish credentials, customer data, exploit code against third-party systems or a public issue before maintainers have had a reasonable opportunity to respond.

## Scope

In scope are vulnerabilities in the core engine, policy bypasses, plan-integrity failures, approval bypasses, secret leakage, unsafe path or command execution, SSRF in the HTTP adapter, audit tampering and supply-chain configuration in this repository.

Out of scope are vulnerabilities in an external LLM provider, an unmodified user executor, an intentionally exposed unauthenticated local dashboard, or a policy that a user explicitly configured to allow a dangerous action. These may still be useful reports when they reveal an unsafe default or misleading documentation.

## Threat model summary

The main assets are plan integrity, approval intent, secret confidentiality, workspace boundaries, audit records and the availability of the control point. Relevant adversaries include a malicious agent, prompt injection, compromised tool or adapter, a user with excessive approval rights and a malicious dependency. See [docs/security/threat-model.md](docs/security/threat-model.md).

## Known limitations

- AgentPlan is not a universal OS sandbox and cannot stop a tool that bypasses the engine.
- A local user who can modify the store, configuration or executable code can influence the result; protect the workspace and `.agentplan/` permissions.
- The local dashboard has no authentication in the MVP and must not be exposed to an untrusted network.
- Rollback is executor-specific and is not guaranteed for every action.
- Provider normalizers do not validate or call provider APIs; the application remains responsible for authenticating and handling provider responses.

## Recommended practices

- Use a dedicated workspace and least-privilege OS account.
- Keep `defaults.decision: deny`, private-network blocking and audit enabled.
- Do not put secrets in `agentplan.yaml`, action input or plan documents.
- Review medium, high and critical actions interactively; use non-interactive mode in CI.
- Pin dependencies, review lockfile changes and run `pnpm audit` in release preparation.
- Keep `.agentplan/plans/` and `.agentplan/audit/` access-controlled; export only sanitized data.
- Treat a drift report as a failed authorization boundary and create a new plan for new actions.
