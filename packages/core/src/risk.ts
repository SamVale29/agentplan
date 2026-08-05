import { ActionType, type RiskAssessment, type RawAction } from "./model.js";
import type { AgentPlanConfig } from "./config.js";
import { isPrivateHost, isRecord, matchesGlob } from "./utils.js";
import { isSensitivePath } from "./redaction.js";

export interface RiskContext {
  environment: string;
  workspaceRoot?: string;
}

function stringInput(input: unknown, key: string): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function commandDisplay(input: unknown): string {
  if (!isRecord(input)) {
    return "";
  }
  const argv = input.argv;
  if (Array.isArray(argv) && argv.every((item) => typeof item === "string")) {
    return argv.join(" ");
  }
  const command = input.command;
  const args = input.args;
  if (typeof command === "string") {
    return `${command}${Array.isArray(args) && args.every((item) => typeof item === "string") ? ` ${args.join(" ")}` : ""}`;
  }
  return "";
}

function hasSecretLikeValue(input: unknown): boolean {
  if (typeof input === "string") {
    return /(?:api[_-]?key|token|secret|password|authorization|cookie)\s*[=:]|\bsk-[A-Za-z0-9_-]{12,}\b/i.test(input);
  }
  if (Array.isArray(input)) {
    return input.some((item) => hasSecretLikeValue(item));
  }
  if (isRecord(input)) {
    return Object.entries(input).some(([key, value]) => /(?:api[_-]?key|token|secret|password|authorization|cookie)/i.test(key) || hasSecretLikeValue(value));
  }
  return false;
}

function hasDestructiveCommand(command: string): boolean {
  return /(^|\s)(rm|rmdir|del|format|mkfs|shutdown|reboot)(\s|$)/i.test(command) || /(?:drop|truncate)\s+(database|table)/i.test(command) || /git\s+push\s+.*--force/i.test(command);
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function actionBaseScore(type: string): { score: number; reason: string } {
  switch (type) {
    case ActionType.FilesystemRead:
    case ActionType.DatabaseRead:
    case ActionType.GitRead:
    case ActionType.CloudRead:
    case ActionType.IdentityRead:
      return { score: 8, reason: "operation only reads a resource" };
    case ActionType.FilesystemWrite:
    case ActionType.GitWrite:
    case ActionType.CloudWrite:
      return { score: 30, reason: "operation changes a resource" };
    case ActionType.FilesystemMove:
      return { score: 45, reason: "operation moves a resource" };
    case ActionType.FilesystemDelete:
    case ActionType.CloudDelete:
      return { score: 80, reason: "operation deletes a resource" };
    case ActionType.ShellExecute:
      return { score: 42, reason: "operation executes a local command" };
    case ActionType.NetworkRequest:
      return { score: 28, reason: "operation contacts an external system" };
    case ActionType.DatabaseWrite:
      return { score: 62, reason: "operation changes database data" };
    case ActionType.DatabaseSchema:
      return { score: 78, reason: "operation changes database schema" };
    case ActionType.GitCommit:
      return { score: 48, reason: "operation creates a repository commit" };
    case ActionType.GitPush:
      return { score: 82, reason: "operation publishes repository changes" };
    case ActionType.CommunicationSend:
      return { score: 70, reason: "operation sends a message to another party" };
    case ActionType.FinancialCharge:
      return { score: 95, reason: "operation can create a financial charge" };
    case ActionType.FinancialRefund:
      return { score: 72, reason: "operation can create a financial refund" };
    case ActionType.IdentityModify:
      return { score: 88, reason: "operation changes identity or access" };
    case ActionType.McpInvoke:
      return { score: 45, reason: "operation invokes an external tool through MCP" };
    default:
      return { score: 40, reason: "custom operation has an unknown impact" };
  }
}

export function assessRisk(action: RawAction, config: AgentPlanConfig, context: RiskContext): RiskAssessment {
  const base = actionBaseScore(action.type);
  let score = base.score;
  const reasons: string[] = [base.reason];
  const identifier = action.resource.identifier;
  const input = action.input;

  if (action.reversible === false) {
    score += 18;
    addReason(reasons, "operation is not automatically reversible");
  }
  if (action.effects && action.effects.length >= 3) {
    score += 8;
    addReason(reasons, "operation declares multiple side effects");
  }
  if (hasSecretLikeValue(input)) {
    score += 18;
    addReason(reasons, "input may contain sensitive credentials");
  }
  if (isSensitivePath(identifier)) {
    score += 25;
    addReason(reasons, "resource looks like a sensitive file or directory");
  }
  if (context.environment.toLowerCase() === "production" || /production/i.test(identifier)) {
    score += 22;
    addReason(reasons, "target environment is production");
  }

  if (action.type === ActionType.ShellExecute) {
    const command = commandDisplay(input);
    if (hasDestructiveCommand(command)) {
      score += 35;
      addReason(reasons, "command matches a destructive operation pattern");
    }
    if (command.includes("|") || command.includes(">") || command.includes("&&") || command.includes(";")) {
      score += 15;
      addReason(reasons, "command contains shell composition or redirection syntax");
    }
    if (/curl|wget/i.test(command)) {
      score += 12;
      addReason(reasons, "command downloads content from the network");
    }
  }

  if (action.type === ActionType.NetworkRequest) {
    const urlValue = stringInput(input, "url") ?? identifier;
    try {
      const url = new URL(urlValue);
      if (isPrivateHost(url.hostname)) {
        score += 35;
        addReason(reasons, "request targets a private or loopback network address");
      } else if (!config.network.allowHosts.some((host) => matchesGlob(url.hostname, host))) {
        score += 18;
        addReason(reasons, "request targets a host outside the configured allowlist");
      }
    } catch {
      score += 25;
      addReason(reasons, "request URL could not be validated");
    }
  }

  if (isRecord(input)) {
    const amount = input.amount;
    if (typeof amount === "number" && amount > 100) {
      score += 15;
      addReason(reasons, "financial amount exceeds the small-transaction threshold");
    }
    const count = input.count;
    if (typeof count === "number" && count > 100) {
      score += 12;
      addReason(reasons, "operation may affect a large number of records");
    }
  }

  const configuredWeight = config.risk.weights[action.type];
  if (configuredWeight !== undefined) {
    score += configuredWeight;
    addReason(reasons, `configuration adds a ${configuredWeight}-point weight for ${action.type}`);
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const thresholds = config.risk.thresholds;
  const level = boundedScore <= thresholds.low ? "low" : boundedScore <= thresholds.medium ? "medium" : boundedScore <= thresholds.high ? "high" : "critical";
  return { score: boundedScore, level, reasons };
}

export function getCommandDisplay(input: unknown): string {
  return commandDisplay(input);
}
