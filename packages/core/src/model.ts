import { z } from "zod";

export const ActionType = {
  FilesystemRead: "filesystem.read",
  FilesystemWrite: "filesystem.write",
  FilesystemDelete: "filesystem.delete",
  FilesystemMove: "filesystem.move",
  ShellExecute: "shell.execute",
  NetworkRequest: "network.request",
  DatabaseRead: "database.read",
  DatabaseWrite: "database.write",
  DatabaseSchema: "database.schema",
  GitRead: "git.read",
  GitWrite: "git.write",
  GitCommit: "git.commit",
  GitPush: "git.push",
  CommunicationSend: "communication.send",
  CloudRead: "cloud.read",
  CloudWrite: "cloud.write",
  CloudDelete: "cloud.delete",
  FinancialCharge: "financial.charge",
  FinancialRefund: "financial.refund",
  IdentityRead: "identity.read",
  IdentityModify: "identity.modify",
  McpInvoke: "mcp.invoke",
  Custom: "custom"
} as const;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export const ActionStatusSchema = z.enum([
  "requested",
  "estimated",
  "declared",
  "approved",
  "denied",
  "executed",
  "blocked",
  "failed",
  "skipped"
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const PolicyDecisionSchema = z.enum(["allow", "deny", "require-approval"]);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyEvaluationSchema = z.object({
  decision: PolicyDecisionSchema,
  rule: z.string().min(1),
  configPath: z.string().min(1),
  reason: z.string().min(1)
});
export type PolicyEvaluation = z.infer<typeof PolicyEvaluationSchema>;

export const RiskAssessmentSchema = z.object({
  level: RiskLevelSchema,
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string().min(1))
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

export const ActionSourceSchema = z.object({
  adapter: z.string().min(1),
  provider: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
  tool: z.string().min(1).optional()
});
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const ResourceSchema = z.object({
  kind: z.string().min(1),
  identifier: z.string().min(1),
  displayName: z.string().min(1).optional()
});
export type Resource = z.infer<typeof ResourceSchema>;

export const ActionTimestampsSchema = z.object({
  requestedAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  executedAt: z.string().datetime().optional()
});
export type ActionTimestamps = z.infer<typeof ActionTimestampsSchema>;

export const AgentPlanActionSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  source: ActionSourceSchema,
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  status: ActionStatusSchema,
  resource: ResourceSchema,
  input: z.unknown(),
  sanitizedInput: z.unknown(),
  effects: z.array(z.string()),
  permissions: z.array(z.string()),
  reversible: z.boolean(),
  rollbackStrategy: z.string().optional(),
  risk: RiskAssessmentSchema,
  policyResults: z.array(PolicyEvaluationSchema),
  timestamps: ActionTimestampsSchema
});
export type AgentPlanAction = z.infer<typeof AgentPlanActionSchema>;

export const ApprovalSchema = z.object({
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
  actions: z.array(z.string().min(1)),
  planHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
  comment: z.string().optional(),
  method: z.enum(["interactive", "pre-approved-policy", "external"])
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ActionResultSchema = z.object({
  success: z.boolean(),
  summary: z.string().min(1),
  output: z.unknown().optional(),
  affectedResources: z.array(ResourceSchema).default([]),
  error: z.string().optional()
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const DriftLevelSchema = z.enum(["no-drift", "minor", "significant", "critical"]);
export type DriftLevel = z.infer<typeof DriftLevelSchema>;

export const DriftReportSchema = z.object({
  level: DriftLevelSchema,
  reasons: z.array(z.string()),
  plannedActions: z.number().int().nonnegative(),
  approvedActions: z.number().int().nonnegative(),
  executedActions: z.number().int().nonnegative(),
  unexpectedResources: z.array(ResourceSchema).default([])
});
export type DriftReport = z.infer<typeof DriftReportSchema>;

export const ExecutionSummarySchema = z.object({
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  results: z.record(z.string(), ActionResultSchema),
  drift: DriftReportSchema.optional()
});
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;

export const PlanStatusSchema = z.enum([
  "draft",
  "waiting-for-approval",
  "approved",
  "denied",
  "applying",
  "completed",
  "failed",
  "blocked",
  "expired"
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const AgentPlanSchema = z.object({
  planId: z.string().min(1),
  schemaVersion: z.literal("1.0.0"),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  agent: z.string().min(1),
  environment: z.string().min(1),
  status: PlanStatusSchema,
  actions: z.array(AgentPlanActionSchema),
  policies: z.array(z.string()),
  approval: ApprovalSchema.optional(),
  execution: ExecutionSummarySchema.optional()
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const AgentCapabilitiesSchema = z.object({
  adapter: z.string().min(1),
  tools: z.array(z.string()),
  permissions: z.array(z.string()),
  referencedEnvironmentVariables: z.array(z.string()),
  filesystem: z.object({
    read: z.boolean(),
    write: z.boolean(),
    delete: z.boolean(),
    workspaceBound: z.boolean()
  }),
  externalHosts: z.array(z.string()),
  destructiveActions: z.array(z.string())
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  event: z.enum([
    "plan.created",
    "action.requested",
    "policy.evaluated",
    "approval.requested",
    "approval.granted",
    "approval.denied",
    "action.executed",
    "action.failed",
    "drift.detected",
    "plan.completed"
  ]),
  planId: z.string().min(1),
  actionId: z.string().optional(),
  timestamp: z.string().datetime(),
  actor: z.string().optional(),
  data: z.unknown()
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export interface RawAction {
  type: string;
  title: string;
  description?: string;
  source?: ActionSource;
  resource: Resource;
  input: unknown;
  effects?: string[];
  permissions?: string[];
  reversible?: boolean;
  rollbackStrategy?: string;
}

export const RawActionSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  source: ActionSourceSchema.optional(),
  resource: ResourceSchema,
  input: z.unknown(),
  effects: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  reversible: z.boolean().optional(),
  rollbackStrategy: z.string().optional()
});

export const RawActionsDocumentSchema = z.union([
  z.array(RawActionSchema),
  z.object({ agent: z.string().min(1).optional(), actions: z.array(RawActionSchema) })
]);

export interface ActionPreview {
  summary: string;
  details: string[];
  estimatedDiff?: string;
}

export interface ActionExecutor {
  readonly name: string;
  supports(action: AgentPlanAction): boolean;
  preview(action: AgentPlanAction): Promise<ActionPreview>;
  execute(action: AgentPlanAction): Promise<ActionResult>;
  rollback?(action: AgentPlanAction): Promise<ActionResult>;
}

export interface ApprovalRequest {
  plan: AgentPlan;
  actions: AgentPlanAction[];
}

export interface ApprovalDecision {
  approved: boolean;
  approvedBy: string;
  comment?: string;
  method: Approval["method"];
}

export interface ApprovalAdapter {
  request(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface PlanStore {
  initialize(): Promise<void>;
  savePlan(plan: AgentPlan): Promise<void>;
  getPlan(planId: string): Promise<AgentPlan | undefined>;
  listPlans(): Promise<AgentPlan[]>;
  appendAudit(event: AuditEvent): Promise<void>;
  getAudit(planId: string): Promise<AuditEvent[]>;
}
