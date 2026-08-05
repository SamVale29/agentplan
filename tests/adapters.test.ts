import { describe, expect, test } from "vitest";
import { extractAnthropicToolCalls, normalizeAnthropicToolCall } from "../packages/adapter-anthropic/src/index.js";
import { extractOpenAIToolCalls, normalizeOpenAIToolCall } from "../packages/adapter-openai/src/index.js";
import { ActionType } from "../packages/core/src/index.js";

describe("provider adapter normalization", () => {
  test("normalizes OpenAI Responses function_call items", () => {
    const calls = extractOpenAIToolCalls({ output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "write_file", arguments: '{"path":"x"}' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe("write_file");
    expect(normalizeOpenAIToolCall(calls[0]!).source?.provider).toBe("openai");
  });

  test("normalizes OpenAI Chat Completions tool_calls", () => {
    const calls = extractOpenAIToolCalls({ choices: [{ message: { tool_calls: [{ id: "call_2", function: { name: "lookup", arguments: '{"id":1}' } }] } }] });
    expect(calls[0]?.input).toEqual({ id: 1 });
  });

  test("normalizes Anthropic tool_use content blocks", () => {
    const calls = extractAnthropicToolCalls({ content: [{ type: "text", text: "I will use a tool" }, { type: "tool_use", id: "toolu_1", name: "refund", input: { amount: 20 } }] });
    expect(calls).toHaveLength(1);
    const action = normalizeAnthropicToolCall(calls[0]!);
    expect(action.type).toBe(ActionType.Custom);
    expect(action.resource.identifier).toBe("anthropic/refund");
  });
});
