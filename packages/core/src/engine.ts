import { ActionResultSchema, AgentPlanSchema, type ActionExecutor, type ActionResult, type AgentPlan, type AgentPlanAction, type ApprovalAdapter, type ApprovalDecision, type PlanStore, type RawAction } from "./model.js";
import type { AgentPlanConfig } from "./config.js";
import { approvePlan, assertPlanIntegrity, actionApprovalRequirement, createPlan, denyPlan, isApprovalValid, updatePlanStatus, withSanitizedInputs } from "./plan.js";
import { detectDrift } from "./drift.js";
import { createAuditEvent } from "./audit.js";
import { InteractiveApprovalAdapter } from "./approval.js";
import { redactValue } from "./redaction.js";
import { ApprovalRequiredError, PlanIntegrityError, PlanNotFoundError, PolicyBlockedError } from "./errors.js";
import { isRecord } from "./utils.js";

export interface EngineOptions {
  config: AgentPlanConfig;
  workspaceRoot: string;
  store: PlanStore;
  approvalAdapter?: ApprovalAdapter;
  nonInteractive?: boolean;
  approvalTtlMinutes?: number;
  actor?: string;
}

export interface ExecutionOutcome {
  plan: AgentPlan;
  result: ActionResult;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asActionResult(value: unknown, action: AgentPlanAction): ActionResult {
  if (isRecord(value) && typeof value.success === "boolean" && typeof value.summary === "string") {
    return ActionResultSchema.parse(value);
  }
  const result = {
    success: true,
    summary: `Executed ${action.title}`,
    affectedResources: [action.resource],
    ...(value === undefined ? {} : { output: value })
  };
  return ActionResultSchema.parse(result);
}

function sanitizedResult(value: ActionResult, config: AgentPlanConfig): ActionResult {
  const base = {
    ...value,
    ...(value.output === undefined ? {} : { output: redactValue(value.output, { environmentPatterns: config.redaction.environmentVariables, additionalPatterns: config.redaction.additionalPatterns }) }),
    ...(value.error === undefined ? {} : { error: redactValue(value.error, { environmentPatterns: config.redaction.environmentVariables, additionalPatterns: config.redaction.additionalPatterns }) as string })
  };
  return ActionResultSchema.parse(base);
}

export class AgentPlanEngine {
  private readonly config: AgentPlanConfig;
  private readonly workspaceRoot: string;
  private readonly store: PlanStore;
  private readonly approvalAdapter: ApprovalAdapter;
  private readonly nonInteractive: boolean;
  private readonly approvalTtlMinutes: number;
  private readonly actor: string;

  public constructor(options: EngineOptions) {
    this.config = options.config;
    this.workspaceRoot = options.workspaceRoot;
    this.store = options.store;
    this.nonInteractive = options.nonInteractive ?? false;
    this.approvalAdapter = options.approvalAdapter ?? new InteractiveApprovalAdapter(this.nonInteractive);
    this.approvalTtlMinutes = options.approvalTtlMinutes ?? 60;
    this.actor = options.actor ?? process.env.AGENTPLAN_ACTOR ?? "local-user";
  }

  public async initialize(): Promise<void> {
    await this.store.initialize();
  }

  public async create(rawActions: readonly RawAction[], agent = "unknown-agent"): Promise<AgentPlan> {
    await this.initialize();
    let plan = createPlan(rawActions, this.config, this.workspaceRoot, { agent });
    plan = withSanitizedInputs(plan, (value) => redactValue(value, {
      environmentPatterns: this.config.redaction.environmentVariables,
      additionalPatterns: this.config.redaction.additionalPatterns
    }));
    await this.store.savePlan(plan);
    await this.record("plan.created", plan.planId, { actionCount: plan.actions.length, contentHash: plan.contentHash });
    for (const action of plan.actions) {
      await this.record("action.requested", plan.planId, { input: action.sanitizedInput, type: action.type, resource: action.resource }, { actionId: action.id });
      for (const policy of action.policyResults) {
        await this.record("policy.evaluated", plan.planId, policy, { actionId: action.id });
      }
    }
    return plan;
  }

  public async get(planId: string): Promise<AgentPlan> {
    const plan = await this.store.getPlan(planId);
    if (!plan) {
      throw new PlanNotFoundError(`Plan not found: ${planId}`);
    }
    return plan;
  }

  public async list(): Promise<AgentPlan[]> {
    await this.initialize();
    return this.store.listPlans();
  }

  public async approve(planId: string, decision: ApprovalDecision): Promise<AgentPlan> {
    const plan = await this.get(planId);
    try {
      assertPlanIntegrity(plan);
    } catch (error) {
      throw new PlanIntegrityError(errorMessage(error));
    }
    if (plan.status === "blocked") {
      throw new PolicyBlockedError(`Plan ${plan.planId} contains blocked actions and cannot be approved.`);
    }
    const updated = decision.approved ? approvePlan(plan, decision, this.approvalTtlMinutes) : denyPlan(plan);
    await this.store.savePlan(updated);
    await this.record(decision.approved ? "approval.granted" : "approval.denied", updated.planId, { method: decision.method, comment: decision.comment }, { actor: decision.approvedBy });
    return updated;
  }

  public async executeAction(raw: RawAction, execute: (action: AgentPlanAction) => Promise<unknown>, agent = "unknown-agent"): Promise<ExecutionOutcome> {
    let plan = await this.create([raw], agent);
    const action = plan.actions[0];
    if (!action) {
      throw new Error("Cannot execute an empty action plan");
    }
    const requirement = actionApprovalRequirement(action, this.config);
    if (requirement === "deny") {
      plan = updatePlanStatus(plan, "blocked");
      await this.store.savePlan(plan);
      throw new PolicyBlockedError(`Action blocked by policy: ${action.policyResults.map((policy) => policy.reason).join("; ")}`);
    }
    if (requirement === "require-approval") {
      await this.record("approval.requested", plan.planId, { actionIds: [action.id], risk: action.risk });
      if (this.nonInteractive) {
        throw new ApprovalRequiredError(`Approval required for plan ${plan.planId}; rerun interactively or approve it explicitly.`);
      }
      const decision = await this.approvalAdapter.request({ plan, actions: [action] });
      if (!decision.approved) {
        plan = denyPlan(plan);
        await this.store.savePlan(plan);
        await this.record("approval.denied", plan.planId, { comment: decision.comment }, { actor: decision.approvedBy });
        throw new PolicyBlockedError(`Approval denied for plan ${plan.planId}.`);
      }
      plan = approvePlan(plan, decision, this.approvalTtlMinutes);
      await this.record("approval.granted", plan.planId, { method: decision.method, comment: decision.comment }, { actor: decision.approvedBy });
    } else {
      plan = approvePlan(plan, { approved: true, approvedBy: "policy", method: "pre-approved-policy", comment: "Low-risk action allowed by policy." }, this.approvalTtlMinutes);
      await this.record("approval.granted", plan.planId, { method: "pre-approved-policy" }, { actor: "policy" });
    }
    await this.store.savePlan(plan);
    const approvedAction = plan.actions.find((candidate) => candidate.id === action.id);
    if (!approvedAction) {
      throw new Error(`Approved action disappeared from plan ${plan.planId}`);
    }
    let result: ActionResult;
    try {
      result = sanitizedResult(asActionResult(await execute(approvedAction), approvedAction), this.config);
    } catch (error) {
      result = sanitizedResult(ActionResultSchema.parse({ success: false, summary: `Execution failed for ${approvedAction.title}`, error: errorMessage(error), affectedResources: [] }), this.config);
    }
    const timestamp = new Date().toISOString();
    const updatedAction = {
      ...approvedAction,
      status: result.success ? "executed" as const : "failed" as const,
      timestamps: { ...approvedAction.timestamps, executedAt: timestamp }
    };
    const updatedPlan = {
      ...plan,
      status: result.success ? "completed" as const : "failed" as const,
      actions: plan.actions.map((candidate) => candidate.id === updatedAction.id ? updatedAction : candidate),
      execution: {
        startedAt: plan.createdAt,
        completedAt: timestamp,
        results: { [updatedAction.id]: result },
        drift: undefined
      }
    };
    const drift = detectDrift(plan, { [updatedAction.id]: result });
    const finalPlan = { ...updatedPlan, execution: { ...updatedPlan.execution, drift } };
    const parsedPlan = updatePlanStatus(finalPlan, finalPlan.status);
    await this.store.savePlan(parsedPlan);
    await this.record(result.success ? "action.executed" : "action.failed", parsedPlan.planId, result, { actionId: updatedAction.id });
    if (drift.level !== "no-drift") {
      await this.record("drift.detected", parsedPlan.planId, drift);
    }
    await this.record("plan.completed", parsedPlan.planId, { status: parsedPlan.status });
    return { plan: parsedPlan, result };
  }

  public async apply(planId: string, executors: readonly ActionExecutor[]): Promise<AgentPlan> {
    let plan = await this.get(planId);
    try {
      assertPlanIntegrity(plan);
    } catch (error) {
      throw new PlanIntegrityError(errorMessage(error));
    }
    if (!isApprovalValid(plan)) {
      const expired = plan.approval ? updatePlanStatus(plan, "expired") : plan;
      await this.store.savePlan(expired);
      throw new ApprovalRequiredError(`Plan ${plan.planId} has no valid approval for its current hash.`);
    }
    if (plan.status !== "approved") {
      throw new ApprovalRequiredError(`Plan ${plan.planId} is ${plan.status}; only approved plans can be applied.`);
    }
    const approvedPlan = plan;
    plan = updatePlanStatus(plan, "applying");
    await this.store.savePlan(plan);
    const results: Record<string, ActionResult> = {};
    const approvedIds = new Set(approvedPlan.approval?.actions ?? []);
    for (const action of approvedPlan.actions) {
      if (!approvedIds.has(action.id) || action.status === "blocked" || action.status === "denied") {
        continue;
      }
      const executor = executors.find((candidate) => candidate.supports(action));
      let result: ActionResult;
      if (!executor) {
        result = ActionResultSchema.parse({ success: false, summary: `No executor supports ${action.type}`, error: `No executor supports ${action.type}`, affectedResources: [] });
      } else {
        try {
          result = sanitizedResult(await executor.execute(action), this.config);
        } catch (error) {
          result = sanitizedResult(ActionResultSchema.parse({ success: false, summary: `Execution failed for ${action.title}`, error: errorMessage(error), affectedResources: [] }), this.config);
        }
      }
      results[action.id] = result;
      const updatedAction = {
        ...action,
        status: result.success ? "executed" as const : "failed" as const,
        timestamps: { ...action.timestamps, executedAt: new Date().toISOString() }
      };
      plan = { ...plan, actions: plan.actions.map((candidate) => candidate.id === action.id ? updatedAction : candidate) };
      await this.store.savePlan(plan);
      await this.record(result.success ? "action.executed" : "action.failed", plan.planId, result, { actionId: action.id });
    }
    const drift = detectDrift(approvedPlan, results);
    const failed = Object.values(results).some((result) => !result.success);
    const completedAt = new Date().toISOString();
    const finalPlan = {
      ...plan,
      status: failed ? "failed" as const : "completed" as const,
      execution: {
        startedAt: approvedPlan.createdAt,
        completedAt,
        results,
        drift
      }
    };
    const parsedPlan = AgentPlanSchema.parse(finalPlan);
    await this.store.savePlan(parsedPlan);
    if (drift.level !== "no-drift") {
      await this.record("drift.detected", parsedPlan.planId, drift);
    }
    await this.record("plan.completed", parsedPlan.planId, { status: parsedPlan.status });
    return parsedPlan;
  }

  public async audit(planId: string) {
    await this.initialize();
    return this.store.getAudit(planId);
  }

  private async record(event: Parameters<typeof createAuditEvent>[0], planId: string, data: unknown, options: Parameters<typeof createAuditEvent>[3] = {}): Promise<void> {
    if (!this.config.audit.enabled) {
      return;
    }
    const safeData = this.config.audit.storeInputs === "sanitized" ? redactValue(data, { environmentPatterns: this.config.redaction.environmentVariables, additionalPatterns: this.config.redaction.additionalPatterns }) : { redacted: true };
    await this.store.appendAudit(createAuditEvent(event, planId, safeData, { ...options, actor: options.actor ?? this.actor }));
  }
}
