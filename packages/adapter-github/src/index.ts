import {
  assertPlanIntegrity,
  formatCapabilityDiffMarkdown,
  formatPlan,
  truncate,
  type ApprovalAdapter,
  type ApprovalDecision,
  type ApprovalRequest,
  type CapabilityDiff
} from "@agentplan/core";

export interface GitHubComment {
  id: number;
  body: string;
  userLogin: string;
  createdAt: string;
  htmlUrl?: string;
}

export interface GitHubCommentReference {
  id: number;
  htmlUrl?: string;
}

export interface GitHubIssueTarget {
  owner: string;
  repository: string;
  issueNumber: number;
}

export interface GitHubApprovalTransport {
  createIssueComment(target: GitHubIssueTarget & { body: string }): Promise<GitHubCommentReference>;
  listIssueComments(target: GitHubIssueTarget & { since?: string }): Promise<readonly GitHubComment[]>;
  getCollaboratorPermission(target: GitHubIssueTarget & { username: string }): Promise<string>;
  updateIssueComment?(target: GitHubIssueTarget & { commentId: number; body: string }): Promise<GitHubCommentReference>;
}

export interface GitHubRestTransportOptions {
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GitHubApiComment {
  id?: unknown;
  body?: unknown;
  created_at?: unknown;
  html_url?: unknown;
  user?: { login?: unknown } | null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GitHub API response is missing ${label}.`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`GitHub API response is missing ${label}.`);
  }
  return value;
}

function commentFromApi(value: unknown): GitHubComment {
  const comment = value as GitHubApiComment;
  const user = comment.user;
  const base = {
    id: requiredNumber(comment.id, "comment id"),
    body: requiredString(comment.body, "comment body"),
    userLogin: requiredString(user?.login, "comment author"),
    createdAt: requiredString(comment.created_at, "comment creation time")
  };
  return typeof comment.html_url === "string" ? { ...base, htmlUrl: comment.html_url } : base;
}

function commentReferenceFromApi(value: unknown): GitHubCommentReference {
  const comment = value as GitHubApiComment;
  const base = { id: requiredNumber(comment.id, "comment id") };
  return typeof comment.html_url === "string" ? { ...base, htmlUrl: comment.html_url } : base;
}

export class GitHubRestTransport implements GitHubApprovalTransport {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: GitHubRestTransportOptions) {
    if (options.token.trim().length === 0) {
      throw new Error("A GitHub token is required for the REST transport.");
    }
    this.token = options.token;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${pathname}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}.`);
    }
    return response.json() as Promise<T>;
  }

  public async createIssueComment(target: GitHubIssueTarget & { body: string }): Promise<GitHubCommentReference> {
    const value = await this.request<unknown>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/issues/${target.issueNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: target.body })
    });
    return commentReferenceFromApi(value);
  }

  public async listIssueComments(target: GitHubIssueTarget & { since?: string }): Promise<readonly GitHubComment[]> {
    const query = target.since === undefined ? "" : `?since=${encodeURIComponent(target.since)}`;
    const value = await this.request<unknown>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/issues/${target.issueNumber}/comments?per_page=100${query.length === 0 ? "" : `&${query.slice(1)}`}`);
    if (!Array.isArray(value)) {
      throw new Error("GitHub API returned an invalid comments response.");
    }
    return value.map(commentFromApi);
  }

  public async getCollaboratorPermission(target: GitHubIssueTarget & { username: string }): Promise<string> {
    const value = await this.request<unknown>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/collaborators/${encodeURIComponent(target.username)}/permission`);
    if (!value || typeof value !== "object" || typeof (value as { permission?: unknown }).permission !== "string") {
      throw new Error("GitHub API returned an invalid collaborator permission response.");
    }
    return (value as { permission: string }).permission;
  }

  public async updateIssueComment(target: GitHubIssueTarget & { commentId: number; body: string }): Promise<GitHubCommentReference> {
    const value = await this.request<unknown>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/issues/comments/${target.commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body: target.body })
    });
    return commentReferenceFromApi(value);
  }
}

export interface GitHubApprovalAdapterOptions extends GitHubIssueTarget {
  transport?: GitHubApprovalTransport;
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  allowedPermissions?: readonly string[];
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ApprovalCommand {
  approved: boolean;
  planId: string;
  planHash: string;
  comment: string;
}

const approvalCommandPattern = /(?:^|\r?\n)\s*\/agentplan\s+(approve|deny)\s+(plan_[A-Za-z0-9]+)\s+(sha256:[a-f0-9]{64})(?:\s+([^\r\n]+))?\s*$/im;

function parseApprovalCommand(body: string): ApprovalCommand | undefined {
  const match = approvalCommandPattern.exec(body);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return undefined;
  }
  return {
    approved: match[1].toLowerCase() === "approve",
    planId: match[2],
    planHash: match[3],
    comment: match[4]?.trim() ?? ""
  };
}

function approvalRequestBody(request: ApprovalRequest): string {
  const marker = `<!-- agentplan:approval-request plan=${request.plan.planId} hash=${request.plan.contentHash} -->`;
  const instructions = [
    "## AgentPlan approval required",
    "",
    "Review the sanitized plan below before allowing execution.",
    "",
    `To approve, comment: \`/agentplan approve ${request.plan.planId} ${request.plan.contentHash}\``,
    `To deny, comment: \`/agentplan deny ${request.plan.planId} ${request.plan.contentHash}\``,
    "",
    "Only collaborators with write, maintain or admin permission are accepted."
  ].join("\n");
  return `${marker}\n${instructions}\n\n${truncate(formatPlan(request.plan), 50_000)}`;
}

export class GitHubApprovalAdapter implements ApprovalAdapter {
  private readonly target: GitHubIssueTarget;
  private readonly transport: GitHubApprovalTransport;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly allowedPermissions: ReadonlySet<string>;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  public constructor(options: GitHubApprovalAdapterOptions) {
    this.target = { owner: options.owner, repository: options.repository, issueNumber: options.issueNumber };
    if (options.transport) {
      this.transport = options.transport;
    } else if (options.token) {
      this.transport = new GitHubRestTransport({ token: options.token, ...(options.apiBaseUrl === undefined ? {} : { apiBaseUrl: options.apiBaseUrl }), ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }) });
    } else {
      throw new Error("GitHubApprovalAdapter requires a transport or token.");
    }
    this.pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 5_000);
    this.timeoutMs = Math.max(0, options.timeoutMs ?? 60 * 60 * 1_000);
    this.allowedPermissions = new Set(options.allowedPermissions ?? ["admin", "maintain", "write"]);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  public async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    assertPlanIntegrity(request.plan);
    const startedAt = this.now();
    const requestComment = await this.transport.createIssueComment({ ...this.target, body: approvalRequestBody(request) });
    const deadline = startedAt.getTime() + this.timeoutMs;

    while (true) {
      const comments = await this.transport.listIssueComments({ ...this.target, since: startedAt.toISOString() });
      for (const comment of comments) {
        if (comment.id <= requestComment.id || comment.userLogin.length === 0) {
          continue;
        }
        const command = parseApprovalCommand(comment.body);
        if (!command || command.planId !== request.plan.planId || command.planHash !== request.plan.contentHash) {
          continue;
        }
        let permission: string;
        try {
          permission = (await this.transport.getCollaboratorPermission({ ...this.target, username: comment.userLogin })).toLowerCase();
        } catch {
          continue;
        }
        if (!this.allowedPermissions.has(permission)) {
          continue;
        }
        return {
          approved: command.approved,
          approvedBy: comment.userLogin,
          method: "external",
          ...(command.comment.length === 0 ? {} : { comment: command.comment })
        };
      }

      const remaining = deadline - this.now().getTime();
      if (remaining <= 0) {
        return {
          approved: false,
          approvedBy: "github-timeout",
          method: "external",
          comment: `No authorized GitHub approval was received before the ${Math.round(this.timeoutMs / 1_000)} second timeout.`
        };
      }
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
  }
}

export interface GitHubCapabilityReporterOptions extends GitHubIssueTarget {
  transport: GitHubApprovalTransport;
  marker?: string;
}

export class GitHubCapabilityReporter {
  private readonly target: GitHubIssueTarget;
  private readonly transport: GitHubApprovalTransport;
  private readonly marker: string;

  public constructor(options: GitHubCapabilityReporterOptions) {
    this.target = { owner: options.owner, repository: options.repository, issueNumber: options.issueNumber };
    this.transport = options.transport;
    this.marker = options.marker ?? "<!-- agentplan:capability-diff -->";
  }

  public async report(diff: CapabilityDiff): Promise<GitHubCommentReference> {
    const body = `${this.marker}\n${formatCapabilityDiffMarkdown(diff)}`;
    const existing = (await this.transport.listIssueComments(this.target)).find((comment) => comment.body.includes(this.marker));
    if (existing && this.transport.updateIssueComment) {
      return this.transport.updateIssueComment({ ...this.target, commentId: existing.id, body });
    }
    return this.transport.createIssueComment({ ...this.target, body });
  }
}
