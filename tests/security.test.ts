import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ActionType, AgentPlanConfigSchema, createDefaultConfig, createPlan } from "../packages/core/src/index.js";
import { FilesystemActionExecutor } from "../packages/adapter-filesystem/src/index.js";
import { HttpActionExecutor } from "../packages/adapter-http/src/index.js";
import { ShellActionExecutor } from "../packages/adapter-shell/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function configFor(workspaceRoot: string) {
  const base = createDefaultConfig("security-test");
  return AgentPlanConfigSchema.parse({
    ...base,
    workspace: { root: workspaceRoot, allowRead: ["./fixtures/**"], allowWrite: ["./fixtures/**"], deny: ["./.env", "./secrets/**"] }
  });
}

describe("security boundaries", () => {
  test("filesystem executor rejects path traversal", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-path-"));
    temporaryDirectories.push(directory);
    const executor = new FilesystemActionExecutor({ workspaceRoot: directory });
    const plan = createPlan([{ type: ActionType.FilesystemRead, title: "Escape", resource: { kind: "file", identifier: "../outside.txt" }, input: { path: "../outside.txt" }, reversible: true }], configFor(directory), directory, { agent: "security-test" });
    await expect(executor.execute(plan.actions[0]!)).rejects.toThrow(/outside the configured workspace/);
  });

  test("filesystem executor rejects a symlink that resolves outside the workspace", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-symlink-"));
    temporaryDirectories.push(directory);
    const workspace = path.join(directory, "workspace");
    const outside = path.join(directory, "outside.txt");
    await mkdir(path.join(workspace, "fixtures"), { recursive: true });
    await writeFile(outside, "outside", "utf8");
    try {
      await symlink(outside, path.join(workspace, "fixtures", "link.txt"));
    } catch {
      return;
    }
    const executor = new FilesystemActionExecutor({ workspaceRoot: workspace });
    const plan = createPlan([{ type: ActionType.FilesystemRead, title: "Read symlink", resource: { kind: "file", identifier: "./fixtures/link.txt" }, input: { path: "./fixtures/link.txt" }, reversible: true }], configFor(workspace), workspace, { agent: "security-test" });
    await expect(executor.execute(plan.actions[0]!)).rejects.toThrow(/Symlink resolves outside/);
  });

  test("HTTP executor rejects loopback targets before fetch", async () => {
    const executor = new HttpActionExecutor();
    const plan = createPlan([{ type: ActionType.NetworkRequest, title: "Call loopback", resource: { kind: "url", identifier: "http://127.0.0.1:4321" }, input: { url: "http://127.0.0.1:4321" }, reversible: false }], createDefaultConfig("security-test"), process.cwd(), { agent: "security-test" });
    await expect(executor.preview(plan.actions[0]!)).rejects.toThrow(/Private and loopback/);
  });

  test("shell executor times out without enabling a shell", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentplan-shell-"));
    temporaryDirectories.push(directory);
    const executor = new ShellActionExecutor({ workspaceRoot: directory, defaultTimeoutMs: 100 });
    const plan = createPlan([{ type: ActionType.ShellExecute, title: "Wait", resource: { kind: "command", identifier: "node -e wait" }, input: { argv: [process.execPath, "-e", "setTimeout(() => {}, 1000)"], timeoutMs: 100 }, reversible: false }], createDefaultConfig("security-test"), directory, { agent: "security-test" });
    const result = await executor.execute(plan.actions[0]!);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.output)).toContain("timedOut");
  });
});
