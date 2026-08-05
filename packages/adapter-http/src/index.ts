import type { ActionExecutor, ActionPreview, ActionResult, AgentPlanAction } from "@agentplan/core";
import { ActionResultSchema, ActionType, isPrivateHost, isRecord, truncate } from "@agentplan/core";

export interface HttpExecutorOptions {
  maxResponseBytes?: number;
  defaultTimeoutMs?: number;
}

interface HttpInput {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

function httpInput(action: AgentPlanAction): HttpInput {
  if (!isRecord(action.input) || typeof action.input.url !== "string") {
    throw new Error(`HTTP action ${action.id} requires input.url`);
  }
  const method = typeof action.input.method === "string" ? action.input.method.toUpperCase() : "GET";
  const headers = isRecord(action.input.headers) && Object.entries(action.input.headers).every(([, value]) => typeof value === "string") ? Object.fromEntries(Object.entries(action.input.headers).map(([key, value]) => [key, value as string])) : {};
  const bodyValue = action.input.body;
  const body = typeof bodyValue === "string" ? bodyValue : bodyValue === undefined ? undefined : JSON.stringify(bodyValue);
  return {
    url: action.input.url,
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    ...(typeof action.input.timeoutMs === "number" ? { timeoutMs: action.input.timeoutMs } : {})
  };
}

export class HttpActionExecutor implements ActionExecutor {
  public readonly name = "http";
  private readonly maxResponseBytes: number;
  private readonly defaultTimeoutMs: number;

  public constructor(options: HttpExecutorOptions = {}) {
    this.maxResponseBytes = Math.min(Math.max(options.maxResponseBytes ?? 1_000_000, 1_024), 10_000_000);
    this.defaultTimeoutMs = Math.min(Math.max(options.defaultTimeoutMs ?? 30_000, 100), 60_000);
  }

  public supports(action: AgentPlanAction): boolean {
    return action.type === ActionType.NetworkRequest;
  }

  public async preview(action: AgentPlanAction): Promise<ActionPreview> {
    const input = httpInput(action);
    const url = this.safeUrl(input.url);
    return { summary: `${input.method} ${url.href}`, details: [`Host: ${url.hostname}`, `Request body: ${input.body === undefined ? "none" : "present"}`, "Network access is only attempted after policy approval."] };
  }

  public async execute(action: AgentPlanAction): Promise<ActionResult> {
    const input = httpInput(action);
    const url = this.safeUrl(input.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(input.timeoutMs ?? this.defaultTimeoutMs, 100), 60_000));
    try {
      const requestInit: RequestInit = { method: input.method, headers: input.headers, signal: controller.signal, redirect: "error" };
      if (input.body !== undefined) {
        requestInit.body = input.body;
      }
      const response = await fetch(url, requestInit);
      const body = truncate(await response.text(), this.maxResponseBytes);
      return ActionResultSchema.parse({
        success: response.ok,
        summary: `${input.method} ${url.hostname} returned ${response.status}`,
        output: { status: response.status, headers: Object.fromEntries(response.headers.entries()), body },
        affectedResources: [action.resource],
        ...(response.ok ? {} : { error: `HTTP ${response.status}` })
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private safeUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS URLs are supported");
    }
    if (isPrivateHost(url.hostname)) {
      throw new Error("Private and loopback network targets are blocked by the HTTP adapter");
    }
    return url;
  }
}
