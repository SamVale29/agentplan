export type AgentPlanErrorCode = "GENERAL" | "CONFIGURATION" | "BLOCKED" | "APPROVAL_REQUIRED" | "DRIFT" | "POLICY" | "INTEGRITY" | "NOT_FOUND";

export class AgentPlanError extends Error {
  public constructor(public readonly code: AgentPlanErrorCode, message: string) {
    super(message);
    this.name = "AgentPlanError";
  }
}

export class PolicyBlockedError extends AgentPlanError {
  public constructor(message: string) {
    super("BLOCKED", message);
    this.name = "PolicyBlockedError";
  }
}

export class ApprovalRequiredError extends AgentPlanError {
  public constructor(message: string) {
    super("APPROVAL_REQUIRED", message);
    this.name = "ApprovalRequiredError";
  }
}

export class PlanIntegrityError extends AgentPlanError {
  public constructor(message: string) {
    super("INTEGRITY", message);
    this.name = "PlanIntegrityError";
  }
}

export class PlanNotFoundError extends AgentPlanError {
  public constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "PlanNotFoundError";
  }
}
