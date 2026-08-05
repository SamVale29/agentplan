import { ActionType, type AgentPlanAction, type PolicyDecision, type PolicyEvaluation } from "./model.js";
import type { AgentPlanConfig } from "./config.js";
import { getCommandDisplay } from "./risk.js";
import { isPrivateHost, isRecord, isWithin, matchesGlob, toWorkspaceIdentifier } from "./utils.js";

type PolicyAction = Pick<AgentPlanAction, "type" | "resource" | "input" | "risk">;

function result(decision: PolicyDecision, rule: string, configPath: string, reason: string): PolicyEvaluation {
  return { decision, rule, configPath, reason };
}

function pathMatches(identifier: string, patterns: readonly string[], workspaceRoot: string): boolean {
  const absolute = identifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(identifier) ? identifier : `${workspaceRoot}/${identifier}`;
  const workspaceIdentifier = toWorkspaceIdentifier(workspaceRoot, absolute);
  return patterns.some((pattern) => matchesGlob(workspaceIdentifier, pattern, true) || matchesGlob(identifier, pattern, true));
}

function defaultResult(config: AgentPlanConfig): PolicyEvaluation {
  return result(config.defaults.decision, "defaults.decision", "defaults.decision", `no more specific rule matched; default decision is ${config.defaults.decision}`);
}

function filesystemPolicy(action: PolicyAction, config: AgentPlanConfig, workspaceRoot: string): PolicyEvaluation[] {
  const identifier = action.resource.identifier;
  const absolute = identifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(identifier) ? identifier : `${workspaceRoot}/${identifier}`;
  const normalized = toWorkspaceIdentifier(workspaceRoot, absolute);
  if (!isWithin(workspaceRoot, absolute)) {
    return [result("deny", "workspace.root", "workspace.root", "resource is outside the configured workspace")];
  }
  const denyIndex = config.workspace.deny.findIndex((pattern) => pathMatches(normalized, [pattern], workspaceRoot));
  if (denyIndex >= 0) {
    return [result("deny", `workspace.deny[${denyIndex}]`, `workspace.deny[${denyIndex}]`, "resource matches an explicit workspace deny pattern")];
  }
  const isRead = action.type === ActionType.FilesystemRead;
  const patterns = isRead ? config.workspace.allowRead : config.workspace.allowWrite;
  const configPath = isRead ? "workspace.allowRead" : "workspace.allowWrite";
  const allowIndex = patterns.findIndex((pattern) => pathMatches(normalized, [pattern], workspaceRoot));
  if (allowIndex >= 0) {
    return [result("allow", `${configPath}[${allowIndex}]`, `${configPath}[${allowIndex}]`, `resource ${normalized} matches an allowed workspace pattern`)];
  }
  return [defaultResult(config)];
}

function shellPolicy(action: PolicyAction, config: AgentPlanConfig): PolicyEvaluation[] {
  const command = getCommandDisplay(action.input);
  const deniedIndex = config.shell.deny.findIndex((pattern) => matchesGlob(command, pattern));
  if (deniedIndex >= 0) {
    return [result("deny", `shell.deny[${deniedIndex}]`, `shell.deny[${deniedIndex}]`, "command matches an explicit deny pattern")];
  }
  const approvalIndex = config.shell.requireApproval.findIndex((pattern) => matchesGlob(command, pattern));
  if (approvalIndex >= 0) {
    return [result("require-approval", `shell.requireApproval[${approvalIndex}]`, `shell.requireApproval[${approvalIndex}]`, "command matches a rule that requires human approval")];
  }
  const allowIndex = config.shell.allow.findIndex((pattern) => matchesGlob(command, pattern));
  if (allowIndex >= 0) {
    return [result("allow", `shell.allow[${allowIndex}]`, `shell.allow[${allowIndex}]`, "command matches an allowed command pattern")];
  }
  return [defaultResult(config)];
}

function networkPolicy(action: PolicyAction, config: AgentPlanConfig): PolicyEvaluation[] {
  const input = isRecord(action.input) ? action.input : {};
  const urlValue = typeof input.url === "string" ? input.url : action.resource.identifier;
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return [result("deny", "network.url", "network.url", "request URL is invalid")];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return [result("deny", "network.protocol", "network.protocol", "only HTTP and HTTPS requests are supported")];
  }
  if (config.network.denyPrivateNetworks && isPrivateHost(url.hostname)) {
    return [result("deny", "network.denyPrivateNetworks", "network.denyPrivateNetworks", "request targets a private or loopback network")];
  }
  const hostIndex = config.network.allowHosts.findIndex((host) => matchesGlob(url.hostname, host));
  if (hostIndex >= 0) {
    return [result("allow", `network.allowHosts[${hostIndex}]`, `network.allowHosts[${hostIndex}]`, `request host matches the configured network allowlist`)];
  }
  if (config.network.requireApprovalForUnknownHosts) {
    return [result("require-approval", "network.requireApprovalForUnknownHosts", "network.requireApprovalForUnknownHosts", "request host is not in the configured allowlist")];
  }
  return [defaultResult(config)];
}

function configuredDecision(action: PolicyAction, config: AgentPlanConfig): PolicyEvaluation[] | undefined {
  if (action.type === ActionType.DatabaseRead) {
    const decision = config.project.environment === "production" && config.database.production.read ? config.database.production.read : config.database.read;
    return [result(decision, "database.read", "database.read", `database read policy for ${config.project.environment} is ${decision}`)];
  }
  if (action.type === ActionType.DatabaseWrite) {
    const decision = config.project.environment === "production" && config.database.production.write ? config.database.production.write : config.database.write;
    return [result(decision, "database.write", "database.write", `database write policy for ${config.project.environment} is ${decision}`)];
  }
  if (action.type === ActionType.DatabaseSchema) {
    const decision = config.project.environment === "production" && config.database.production.schema ? config.database.production.schema : config.database.schema;
    return [result(decision, "database.schema", "database.schema", `database schema policy for ${config.project.environment} is ${decision}`)];
  }
  if (action.type === ActionType.GitRead) {
    return [result(config.git.read, "git.read", "git.read", `git read policy is ${config.git.read}`)];
  }
  if (action.type === ActionType.GitWrite) {
    return [result(config.git.write, "git.write", "git.write", `git write policy is ${config.git.write}`)];
  }
  if (action.type === ActionType.GitCommit) {
    return [result(config.git.commit, "git.commit", "git.commit", `git commit policy is ${config.git.commit}`)];
  }
  if (action.type === ActionType.GitPush) {
    const input = isRecord(action.input) ? action.input : {};
    const force = input.force === true;
    return [force ? result(config.git.forcePush, "git.forcePush", "git.forcePush", `force push policy is ${config.git.forcePush}`) : result(config.git.push, "git.push", "git.push", `git push policy is ${config.git.push}`)];
  }
  if (action.type === ActionType.FinancialCharge) {
    return [result(config.financial.charge, "financial.charge", "financial.charge", `financial charge policy is ${config.financial.charge}`)];
  }
  if (action.type === ActionType.FinancialRefund) {
    const amount = isRecord(action.input) && typeof action.input.amount === "number" ? action.input.amount : 0;
    if (amount > config.financial.refund.maximumAmount) {
      return [result("deny", "financial.refund.maximumAmount", "financial.refund.maximumAmount", `refund amount exceeds the configured maximum of ${config.financial.refund.maximumAmount}`)];
    }
    return [result(config.financial.refund.decision, "financial.refund.decision", "financial.refund.decision", `financial refund policy is ${config.financial.refund.decision}`)];
  }
  return undefined;
}

export function evaluatePolicy(action: PolicyAction, config: AgentPlanConfig, workspaceRoot: string): PolicyEvaluation[] {
  if (action.type.startsWith("filesystem.")) {
    return filesystemPolicy(action, config, workspaceRoot);
  }
  if (action.type === ActionType.ShellExecute) {
    return shellPolicy(action, config);
  }
  if (action.type === ActionType.NetworkRequest) {
    return networkPolicy(action, config);
  }
  if (action.type === ActionType.McpInvoke) {
    return [result(config.mcp.invoke, "mcp.invoke", "mcp.invoke", `MCP invocation policy is ${config.mcp.invoke}`)];
  }
  return configuredDecision(action, config) ?? [defaultResult(config)];
}

export function effectivePolicyDecision(evaluations: readonly PolicyEvaluation[]): PolicyDecision {
  if (evaluations.some((evaluation) => evaluation.decision === "deny")) {
    return "deny";
  }
  if (evaluations.some((evaluation) => evaluation.decision === "require-approval")) {
    return "require-approval";
  }
  return "allow";
}

export function policySummary(evaluations: readonly PolicyEvaluation[]): string {
  return evaluations.map((evaluation) => `${evaluation.decision}: ${evaluation.reason} (${evaluation.configPath})`).join("; ");
}
