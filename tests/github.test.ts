import { describe, expect, test } from "vitest";
import { ActionType, createDefaultConfig, createPlan, diffCapabilities } from "../packages/core/src/index.js";
import { GitHubApprovalAdapter, GitHubCapabilityReporter, type GitHubApprovalTransport, type GitHubComment, type GitHubIssueTarget } from "../packages/adapter-github/src/index.js";

class FakeGitHubTransport implements GitHubApprovalTransport {
  public readonly comments: GitHubComment[] = [];
  public permission = "write";
  private nextId = 1;

  public async createIssueComment(target: GitHubIssueTarget & { body: string }) {
    const comment = { id: this.nextId++, body: target.body, userLogin: "agentplan[bot]", createdAt: new Date().toISOString() };
    this.comments.push(comment);
    if (target.body.includes("agentplan:approval-request")) {
      const match = /plan=(plan_[A-Za-z0-9]+) hash=(sha256:[a-f0-9]{64})/.exec(target.body);
      if (!match?.[1] || !match[2]) throw new Error("approval marker missing in test");
      this.comments.push({ id: this.nextId++, body: `/agentplan approve ${match[1]} ${match[2]} reviewed`, userLogin: "reviewer", createdAt: new Date().toISOString() });
    }
    return { id: comment.id };
  }

  public async listIssueComments(): Promise<readonly GitHubComment[]> {
    return this.comments;
  }

  public async getCollaboratorPermission(): Promise<string> {
    return this.permission;
  }

  public async updateIssueComment(target: GitHubIssueTarget & { commentId: number; body: string }) {
    const existing = this.comments.find((comment) => comment.id === target.commentId);
    if (!existing) throw new Error("comment not found");
    existing.body = target.body;
    return { id: existing.id };
  }
}

function createApprovalPlan() {
  return createPlan([{ type: ActionType.FilesystemWrite, title: "Write a reviewed file", resource: { kind: "file", identifier: "./src/output.txt" }, input: { path: "./src/output.txt", content: "safe" }, reversible: true }], createDefaultConfig("github-test"), process.cwd(), { agent: "github-test" });
}

describe("GitHub adapter", () => {
  test("accepts only an authorized comment bound to the exact plan hash", async () => {
    const transport = new FakeGitHubTransport();
    const adapter = new GitHubApprovalAdapter({ owner: "SamVale29", repository: "agentplan", issueNumber: 1, transport, timeoutMs: 50, pollIntervalMs: 0, sleep: async () => undefined });
    const plan = createApprovalPlan();
    const decision = await adapter.request({ plan, actions: plan.actions });
    expect(decision).toEqual({ approved: true, approvedBy: "reviewer", method: "external", comment: "reviewed" });
  });

  test("fails closed when the approving commenter lacks write permission", async () => {
    const transport = new FakeGitHubTransport();
    transport.permission = "read";
    let now = 0;
    const adapter = new GitHubApprovalAdapter({ owner: "SamVale29", repository: "agentplan", issueNumber: 1, transport, timeoutMs: 0, now: () => new Date(now), sleep: async () => undefined });
    const decision = await adapter.request({ plan: createApprovalPlan(), actions: [] });
    now += 1;
    expect(decision.approved).toBe(false);
    expect(decision.approvedBy).toBe("github-timeout");
  });

  test("updates the existing capability comment instead of creating duplicates", async () => {
    const transport = new FakeGitHubTransport();
    const reporter = new GitHubCapabilityReporter({ owner: "SamVale29", repository: "agentplan", issueNumber: 1, transport });
    const diff = diffCapabilities({ adapters: [] }, { adapters: [{ adapter: "shell", tools: ["execute"], permissions: ["shell.execute"], filesystem: { read: false, write: false, delete: false, workspaceBound: true }, externalHosts: [], destructiveActions: [] }] });
    await reporter.report(diff);
    await reporter.report(diff);
    expect(transport.comments).toHaveLength(1);
    expect(transport.comments[0]?.body).toContain("AgentPlan capability diff");
  });
});
