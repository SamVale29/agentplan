import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { PolicyDecisionSchema, RiskLevelSchema, type PolicyDecision, type RiskLevel } from "./model.js";

const WorkspaceConfigSchema = z.object({
  root: z.string().default("."),
  allowRead: z.array(z.string()).default([]),
  allowWrite: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([])
});

const ShellConfigSchema = z.object({
  allow: z.array(z.string()).default([]),
  requireApproval: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([])
});

const NetworkConfigSchema = z.object({
  allowHosts: z.array(z.string()).default([]),
  denyPrivateNetworks: z.boolean().default(true),
  requireApprovalForUnknownHosts: z.boolean().default(true)
});

const DatabaseConfigSchema = z.object({
  read: PolicyDecisionSchema.default("deny"),
  write: PolicyDecisionSchema.default("deny"),
  schema: PolicyDecisionSchema.default("deny"),
  production: z.object({
    read: PolicyDecisionSchema.optional(),
    write: PolicyDecisionSchema.optional(),
    schema: PolicyDecisionSchema.optional()
  }).default({ write: "deny" })
});

const GitConfigSchema = z.object({
  read: PolicyDecisionSchema.default("allow"),
  write: PolicyDecisionSchema.default("require-approval"),
  commit: PolicyDecisionSchema.default("require-approval"),
  push: PolicyDecisionSchema.default("deny"),
  forcePush: PolicyDecisionSchema.default("deny")
});

const FinancialConfigSchema = z.object({
  charge: PolicyDecisionSchema.default("deny"),
  refund: z.object({
    decision: PolicyDecisionSchema.default("deny"),
    maximumAmount: z.number().nonnegative().default(0)
  }).default({ decision: "deny", maximumAmount: 0 })
});

const RedactionConfigSchema = z.object({
  environmentVariables: z.array(z.string()).default([]),
  additionalPatterns: z.array(z.string()).default([])
});

const AuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  storeInputs: z.enum(["none", "sanitized"]).default("sanitized")
});

const RiskConfigSchema = z.object({
  thresholds: z.object({
    low: z.number().int().min(0).max(100).default(24),
    medium: z.number().int().min(0).max(100).default(49),
    high: z.number().int().min(0).max(100).default(74)
  }).default({ low: 24, medium: 49, high: 74 }),
  weights: z.record(z.string(), z.number()).default({})
});

export const AgentPlanConfigSchema = z.object({
  version: z.literal("1").default("1"),
  project: z.object({
    name: z.string().min(1).default("agentplan-project"),
    environment: z.string().min(1).default("development")
  }).default({ name: "agentplan-project", environment: "development" }),
  defaults: z.object({
    decision: PolicyDecisionSchema.default("deny"),
    requireApprovalFrom: RiskLevelSchema.default("medium"),
    preApproveLowRisk: z.boolean().default(true)
  }).default({ decision: "deny", requireApprovalFrom: "medium", preApproveLowRisk: true }),
  workspace: WorkspaceConfigSchema.default({ root: ".", allowRead: [], allowWrite: [], deny: [] }),
  shell: ShellConfigSchema.default({ allow: [], requireApproval: [], deny: [] }),
  network: NetworkConfigSchema.default({ allowHosts: [], denyPrivateNetworks: true, requireApprovalForUnknownHosts: true }),
  mcp: z.object({ invoke: PolicyDecisionSchema.default("deny") }).default({ invoke: "deny" }),
  database: DatabaseConfigSchema.default({
    read: "deny",
    write: "deny",
    schema: "deny",
    production: { write: "deny" }
  }),
  git: GitConfigSchema.default({
    read: "allow",
    write: "require-approval",
    commit: "require-approval",
    push: "deny",
    forcePush: "deny"
  }),
  financial: FinancialConfigSchema.default({
    charge: "deny",
    refund: { decision: "deny", maximumAmount: 0 }
  }),
  redaction: RedactionConfigSchema.default({ environmentVariables: [], additionalPatterns: [] }),
  audit: AuditConfigSchema.default({ enabled: true, storeInputs: "sanitized" }),
  risk: RiskConfigSchema.default({ thresholds: { low: 24, medium: 49, high: 74 }, weights: {} })
});

export type AgentPlanConfig = z.infer<typeof AgentPlanConfigSchema>;
export type LoadedConfig = {
  config: AgentPlanConfig;
  filePath: string;
  workspaceRoot: string;
};

export function createDefaultConfig(projectName = "agentplan-project"): AgentPlanConfig {
  return AgentPlanConfigSchema.parse({
    version: "1",
    project: { name: projectName, environment: "development" },
    defaults: { decision: "deny", requireApprovalFrom: "medium", preApproveLowRisk: true },
    workspace: { root: ".", allowRead: [], allowWrite: [], deny: [] },
    shell: { allow: [], requireApproval: [], deny: [] },
    network: { allowHosts: [], denyPrivateNetworks: true, requireApprovalForUnknownHosts: true },
    mcp: { invoke: "deny" },
    database: { read: "deny", write: "deny", schema: "deny", production: { write: "deny" } },
    git: { read: "allow", write: "require-approval", commit: "require-approval", push: "deny", forcePush: "deny" },
    financial: { charge: "deny", refund: { decision: "deny", maximumAmount: 0 } },
    redaction: {
      environmentVariables: ["*_API_KEY", "*_TOKEN", "*_SECRET", "*_PASSWORD"],
      additionalPatterns: []
    },
    audit: { enabled: true, storeInputs: "sanitized" },
    risk: { thresholds: { low: 24, medium: 49, high: 74 }, weights: {} }
  });
}

export function serializeConfig(config: AgentPlanConfig): string {
  return stringify(config, { indent: 2 });
}

export async function loadConfig(configFile: string): Promise<LoadedConfig> {
  const filePath = path.resolve(configFile);
  const source = await readFile(filePath, "utf8");
  const parsed: unknown = parse(source);
  const config = AgentPlanConfigSchema.parse(parsed);
  const workspaceRoot = path.resolve(path.dirname(filePath), config.workspace.root);
  return { config, filePath, workspaceRoot };
}

export function riskLevelRank(level: RiskLevel): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[level];
}

export function decisionRank(decision: PolicyDecision): number {
  return { allow: 0, "require-approval": 1, deny: 2 }[decision];
}
