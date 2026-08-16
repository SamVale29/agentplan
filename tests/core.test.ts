import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ActionResultSchema,
  ActionType,
  AgentPlanConfigSchema,
  AgentPlanEngine,
  FilePlanStore,
  PlanIntegrityError,
  ApprovalRequiredError,
  RawActionSchema,
  assessRisk,
  createDefaultConfig,
  createPlan,
  detectDrift,
  evaluatePolicy,
  hashPlanContent,
  matchesGlob,
  redactText,
  redactValue
} from "../packages/core/src/index.js";
import { FilesystemActionExecutor } from "../packages/adapter-filesystem/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function configFor(workspaceRoot: string) {
  const base = createDefaultConfig("test-project");
  return AgentPlanConfigSchema.parse({
    ...base,
    project: { name: "test-project", environment: "development" },
    workspace: { root: workspaceRoot, allowRead: ["./fixtures/**"], allowWrite: ["./fixtures/**"], deny: ["./.env", "./secrets/**"] },
    defaults: { ...base.defaults, decision: "deny", requireApprovalFrom: "medium", preApproveLowRisk: true },
    shell: { ...base.shell, allow: ["node --version"], requireApproval: ["npm install *"], deny: ["rm -rf *"] }
  });
}

describe("core policy, risk and safety invariants", () => {
  test("matches path and command globs deterministically", () => {
    expect(matchesGlob("./fixtures/input.txt", "./fixtures/**", true)).toBe(true);
    expect(matchesGlob("npm install axios", "npm install *")).toBe(true);
    expect(matchesGlob("npm test", "npm install *")).toBe(false);
  });

  test("redacts credentials in nested values and authorization text", () => {
    expect(redactText("Authorization: Bearer ap_very-secret-value")).toContain("Authorization: Bearer [REDACTED]");
    expect(redactValue({ password: "secret", nested: { token: "abc" }, safe: "hello" })).toEqual({ password: "[REDACTED]", nested: { token: "[REDACTED]" }, safe: "hello" });
  });

  test("scores destructive shell actions above critical threshold with reasons", () => {
    const config = createDefaultConfig("test");
    const risk = assessRisk({
      type: ActionType.ShellExecute,
      title: "Delete data",
      resource: { kind: "command", identifier: "rm -rf ./data" },
      input: { argv: ["rm", "-rf", "./data"] },
      reversible: false
    }, config, { environment: "production" });
    expect(risk.level).toBe("critical");
    expect(risk.reasons.join(" ")).toContain("destructive");
  });

  test("denies unknown filesystem paths and explicit sensitive paths", () => {
    const config = createDefaultConfig("test");
    const outside = evaluatePolicy({ type: ActionType.FilesystemRead, resource: { kind: "file", identifier: "../secrets.txt" }, input: { path: "../secrets.txt" }, risk: { level: "low", score: 8, reasons: [] } }, config, process.cwd());
    expect(outside[0]?.decision).toBe("deny");
    const sensitive = evaluatePolicy({ type: ActionType.FilesystemRead, resource: { kind: "file", identifier: "./.env" }, input: { path: "./.env" }, risk: { level: "low", score: 8, reasons: [] } }, config, process.cwd());
    expect(sensitive[0]?.decision).toBe("deny");
  });

  test("runtime schema rejects incomplete actions", () => {
    expect(() => RawActionSchema.parse({ type: ActionType.FilesystemRead })).toThrow();
    expect(() => createPlan([], createDefaultConfig("test"), process.cwd())).toThrow(/at least one action/);
  });
});

describe("plan integrity and execution", () => {
  test("changes to immutable action content change the plan hash", () => {
    const config = createDefaultConfig("test");
    const plan = createPlan([{ type: ActionType.Custom, title: "Call tool", resource: { kind: "tool", identifier: "demo" }, input: { value: 1 } }], config, process.cwd(), { agent: "test-agent" });
    const changed = { ...plan, actions: plan.actions.map((action) => ({ ...action, input: { value: 2 } })) };
    expect(hashPlanContent(plan)).toBe(plan.contentHash);
    expect(hashPlanContent(changed)).not.toBe(plan.contentHash);
  });

  test("auto-approves a permitted low-risk read and writes sanitized audit data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-engine-"));
    temporaryDirectories.push(directory);
    const workspace = path.join(directory, "workspace");
    await mkdirSafe(path.join(workspace, "fixtures"));
    await writeFile(path.join(workspace, "fixtures", "input.txt"), "Authorization: Bearer super-secret\n", "utf8");
    const config = configFor(workspace);
    const store = new FilePlanStore(path.join(directory, ".agentplan"));
    const engine = new AgentPlanEngine({ config, workspaceRoot: workspace, store, nonInteractive: true });
    const outcome = await engine.executeAction({ type: ActionType.FilesystemRead, title: "Read fixture", source: { adapter: "test" }, resource: { kind: "file", identifier: "./fixtures/input.txt" }, input: { path: "./fixtures/input.txt" }, effects: ["Read a fixture"], permissions: ["filesystem.read"], reversible: true }, async () => ({ secret: "Authorization: Bearer super-secret" }), "test-agent");
    expect(outcome.plan.status).toBe("completed");
    expect(outcome.result.success).toBe(true);
    expect(JSON.stringify(outcome.result)).not.toContain("super-secret");
    expect((await store.getAudit(outcome.plan.planId)).some((event) => event.event === "approval.granted")).toBe(true);
  });

  test("does not execute medium-risk actions in non-interactive mode", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-approval-"));
    temporaryDirectories.push(directory);
    const workspace = path.join(directory, "workspace");
    await mkdirSafe(path.join(workspace, "fixtures"));
    const config = configFor(workspace);
    const store = new FilePlanStore(path.join(directory, ".agentplan"));
    const engine = new AgentPlanEngine({ config, workspaceRoot: workspace, store, nonInteractive: true });
    await expect(engine.executeAction({ type: ActionType.FilesystemWrite, title: "Write fixture", source: { adapter: "test" }, resource: { kind: "file", identifier: "./fixtures/output.txt" }, input: { path: "./fixtures/output.txt", content: "safe" }, effects: ["Modify fixture"], permissions: ["filesystem.write"], reversible: true }, async () => "must not run", "test-agent")).rejects.toBeInstanceOf(ApprovalRequiredError);
    const plans = await store.listPlans();
    expect(plans[0]?.status).toBe("waiting-for-approval");
  });

  test("apply executes only approved filesystem actions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-apply-"));
    temporaryDirectories.push(directory);
    const workspace = path.join(directory, "workspace");
    await mkdirSafe(path.join(workspace, "fixtures"));
    const config = configFor(workspace);
    const store = new FilePlanStore(path.join(directory, ".agentplan"));
    const engine = new AgentPlanEngine({ config, workspaceRoot: workspace, store, nonInteractive: true });
    const plan = await engine.create([{ type: ActionType.FilesystemWrite, title: "Write fixture", source: { adapter: "test" }, resource: { kind: "file", identifier: "./fixtures/output.txt" }, input: { path: "./fixtures/output.txt", content: "approved content" }, effects: ["Modify fixture"], permissions: ["filesystem.write"], reversible: true }], "test-agent");
    await engine.approve(plan.planId, { approved: true, approvedBy: "test", method: "external" });
    const applied = await engine.apply(plan.planId, [new FilesystemActionExecutor({ workspaceRoot: workspace })]);
    expect(applied.status).toBe("completed");
    expect(await readFile(path.join(workspace, "fixtures/output.txt"), "utf8")).toBe("approved content");
    expect(applied.execution?.drift?.level).toBe("no-drift");
  });

  test("does not reapprove a completed plan", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-replay-"));
    temporaryDirectories.push(directory);
    const workspace = path.join(directory, "workspace");
    await mkdirSafe(path.join(workspace, "fixtures"));
    const config = configFor(workspace);
    const store = new FilePlanStore(path.join(directory, ".agentplan"));
    const engine = new AgentPlanEngine({ config, workspaceRoot: workspace, store, nonInteractive: true });
    const plan = await engine.create([{ type: ActionType.FilesystemWrite, title: "Write once", source: { adapter: "test" }, resource: { kind: "file", identifier: "./fixtures/output.txt" }, input: { path: "./fixtures/output.txt", content: "once" }, reversible: true }], "test-agent");
    await engine.approve(plan.planId, { approved: true, approvedBy: "test", method: "external" });
    await engine.apply(plan.planId, [new FilesystemActionExecutor({ workspaceRoot: workspace })]);
    await expect(engine.approve(plan.planId, { approved: true, approvedBy: "attacker", method: "external" })).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  test("modified approved plans fail integrity verification", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-integrity-"));
    temporaryDirectories.push(directory);
    const base = createDefaultConfig("test");
    const config = AgentPlanConfigSchema.parse({ ...base, defaults: { ...base.defaults, decision: "allow" } });
    const store = new FilePlanStore(path.join(directory, ".agentplan"));
    const engine = new AgentPlanEngine({ config, workspaceRoot: directory, store, nonInteractive: true });
    const plan = await engine.create([{ type: ActionType.Custom, title: "Demo", resource: { kind: "tool", identifier: "demo" }, input: { value: 1 } }], "test-agent");
    const approved = await engine.approve(plan.planId, { approved: true, approvedBy: "test", method: "external" });
    await store.savePlan({ ...approved, actions: approved.actions.map((action) => ({ ...action, input: { value: 999 } })) });
    await expect(engine.apply(plan.planId, [])).rejects.toBeInstanceOf(PlanIntegrityError);
  });
});

describe("drift", () => {
  test("reports unexpected affected resources as critical drift", () => {
    const config = createDefaultConfig("test");
    const plan = createPlan([{ type: ActionType.Custom, title: "Demo", resource: { kind: "tool", identifier: "demo" }, input: {} }], config, process.cwd(), { agent: "test" });
    const action = plan.actions[0];
    if (!action) throw new Error("test action missing");
    const report = detectDrift({ ...plan, actions: [{ ...action, status: "approved" }] }, { [action.id]: ActionResultSchema.parse({ success: true, summary: "done", affectedResources: [{ kind: "file", identifier: "unexpected" }] }) });
    expect(report.level).toBe("critical");
  });
});

async function mkdirSafe(directory: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
}
