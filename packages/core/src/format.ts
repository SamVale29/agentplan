import type { AgentPlan, AgentPlanAction, RiskLevel } from "./model.js";
import { getCommandDisplay } from "./risk.js";
import { isRecord } from "./utils.js";

const riskLabel: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

function inputSummary(action: AgentPlanAction): string[] {
  const input = isRecord(action.sanitizedInput) ? action.sanitizedInput : {};
  if (action.type === "shell.execute") {
    const command = getCommandDisplay(input);
    return command ? [`Command: ${command}`] : [];
  }
  if (action.type === "network.request" && typeof input.url === "string") {
    return [`URL: ${input.url}`, ...(typeof input.method === "string" ? [`Method: ${input.method}`] : [])];
  }
  if (typeof input.path === "string") {
    return [`Path: ${input.path}`];
  }
  return [];
}

export function formatAction(action: AgentPlanAction): string {
  const lines = [`${action.sequence}. ${action.title}`, `   Type: ${action.type}`, `   Resource: ${action.resource.displayName ?? action.resource.identifier}`, `   Risk: ${riskLabel[action.risk.level]} (${action.risk.score}/100)`, `   Reversible: ${action.reversible ? "Yes" : "No"}`, `   Status: ${action.status}`];
  for (const detail of inputSummary(action)) {
    lines.push(`   ${detail}`);
  }
  if (action.risk.reasons.length > 0) {
    lines.push(`   Why: ${action.risk.reasons.join("; ")}`);
  }
  for (const evaluation of action.policyResults) {
    const marker = evaluation.decision === "allow" ? "OK" : evaluation.decision === "deny" ? "BLOCK" : "REVIEW";
    lines.push(`   Policy [${marker}]: ${evaluation.reason} (${evaluation.configPath})`);
  }
  return lines.join("\n");
}

export function formatPlan(plan: AgentPlan): string {
  const sections = [
    "AgentPlan",
    "",
    `Plan ID: ${plan.planId}`,
    `Agent: ${plan.agent}`,
    `Environment: ${plan.environment}`,
    `Status: ${plan.status}`,
    `Risk: ${plan.actions.reduce((total, action) => Math.max(total, action.risk.score), 0)}/100`,
    "",
    "Proposed actions:",
    plan.actions.map(formatAction).join("\n\n"),
    "",
    `Plan hash: ${plan.contentHash}`
  ];
  return sections.join("\n");
}

export function formatApplySummary(plan: AgentPlan): string {
  const results = plan.execution ? Object.values(plan.execution.results) : [];
  const failed = results.filter((result) => !result.success).length;
  const executed = results.filter((result) => result.success).length;
  const drift = plan.execution?.drift?.level ?? "no-drift";
  return [
    "Apply complete",
    "",
    `Approved: ${plan.approval?.actions.length ?? 0}`,
    `Executed: ${executed}`,
    `Failed: ${failed}`,
    `Blocked: ${plan.actions.filter((action) => action.status === "blocked").length}`,
    "",
    `Drift detected: ${drift === "no-drift" ? "No" : drift}`,
    `Plan hash: ${plan.contentHash}`
  ].join("\n");
}
