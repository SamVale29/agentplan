# Adapters

Adapters are capability boundaries. They should normalize untrusted input, expose a small interface and leave policy, approval, audit and drift to core.

## Filesystem

`@agentplan/adapter-filesystem` supports read, write, delete and move. It resolves paths inside a configured workspace, checks existing symlink components, limits file size and produces a small write diff preview. It does not silently read `.env` or content outside policy.

## Shell

`@agentplan/adapter-shell` accepts `argv`, optional `cwd`, environment values and a bounded timeout. It invokes `spawn(executable, args, { shell: false })`, constrains existing symlinks to the workspace, rejects dangerous environment overrides such as `PATH`, `NODE_OPTIONS` and `GIT_SSH_COMMAND`, captures bounded stdout/stderr and reports exit status. The adapter intentionally does not parse arbitrary shell source. Command policy is evaluated before it is injected into an executor.

## HTTP

`@agentplan/adapter-http` supports HTTP/HTTPS requests with bounded response size, timeout and no redirects. It rejects private and loopback targets, including private DNS resolutions, at executor level in addition to policy evaluation. It is not a general SSRF defense for the rest of an application; enforce network egress controls outside AgentPlan as well.

## MCP

`@agentplan/adapter-mcp` provides a small discovery shape, canonical MCP call normalization and an `McpGateway` that routes calls through `AgentPlanEngine`. It does not implement every MCP transport, lifecycle or capability negotiation behavior.

## Provider normalizers

`@agentplan/adapter-openai` understands OpenAI Responses `function_call` items and Chat Completions `tool_calls`, following the [OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses). `@agentplan/adapter-anthropic` understands Messages `tool_use` content blocks, following [Anthropic tool-use documentation](https://docs.anthropic.com/en/docs/build-with-claude/tool-use). They normalize payloads only; they do not instantiate provider clients, invent endpoints or claim to intercept every streaming variant.

## GitHub approval and reporting

`@agentplan/adapter-github` provides a REST transport, a `GitHubApprovalAdapter` and a `GitHubCapabilityReporter`. The approval adapter creates a sanitized issue comment, then accepts only a standalone command containing the exact plan ID and SHA-256 content hash:

```text
/agentplan approve plan_01JXYZ sha256:...
/agentplan deny plan_01JXYZ sha256:...
```

The commenter must have `write`, `maintain` or `admin` permission in the repository. The adapter fails closed on timeout, plan-integrity mismatch or unauthorized comments. Use a short-lived token with only the repository permissions required for issue comments.

The reporter updates a marked capability comment instead of creating duplicates. Capability additions are classified as notes, warnings or errors and can be serialized as SARIF through `capabilityDiffToSarif`.

## Custom executor

```ts
import type { ActionExecutor } from "@agentplan/core";

const executor: ActionExecutor = {
  name: "internal-ticketing",
  supports: (action) => action.type === "custom" && action.resource.kind === "ticket",
  async preview(action) {
    return { summary: `Update ${action.resource.identifier}`, details: ["Preview is read-only."] };
  },
  async execute(action) {
    return { success: true, summary: "Ticket updated", affectedResources: [action.resource] };
  }
};
```

Register executors explicitly at apply time. Never let an adapter bypass core policy or reuse an approval for a newly requested action.
