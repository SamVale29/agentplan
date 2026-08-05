import type { RawAction } from "@agentplan/core";
import { ActionType, isRecord } from "@agentplan/core";

export interface ProviderToolCall {
  provider: "openai";
  callId: string;
  tool: string;
  input: unknown;
  raw: unknown;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { rawArguments: value };
  }
}

export function extractOpenAIToolCalls(payload: unknown): ProviderToolCall[] {
  const calls: ProviderToolCall[] = [];
  if (!isRecord(payload)) {
    return calls;
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item) || item.type !== "function_call" || typeof item.name !== "string") {
        continue;
      }
      calls.push({ provider: "openai", callId: typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : `openai-call-${calls.length + 1}`, tool: item.name, input: parseArguments(item.arguments), raw: item });
    }
  }
  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.tool_calls)) {
        continue;
      }
      for (const toolCall of choice.message.tool_calls) {
        if (!isRecord(toolCall) || !isRecord(toolCall.function) || typeof toolCall.function.name !== "string") {
          continue;
        }
        calls.push({ provider: "openai", callId: typeof toolCall.id === "string" ? toolCall.id : `openai-call-${calls.length + 1}`, tool: toolCall.function.name, input: parseArguments(toolCall.function.arguments), raw: toolCall });
      }
    }
  }
  return calls;
}

export function normalizeOpenAIToolCall(call: ProviderToolCall, agent = "openai-agent"): RawAction {
  return {
    type: ActionType.Custom,
    title: `OpenAI tool call ${call.tool}`,
    description: `Normalized OpenAI function call ${call.callId}`,
    source: { adapter: "provider", provider: "openai", agent, tool: call.tool },
    resource: { kind: "provider-tool", identifier: `openai/${call.tool}`, displayName: call.tool },
    input: call.input,
    effects: [`Invoke provider tool ${call.tool}`],
    permissions: ["provider.openai.tool"],
    reversible: false
  };
}
