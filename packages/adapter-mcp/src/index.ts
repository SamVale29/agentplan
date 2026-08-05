import type { AgentCapabilities, AgentPlanAction, AgentPlanEngine, ExecutionOutcome, RawAction } from "@agentplan/core";
import { ActionType } from "@agentplan/core";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: unknown;
  permissions?: string[];
}

export interface McpCall {
  server: string;
  tool: string;
  input: unknown;
}

export interface McpInvoker {
  invoke(call: McpCall): Promise<unknown>;
}

export function inspectMcpTools(tools: readonly McpToolDefinition[]): AgentCapabilities {
  return {
    adapter: "mcp",
    tools: tools.map((tool) => tool.name),
    permissions: [...new Set(tools.flatMap((tool) => tool.permissions ?? ["mcp.invoke"]))],
    referencedEnvironmentVariables: [],
    filesystem: { read: false, write: false, delete: false, workspaceBound: true },
    externalHosts: [],
    destructiveActions: []
  };
}

export function normalizeMcpCall(call: McpCall, agent = "mcp-agent"): RawAction {
  return {
    type: ActionType.McpInvoke,
    title: `Invoke MCP tool ${call.tool}`,
    description: `Intercepted call to ${call.server}/${call.tool}`,
    source: { adapter: "mcp", agent, tool: call.tool },
    resource: { kind: "mcp-tool", identifier: `${call.server}/${call.tool}`, displayName: call.tool },
    input: call.input,
    effects: [`Invoke MCP tool ${call.server}/${call.tool}`],
    permissions: ["mcp.invoke"],
    reversible: false
  };
}

export class McpGateway {
  public constructor(private readonly engine: AgentPlanEngine, private readonly invoker: McpInvoker, private readonly agent = "mcp-agent") {}

  public async invoke(call: McpCall): Promise<ExecutionOutcome> {
    return this.engine.executeAction(normalizeMcpCall(call, this.agent), () => this.invoker.invoke(call), this.agent);
  }
}
