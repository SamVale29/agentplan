import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ActionExecutor, ActionPreview, ActionResult, AgentPlanAction } from "@agentplan/core";
import { ActionResultSchema, ActionType, isPrivateHost, isRecord, truncate } from "@agentplan/core";

export interface HttpExecutorOptions {
  maxResponseBytes?: number;
  defaultTimeoutMs?: number;
  lookupHost?: (hostname: string) => Promise<readonly string[]>;
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
  if (action.input.headers !== undefined && (!isRecord(action.input.headers) || !Object.entries(action.input.headers).every(([key, value]) => key.length > 0 && typeof value === "string"))) {
    throw new Error(`HTTP action ${action.id} requires input.headers to contain string values`);
  }
  const headers = action.input.headers === undefined ? {} : Object.fromEntries(Object.entries(action.input.headers).map(([key, value]) => [key, value as string]));
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
  private readonly lookupHost: (hostname: string) => Promise<readonly string[]>;

  public constructor(options: HttpExecutorOptions = {}) {
    this.maxResponseBytes = Math.min(Math.max(options.maxResponseBytes ?? 1_000_000, 1_024), 10_000_000);
    this.defaultTimeoutMs = Math.min(Math.max(options.defaultTimeoutMs ?? 30_000, 100), 60_000);
    this.lookupHost = options.lookupHost ?? (async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
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
    await this.assertResolvedHost(url.hostname);
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

  private async assertResolvedHost(hostname: string): Promise<void> {
    if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) {
      return;
    }
    let addresses: readonly string[];
    try {
      addresses = await this.lookupHost(hostname);
    } catch {
      throw new Error(`Unable to resolve network target ${hostname}; request blocked`);
    }
    if (addresses.length === 0 || addresses.some((address) => isPrivateHost(address))) {
      throw new Error(`Network target ${hostname} resolves to a private or loopback address`);
    }
  }
}
