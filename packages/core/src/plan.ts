import { AgentPlanActionSchema, AgentPlanSchema, type AgentPlan, type AgentPlanAction, type Approval, type ApprovalDecision, type PlanStatus, type RawAction } from "./model.js";
import type { AgentPlanConfig } from "./config.js";
import { riskLevelRank } from "./config.js";
import { effectivePolicyDecision, evaluatePolicy } from "./policy.js";
import { assessRisk } from "./risk.js";
import { makeId, sha256, stableStringify } from "./utils.js";

export interface CreatePlanOptions {
  agent?: string;
  planId?: string;
  createdAt?: string;
}

function optionalProperty<T extends Record<string, unknown>, K extends string>(object: T, key: K, value: unknown): T & Record<K, unknown> {
  if (value === undefined) {
    return object as T & Record<K, unknown>;
  }
  return { ...object, [key]: value } as T & Record<K, unknown>;
}

export function normalizeAction(raw: RawAction, planId: string, sequence: number, config: AgentPlanConfig, workspaceRoot: string, requestedAt = new Date().toISOString()): AgentPlanAction {
  const risk = assessRisk(raw, config, { environment: config.project.environment, workspaceRoot });
  const source = raw.source ?? { adapter: "generic-tool" };
  const policyInput = {
    type: raw.type,
    resource: raw.resource,
    input: raw.input,
    risk
  } as Pick<AgentPlanAction, "type" | "resource" | "input" | "risk">;
  const policyResults = evaluatePolicy(policyInput, config, workspaceRoot);
  const base = {
    id: makeId("action"),
    planId,
    sequence,
    source,
    type: raw.type,
    title: raw.title,
    status: effectivePolicyDecision(policyResults) === "deny" ? "blocked" : "requested",
    resource: raw.resource,
    input: raw.input,
    sanitizedInput: raw.input,
    effects: raw.effects ?? [],
    permissions: raw.permissions ?? [raw.type],
    reversible: raw.reversible ?? false,
    risk,
    policyResults,
    timestamps: { requestedAt }
  } satisfies Omit<AgentPlanAction, "description" | "rollbackStrategy"> & Record<string, unknown>;
  const withDescription = optionalProperty(base, "description", raw.description);
  const withRollback = optionalProperty(withDescription, "rollbackStrategy", raw.rollbackStrategy);
  return AgentPlanActionSchema.parse(withRollback);
}

function contentProjection(plan: AgentPlan): unknown {
  return {
    planId: plan.planId,
    schemaVersion: plan.schemaVersion,
    createdAt: plan.createdAt,
    agent: plan.agent,
    environment: plan.environment,
    policies: plan.policies,
    actions: plan.actions.map((action) => {
      const { status: _status, timestamps: _timestamps, ...content } = action;
      return content;
    })
  };
}

export function hashPlanContent(plan: AgentPlan): string {
  return sha256(contentProjection(plan));
}

export function assertPlanIntegrity(plan: AgentPlan): void {
  const expected = hashPlanContent(plan);
  if (expected !== plan.contentHash) {
    throw new Error(`Plan integrity check failed: expected ${expected}, found ${plan.contentHash}`);
  }
}

export function actionApprovalRequirement(action: AgentPlanAction, config: AgentPlanConfig): "allow" | "require-approval" | "deny" {
  const policyDecision = effectivePolicyDecision(action.policyResults);
  if (policyDecision === "deny") {
    return "deny";
  }
  if (policyDecision === "require-approval") {
    return "require-approval";
  }
  if (!config.defaults.preApproveLowRisk || riskLevelRank(action.risk.level) >= riskLevelRank(config.defaults.requireApprovalFrom)) {
    return "require-approval";
  }
  return "allow";
}

export function createPlan(rawActions: readonly RawAction[], config: AgentPlanConfig, workspaceRoot: string, options: CreatePlanOptions = {}): AgentPlan {
  const planId = options.planId ?? makeId("plan");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const actions = rawActions.map((raw, index) => normalizeAction(raw, planId, index + 1, config, workspaceRoot, createdAt));
  const policies = [...new Set(actions.flatMap((action) => action.policyResults.map((evaluation) => evaluation.configPath)))];
  const planWithoutHash: AgentPlan = {
    planId,
    schemaVersion: "1.0.0",
    contentHash: "sha256:" + "0".repeat(64),
    createdAt,
    agent: options.agent ?? "unknown-agent",
    environment: config.project.environment,
    status: actions.some((action) => action.status === "blocked") ? "blocked" : actions.some((action) => actionApprovalRequirement(action, config) === "require-approval") ? "waiting-for-approval" : "draft",
    actions,
    policies
  };
  const plan = { ...planWithoutHash, contentHash: hashPlanContent(planWithoutHash) };
  return AgentPlanSchema.parse(plan);
}

export function withSanitizedInputs(plan: AgentPlan, sanitize: (value: unknown) => unknown): AgentPlan {
  const actions = plan.actions.map((action) => {
    const sanitizedInput = sanitize(action.input);
    return { ...action, input: sanitizedInput, sanitizedInput };
  });
  const updated = { ...plan, actions };
  return AgentPlanSchema.parse({ ...updated, contentHash: hashPlanContent(updated) });
}

export function approvePlan(plan: AgentPlan, decision: ApprovalDecision, ttlMinutes = 60, now = new Date()): AgentPlan {
  assertPlanIntegrity(plan);
  if (!decision.approved) {
    return denyPlan(plan, now);
  }
  const approvedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const approval: Approval = {
    approvedBy: decision.approvedBy,
    approvedAt,
    actions: plan.actions.filter((action) => action.status !== "blocked" && action.status !== "denied").map((action) => action.id),
    planHash: plan.contentHash,
    expiresAt,
    ...(decision.comment === undefined ? {} : { comment: decision.comment }),
    method: decision.method
  };
  const actions = plan.actions.map((action) => action.status === "blocked" ? action : { ...action, status: "approved" as const, timestamps: { ...action.timestamps, approvedAt } });
  return AgentPlanSchema.parse({ ...plan, status: "approved", actions, approval });
}

export function denyPlan(plan: AgentPlan, now = new Date()): AgentPlan {
  const actions = plan.actions.map((action) => action.status === "executed" ? action : { ...action, status: "denied" as const });
  return AgentPlanSchema.parse({ ...plan, status: "denied", actions, approval: undefined });
}

export function isApprovalValid(plan: AgentPlan, now = new Date()): boolean {
  if (!plan.approval || plan.approval.planHash !== plan.contentHash) {
    return false;
  }
  return new Date(plan.approval.expiresAt).getTime() > now.getTime();
}

export function updatePlanStatus(plan: AgentPlan, status: PlanStatus): AgentPlan {
  return AgentPlanSchema.parse({ ...plan, status });
}

export function serializePlan(plan: AgentPlan): string {
  return `${stableStringify(plan)}\n`;
}
