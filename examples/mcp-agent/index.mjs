import { createAgentPlan } from "@agentplan/sdk";

const discoveredTools = [{ name: "search_docs", permissions: ["mcp.invoke"] }];
console.log("Discovered MCP tools:", discoveredTools.map((tool) => tool.name).join(", "));

const agentPlan = createAgentPlan({ configFile: "./agentplan.yaml", agentName: "example-mcp-agent" });
const invokeMcpTool = agentPlan.tool({
  name: "search_docs",
  description: "Invoke a simulated MCP tool after AgentPlan review",
  actionType: "mcp.invoke",
  mapAction(input) {
    return {
      title: "Invoke MCP search_docs",
      resource: { kind: "mcp-tool", identifier: "local-demo/search_docs" },
      input,
      effects: ["Invoke a simulated MCP tool"],
      permissions: ["mcp.invoke"],
      reversible: false
    };
  },
  async execute(input) {
    return { simulated: true, matches: [`Result for ${input.query}`] };
  }
});

const outcome = await invokeMcpTool({ query: "AgentPlan policy" });
console.log("MCP result:", outcome.result.output);
