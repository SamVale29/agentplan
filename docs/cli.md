# CLI reference

The executable is `agentplan`. In this repository run it with `pnpm exec agentplan` after `pnpm build`.

## Commands

| Command | Behavior |
| --- | --- |
| `init` | Create a config, local state directories and `.gitignore` recommendations. |
| `inspect` | Report configured capabilities, permissions, hosts, workspace and destructive categories. |
| `run -- <argv...>` | Run an application as a child process with AgentPlan context; argv is never passed to a shell. |
| `plan --input <file>` | Validate actions and persist a plan without applying side effects. |
| `approve <id>` | Approve a plan and bind the approval to its content hash. |
| `deny <id>` | Deny a plan. |
| `apply <id>` | Verify approval and execute registered filesystem, shell or HTTP actions. |
| `show [id]` | Show a plan; without an ID, show the newest plan. |
| `diff --from <id> --to <id>` | Compare normalized action content between plans. Without IDs, show latest execution drift. |
| `policy check --input <file>` | Create a plan and report policy/risk decisions without executing. |
| `audit list` | List plans and audit event counts. |
| `audit show <id>` | Show sanitized audit events for one plan. |
| `doctor` | Check Node, configuration, local store, audit and network safety. |
| `dashboard` | Start the local dashboard on `127.0.0.1:4321`. |
| `version` | Print the CLI version. |

## Global options

- `--json`: emit machine-readable JSON.
- `--quiet`: suppress normal output.
- `--config <path>`: choose a configuration file.
- `--no-color`: reserved for consistent CI invocation; current output is color-free.
- `--non-interactive`: refuse actions requiring approval instead of prompting.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success. |
| `1` | General error, executor failure or invalid invocation. |
| `2` | Invalid or unavailable configuration. |
| `3` | Action or plan blocked/denied. |
| `4` | Approval required or expired. |
| `5` | Drift detected after execution. |
| `6` | Policy check failed. |

## Plan input

The `plan` and `policy check` commands accept a YAML or JSON array of raw actions, or an object with `agent` and `actions`. Runtime schemas reject incomplete resources, titles, types and inputs.

## CI usage

Use `--json --non-interactive` and treat codes `3` through `6` as a failed authorization decision. Do not make CI approval automatic by setting a broad allow policy; use a reviewed plan artifact or an external approval adapter.
