import type { ActionResult, AgentPlan, DriftReport, Resource } from "./model.js";

function resourceKey(resource: Resource): string {
  return `${resource.kind}:${resource.identifier}`;
}

export function detectDrift(plan: AgentPlan, results: Readonly<Record<string, ActionResult>>): DriftReport {
  const approved = plan.actions.filter((action) => action.status === "approved" || action.status === "executed");
  const executed = plan.actions.filter((action) => action.id in results);
  const plannedResources = new Set(plan.actions.map((action) => resourceKey(action.resource)));
  const unexpectedResources: Resource[] = [];
  const reasons: string[] = [];
  let level: DriftReport["level"] = "no-drift";

  if (executed.length !== approved.length) {
    level = "significant";
    reasons.push(`expected ${approved.length} approved action results but received ${executed.length}`);
  }
  for (const [actionId, result] of Object.entries(results)) {
    if (!plan.actions.some((action) => action.id === actionId)) {
      level = "critical";
      reasons.push(`execution returned a result for unknown action ${actionId}`);
      continue;
    }
    if (!result.success) {
      level = level === "critical" ? level : "significant";
      reasons.push(`action ${actionId} failed during execution`);
    }
    for (const resource of result.affectedResources) {
      if (!plannedResources.has(resourceKey(resource))) {
        unexpectedResources.push(resource);
      }
    }
  }
  if (unexpectedResources.length > 0) {
    level = "critical";
    reasons.push("execution affected resources that were not present in the approved plan");
  }

  return {
    level,
    reasons: [...new Set(reasons)],
    plannedActions: plan.actions.length,
    approvedActions: approved.length,
    executedActions: executed.length,
    unexpectedResources
  };
}
