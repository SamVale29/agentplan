import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentPlanSchema, AuditEventSchema, type AgentPlan, type AuditEvent, type PlanStore } from "./model.js";
import { makeId } from "./utils.js";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function safePlanId(planId: string): void {
  if (!/^plan_[A-Za-z0-9]+$/.test(planId)) {
    throw new Error(`Invalid plan id: ${planId}`);
  }
}

export class FilePlanStore implements PlanStore {
  readonly rootDir: string;
  readonly plansDir: string;
  readonly auditDir: string;
  readonly runsDir: string;

  public constructor(rootDir = ".agentplan") {
    this.rootDir = path.resolve(rootDir);
    this.plansDir = path.join(this.rootDir, "plans");
    this.auditDir = path.join(this.rootDir, "audit");
    this.runsDir = path.join(this.rootDir, "runs");
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.plansDir, { recursive: true }),
      mkdir(this.auditDir, { recursive: true }),
      mkdir(this.runsDir, { recursive: true })
    ]);
  }

  public async savePlan(plan: AgentPlan): Promise<void> {
    AgentPlanSchema.parse(plan);
    await this.initialize();
    safePlanId(plan.planId);
    const target = path.join(this.plansDir, `${plan.planId}.json`);
    const temporary = path.join(this.plansDir, `.${plan.planId}.${makeId("tmp")}.tmp`);
    await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  public async getPlan(planId: string): Promise<AgentPlan | undefined> {
    safePlanId(planId);
    try {
      const source = await readFile(path.join(this.plansDir, `${planId}.json`), "utf8");
      return AgentPlanSchema.parse(JSON.parse(source) as unknown);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  public async listPlans(): Promise<AgentPlan[]> {
    await this.initialize();
    const entries = await readdir(this.plansDir, { withFileTypes: true });
    const plans: AgentPlan[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) {
        continue;
      }
      const planId = entry.name.slice(0, -5);
      const plan = await this.getPlan(planId);
      if (plan) {
        plans.push(plan);
      }
    }
    return plans.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public async appendAudit(event: AuditEvent): Promise<void> {
    AuditEventSchema.parse(event);
    await this.initialize();
    safePlanId(event.planId);
    const target = path.join(this.auditDir, `${event.planId}.jsonl`);
    await appendFile(target, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  public async getAudit(planId: string): Promise<AuditEvent[]> {
    safePlanId(planId);
    try {
      const source = await readFile(path.join(this.auditDir, `${planId}.jsonl`), "utf8");
      return source.split(/\r?\n/).filter((line) => line.length > 0).map((line) => AuditEventSchema.parse(JSON.parse(line) as unknown));
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }
}
