import path from "node:path";
import {
  AgentPlanEngine,
  AgentPlanError,
  FilePlanStore,
  loadConfig,
  type AgentPlan,
  type AgentPlanAction,
  type ApprovalAdapter,
  type RawAction,
  type ActionResult,
  type ExecutionOutcome
} from "@agentplan/core";

function runnerExitCode(error: AgentPlanError): number {
  return error.code === "BLOCKED" ? 3 : error.code === "APPROVAL_REQUIRED" ? 4 : error.code === "POLICY" ? 6 : 1;
}

if (process.env.AGENTPLAN_RUNNER === "true") {
  process.on("uncaughtException", (error: Error) => {
    if (error instanceof AgentPlanError) {
      console.error(`AgentPlan: ${error.message}`);
      process.exitCode = runnerExitCode(error);
      return;
    }
    throw error;
  });
  process.on("unhandledRejection", (reason: unknown) => {
    if (reason instanceof AgentPlanError) {
      console.error(`AgentPlan: ${reason.message}`);
      process.exitCode = runnerExitCode(reason);
      return;
    }
    throw reason;
  });
}

export interface ToolActionDetails {
  title: string;
  description?: string;
  resource: { kind: string; identifier: string; displayName?: string };
  input?: unknown;
  effects?: string[];
  permissions?: string[];
  reversible?: boolean;
  rollbackStrategy?: string;
}

export interface ToolDefinition<TInput> {
  name: string;
  description: string;
  actionType: string;
  mapAction(input: TInput): ToolActionDetails;
  execute(input: TInput): Promise<unknown | ActionResult>;
}

export interface AgentTool<TInput> {
  (input: TInput): Promise<ExecutionOutcome>;
  invoke(input: TInput): Promise<ExecutionOutcome>;
  preview(input: TInput): Promise<AgentPlan>;
}

export interface CreateAgentPlanOptions {
  configFile?: string;
  cwd?: string;
  agentName?: string;
  nonInteractive?: boolean;
  approvalAdapter?: ApprovalAdapter;
  approvalTtlMinutes?: number;
}

export class AgentPlanClient {
  private readonly cwd: string;
  private readonly agentName: string;
  private readonly nonInteractive: boolean;
  private readonly configFile: string;
  private readonly approvalAdapter: ApprovalAdapter | undefined;
  private readonly approvalTtlMinutes: number | undefined;
  private readonly ready: Promise<AgentPlanEngine>;

  public constructor(options: CreateAgentPlanOptions = {}) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.agentName = options.agentName ?? process.env.AGENTPLAN_AGENT ?? "sdk-agent";
    this.nonInteractive = options.nonInteractive ?? process.env.AGENTPLAN_NON_INTERACTIVE === "true";
    this.configFile = path.resolve(this.cwd, options.configFile ?? process.env.AGENTPLAN_CONFIG ?? "agentplan.yaml");
    this.approvalAdapter = options.approvalAdapter;
    this.approvalTtlMinutes = options.approvalTtlMinutes;
    this.ready = this.createEngine();
  }

  public tool<TInput>(definition: ToolDefinition<TInput>): AgentTool<TInput> {
    const invoke = async (input: TInput): Promise<ExecutionOutcome> => this.invokeTool(definition, input);
    const tool = invoke as AgentTool<TInput>;
    tool.invoke = invoke;
    tool.preview = async (input: TInput): Promise<AgentPlan> => {
      const engine = await this.ready;
      const raw = this.toRawAction(definition, input);
      return engine.create([raw], this.agentName);
    };
    return tool;
  }

  public async inspectTool<TInput>(definition: ToolDefinition<TInput>, input: TInput): Promise<AgentPlanAction> {
    const engine = await this.ready;
    const plan = await engine.create([this.toRawAction(definition, input)], this.agentName);
    const action = plan.actions[0];
    if (!action) {
      throw new Error("Tool inspection produced no action");
    }
    return action;
  }

  private async invokeTool<TInput>(definition: ToolDefinition<TInput>, input: TInput): Promise<ExecutionOutcome> {
    const engine = await this.ready;
    try {
      return await engine.executeAction(this.toRawAction(definition, input), (action) => definition.execute(input), this.agentName);
    } catch (error) {
      if (process.env.AGENTPLAN_RUNNER === "true" && error instanceof AgentPlanError) {
        process.exitCode = runnerExitCode(error);
      }
      throw error;
    }
  }

  private toRawAction<TInput>(definition: ToolDefinition<TInput>, input: TInput): RawAction {
    const mapped = definition.mapAction(input);
    return {
      type: definition.actionType,
      title: mapped.title,
      ...(mapped.description === undefined ? {} : { description: mapped.description }),
      source: { adapter: "generic-sdk", agent: this.agentName, tool: definition.name },
      resource: mapped.resource,
      input: mapped.input ?? input,
      effects: mapped.effects ?? [],
      permissions: mapped.permissions ?? [definition.actionType],
      reversible: mapped.reversible ?? false,
      ...(mapped.rollbackStrategy === undefined ? {} : { rollbackStrategy: mapped.rollbackStrategy })
    };
  }

  private async createEngine(): Promise<AgentPlanEngine> {
    const loaded = await loadConfig(this.configFile);
    return new AgentPlanEngine({
      config: loaded.config,
      workspaceRoot: loaded.workspaceRoot,
      store: new FilePlanStore(path.join(this.cwd, ".agentplan")),
      ...(this.approvalAdapter === undefined ? {} : { approvalAdapter: this.approvalAdapter }),
      nonInteractive: this.nonInteractive,
      ...(this.approvalTtlMinutes === undefined ? {} : { approvalTtlMinutes: this.approvalTtlMinutes }),
      actor: this.agentName
    });
  }
}

export function createAgentPlan(options: CreateAgentPlanOptions = {}): AgentPlanClient {
  return new AgentPlanClient(options);
}
