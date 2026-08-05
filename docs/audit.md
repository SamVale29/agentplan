# Audit and observability

The local audit layer records structured JSONL events under `.agentplan/audit/<plan-id>.jsonl`.

## Events

`plan.created`, `action.requested`, `policy.evaluated`, `approval.requested`, `approval.granted`, `approval.denied`, `action.executed`, `action.failed`, `drift.detected` and `plan.completed` are part of the MVP event vocabulary.

Events contain an ID, plan ID, timestamp, optional action ID and sanitized data. `audit.storeInputs: sanitized` is the default. `none` can be used when even sanitized input should not be retained.

## Commands

```bash
pnpm exec agentplan audit list
pnpm exec agentplan audit show <PLAN_ID>
```

## Drift

After apply, AgentPlan compares approved actions, result IDs, success/failure and affected resources. A result for an unknown action or a resource outside the plan is critical drift. Missing results and executor failures are significant drift. Drift does not grant permission to continue; create a new plan for new actions.

## Operational guidance

Treat audit files as security-sensitive. Restrict filesystem access, back them up through an approved mechanism and avoid exporting raw plan files. Remote telemetry is disabled by default and there is no background data upload.

The `PlanStore` and audit interfaces leave room for SQLite and OpenTelemetry integrations, but those are not required by the MVP.
