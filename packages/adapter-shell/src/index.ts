import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
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

const BLOCKED_ENVIRONMENT_KEYS = /^(?:PATH|PATHEXT|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z0-9_]+|BASH_ENV|ENV|PROMPT_COMMAND|GIT_SSH_COMMAND|GIT_CONFIG(?:_.+)?|PYTHONPATH|RUBYOPT|PERL5OPT|COMSPEC|SHELL)$/i;

function environmentInput(value: unknown, actionId: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !Object.entries(value).every(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof item === "string")) {
    throw new Error(`Shell action ${actionId} requires input.env to contain valid string environment variables`);
  }
  const environment = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item as string]));
  const blocked = Object.keys(environment).find((key) => BLOCKED_ENVIRONMENT_KEYS.test(key));
  if (blocked) {
    throw new Error(`Shell action ${actionId} cannot override the dangerous environment variable ${blocked}`);
  }
  return environment;
}

function shellInput(action: AgentPlanAction): ShellInput {
  if (!isRecord(action.input)) {
    throw new Error(`Shell action ${action.id} requires an argv array`);
  }
  const argv = action.input.argv;
  if (argv !== undefined) {
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((item) => typeof item === "string")) {
      throw new Error(`Shell action ${action.id} requires input.argv to be a non-empty string array`);
    }
    const env = environmentInput(action.input.env, action.id);
    return {
      argv: argv as string[],
      ...(typeof action.input.cwd === "string" ? { cwd: action.input.cwd } : {}),
      ...(env === undefined ? {} : { env }),
      ...(typeof action.input.timeoutMs === "number" ? { timeoutMs: action.input.timeoutMs } : {})
    };
  }
  if (typeof action.input.command === "string" && action.input.command.length > 0) {
    if (action.input.args !== undefined && (!Array.isArray(action.input.args) || !action.input.args.every((item) => typeof item === "string"))) {
      throw new Error(`Shell action ${action.id} requires input.args to be a string array`);
    }
    const args = action.input.args === undefined ? [] : action.input.args as string[];
    const env = environmentInput(action.input.env, action.id);
    return {
      argv: [action.input.command, ...args],
      ...(typeof action.input.cwd === "string" ? { cwd: action.input.cwd } : {}),
      ...(env === undefined ? {} : { env }),
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
    const cwd = await this.safeCwd(input.cwd ?? ".");
    return { summary: `Run ${input.argv.join(" ")}`, details: [`cwd: ${cwd}`, "spawned with shell=false", `timeout: ${input.timeoutMs ?? this.defaultTimeoutMs}ms`] };
  }

  public async execute(action: AgentPlanAction): Promise<ActionResult> {
    const input = shellInput(action);
    const cwd = await this.safeCwd(input.cwd ?? ".");
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

  private async safeCwd(requested: string): Promise<string> {
    const candidate = path.resolve(this.workspaceRoot, requested);
    const workspace = await realpath(this.workspaceRoot);
    const resolved = await realpath(candidate).catch(() => {
      throw new Error(`Command cwd does not exist: ${requested}`);
    });
    if (!isWithin(workspace, resolved)) {
      throw new Error(`Command cwd is outside the configured workspace: ${requested}`);
    }
    return resolved;
  }
}
