import { spawn } from "node:child_process";
import path from "node:path";
import type { ActionExecutor, ActionPreview, ActionResult, AgentPlanAction } from "@agentplan/core";
import { ActionResultSchema, ActionType, isWithin, isRecord, truncate } from "@agentplan/core";

export interface ShellExecutorOptions {
  workspaceRoot: string;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
}

interface ShellInput {
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

function shellInput(action: AgentPlanAction): ShellInput {
  if (!isRecord(action.input)) {
    throw new Error(`Shell action ${action.id} requires an argv array`);
  }
  const argv = action.input.argv;
  if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === "string")) {
    return {
      argv,
      ...(typeof action.input.cwd === "string" ? { cwd: action.input.cwd } : {}),
      ...(isRecord(action.input.env) && Object.entries(action.input.env).every(([, value]) => typeof value === "string") ? { env: Object.fromEntries(Object.entries(action.input.env).map(([key, value]) => [key, value as string])) } : {}),
      ...(typeof action.input.timeoutMs === "number" ? { timeoutMs: action.input.timeoutMs } : {})
    };
  }
  if (typeof action.input.command === "string" && action.input.command.length > 0) {
    const args = Array.isArray(action.input.args) && action.input.args.every((item) => typeof item === "string") ? action.input.args : [];
    return {
      argv: [action.input.command, ...args],
      ...(typeof action.input.cwd === "string" ? { cwd: action.input.cwd } : {}),
      ...(typeof action.input.timeoutMs === "number" ? { timeoutMs: action.input.timeoutMs } : {})
    };
  }
  throw new Error(`Shell action ${action.id} requires a non-empty input.argv array`);
}

export class ShellActionExecutor implements ActionExecutor {
  public readonly name = "shell";
  private readonly workspaceRoot: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputBytes: number;

  public constructor(options: ShellExecutorOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.defaultTimeoutMs = Math.min(Math.max(options.defaultTimeoutMs ?? 30_000, 100), 300_000);
    this.maxOutputBytes = Math.min(Math.max(options.maxOutputBytes ?? 64 * 1024, 1024), 2 * 1024 * 1024);
  }

  public supports(action: AgentPlanAction): boolean {
    return action.type === ActionType.ShellExecute;
  }

  public async preview(action: AgentPlanAction): Promise<ActionPreview> {
    const input = shellInput(action);
    const cwd = input.cwd ? this.safeCwd(input.cwd) : this.workspaceRoot;
    return { summary: `Run ${input.argv.join(" ")}`, details: [`cwd: ${cwd}`, "spawned with shell=false", `timeout: ${input.timeoutMs ?? this.defaultTimeoutMs}ms`] };
  }

  public async execute(action: AgentPlanAction): Promise<ActionResult> {
    const input = shellInput(action);
    const cwd = input.cwd ? this.safeCwd(input.cwd) : this.workspaceRoot;
    const requestedExecutable = input.argv[0];
    const executable = process.platform === "win32" && requestedExecutable && ["npm", "pnpm", "npx", "yarn"].includes(requestedExecutable) ? `${requestedExecutable}.cmd` : requestedExecutable;
    if (!executable) {
      throw new Error("Shell action has no executable");
    }
    const args = input.argv.slice(1);
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? this.defaultTimeoutMs, 100), 300_000);
    const environment = { ...process.env, ...(input.env ?? {}) };
    return new Promise<ActionResult>((resolve, reject) => {
      const child = spawn(executable, args, { cwd, env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const append = (current: string, chunk: Buffer): string => truncate(`${current}${chunk.toString("utf8")}`, this.maxOutputBytes);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        const success = !timedOut && code === 0;
        resolve(ActionResultSchema.parse({
          success,
          summary: success ? `Command completed: ${input.argv.join(" ")}` : timedOut ? `Command timed out after ${timeoutMs}ms` : `Command failed with exit code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
          output: { stdout, stderr, exitCode: code, signal, timedOut },
          affectedResources: [{ kind: "process", identifier: input.argv.join(" ") }],
          ...(success ? {} : { error: stderr || `Command exited with code ${code ?? "unknown"}` })
        }));
      });
    });
  }

  private safeCwd(requested: string): string {
    const candidate = path.resolve(this.workspaceRoot, requested);
    if (!isWithin(this.workspaceRoot, candidate)) {
      throw new Error(`Command cwd is outside the configured workspace: ${requested}`);
    }
    return candidate;
  }
}
