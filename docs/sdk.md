# SDK

The SDK wraps application-owned tools without coupling the application to a provider or framework.

```ts
import { createAgentPlan } from "@agentplan/sdk";

const agentPlan = createAgentPlan({
  configFile: "./agentplan.yaml",
  agentName: "customer-support-agent"
});

const writeFile = agentPlan.tool({
  name: "write_file",
  description: "Write content to a file",
  actionType: "filesystem.write",
  mapAction(input) {
    return {
      title: `Write ${input.path}`,
      resource: { kind: "file", identifier: input.path },
      input,
      effects: [`Modify file ${input.path}`],
      permissions: ["filesystem.write"],
      reversible: true
    };
  },
  async execute(input) {
    // Application-owned implementation.
    return { path: input.path };
  }
});

const outcome = await writeFile({ path: "./src/config.ts", content: "..." });
console.log(outcome.plan.planId, outcome.result.summary);
```

`mapAction` produces the canonical resource, effects, permissions and reversibility metadata. The SDK adds source, agent and tool identity. The core then normalizes, scores, evaluates policy, sanitizes persistence, requests approval and invokes `execute` only after approval.

## Tool states

`tool(input)` and `tool.invoke(input)` return an `ExecutionOutcome` with the final plan and result. `tool.preview(input)` creates and persists a plan without calling `execute`.

## Error behavior

Policy denial raises `PolicyBlockedError`. Non-interactive approval requirements raise `ApprovalRequiredError`. Execution failures are represented as failed action results and persisted in the plan. A Node runner started through the CLI maps AgentPlan errors to documented exit codes.

## Data handling

Plan storage contains sanitized action input by default. The callback still receives the application's in-memory input through its closure. Do not put credentials in action descriptions, resource identifiers or error messages. The SDK does not send telemetry to a remote service.

## Custom approval

Pass an `ApprovalAdapter` to `createAgentPlan` to integrate a local UI, the GitHub adapter, Slack, Teams or another system. The adapter must return the approver, method, decision and optional comment; the core adds hash and expiration metadata. GitHub approvals must validate repository permissions and the exact plan hash before returning an approval.
