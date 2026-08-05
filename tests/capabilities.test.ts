import { describe, expect, test } from "vitest";
import { capabilityDiffToSarif, diffCapabilities, formatCapabilityDiffMarkdown } from "../packages/core/src/index.js";

const before = {
  adapters: [{ adapter: "shell", tools: ["execute"], permissions: ["shell.execute"], filesystem: { read: false, write: false, delete: false, workspaceBound: true }, externalHosts: [], destructiveActions: [] }],
  workspace: { allowRead: ["./src/**"], allowWrite: [] },
  network: { allowHosts: ["api.example.com"] },
  referencedEnvironmentVariables: ["*_TOKEN"],
  potentiallyDestructiveActions: []
};

const after = {
  adapters: [{ adapter: "shell", tools: ["execute", "install"], permissions: ["shell.execute", "shell.install"], filesystem: { read: false, write: true, delete: false, workspaceBound: true }, externalHosts: [], destructiveActions: [] }],
  workspace: { allowRead: ["./src/**"], allowWrite: ["./src/**"] },
  network: { allowHosts: ["api.example.com", "unknown.example.com"] },
  referencedEnvironmentVariables: ["*_TOKEN", "*_SECRET"],
  potentiallyDestructiveActions: ["shell.execute: rm -rf ./data"]
};

describe("capability diff and SARIF", () => {
  test("detects new permissions, hosts and destructive capabilities", () => {
    const diff = diffCapabilities(before, after);
    expect(diff.requiresReview).toBe(true);
    expect(diff.hasCritical).toBe(true);
    expect(diff.added.some((change) => change.category === "external-host" && change.value === "unknown.example.com")).toBe(true);
    expect(diff.added.some((change) => change.category === "destructive-action")).toBe(true);
    expect(formatCapabilityDiffMarkdown(diff)).toContain("Manual review required");
  });

  test("creates a valid SARIF result for every capability change", () => {
    const diff = diffCapabilities(before, after);
    const sarif = capabilityDiffToSarif(diff);
    const run = sarif.runs[0];
    expect(run?.tool.driver.name).toBe("AgentPlan");
    expect(run?.results).toHaveLength(diff.added.length + diff.removed.length);
    expect(run?.results.some((result) => result.level === "error")).toBe(true);
    expect(sarif.version).toBe("2.1.0");
  });

  test("reports no changes for equivalent snapshots", () => {
    const diff = diffCapabilities(before, before);
    expect(diff).toEqual({ added: [], removed: [], requiresReview: false, hasCritical: false, summary: { added: 0, removed: 0 } });
    expect(capabilityDiffToSarif(diff).runs[0]?.results).toEqual([]);
  });
});
