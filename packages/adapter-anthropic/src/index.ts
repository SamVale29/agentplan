import type { RawAction } from "@agentplan/core";
import { ActionType, isRecord } from "@agentplan/core";

export interface ProviderToolCall {
  provider: "anthropic";
  callId: string;
  tool: string;
  input: unknown;
  raw: unknown;
}

export function extractAnthropicToolCalls(payload: unknown): ProviderToolCall[] {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return [];
  }
  const calls: ProviderToolCall[] = [];
  for (const block of payload.content) {
    if (!isRecord(block) || block.type !== "tool_use" || typeof block.name !== "string") {
      continue;
    }
    calls.push({ provider: "anthropic", callId: typeof block.id === "string" ? block.id : `anthropic-call-${calls.length + 1}`, tool: block.name, input: block.input, raw: block });
  }
  return calls;
}

export function normalizeAnthropicToolCall(call: ProviderToolCall, agent = "anthropic-agent"): RawAction {
  return {
    type: ActionType.Custom,
    title: `Anthropic tool call ${call.tool}`,
    description: `Normalized Anthropic tool_use block ${call.callId}`,
    source: { adapter: "provider", provider: "anthropic", agent, tool: call.tool },
    resource: { kind: "provider-tool", identifier: `anthropic/${call.tool}`, displayName: call.tool },
    input: call.input,
    effects: [`Invoke provider tool ${call.tool}`],
    permissions: ["provider.anthropic.tool"],
    reversible: false
  };
}
