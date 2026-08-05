import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAgentPlan } from "@agentplan/sdk";

const agentPlan = createAgentPlan({
  configFile: "./agentplan.yaml",
  agentName: "example-file-agent"
});

const readFixture = agentPlan.tool({
  name: "read_fixture",
  description: "Read the example input file",
  actionType: "filesystem.read",
  mapAction(input) {
    return {
      title: `Read ${input.path}`,
      resource: { kind: "file", identifier: input.path },
      input,
      effects: [`Read file ${input.path}`],
      permissions: ["filesystem.read"],
      reversible: true
    };
  },
  async execute(input) {
    return readFile(path.resolve(input.path), "utf8");
  }
});

const writeFixture = agentPlan.tool({
  name: "write_fixture",
  description: "Write the example output file",
  actionType: "filesystem.write",
  mapAction(input) {
    return {
      title: `Modify ${input.path}`,
      resource: { kind: "file", identifier: input.path },
      input,
      effects: [`Modify file ${input.path}`],
      permissions: ["filesystem.write"],
      reversible: true,
      rollbackStrategy: "Restore the previous file contents."
    };
  },
  async execute(input) {
    await writeFile(path.resolve(input.path), input.content, "utf8");
    return { written: input.path };
  }
});

const inputPath = "./examples/file-agent/data/input.txt";
const outputPath = "./examples/file-agent/data/output.txt";
const readOutcome = await readFixture({ path: inputPath });
const source = typeof readOutcome.result.output === "string" ? readOutcome.result.output : "AgentPlan example";
console.log(`Read result: ${source.trim()}`);

const writeOutcome = await writeFixture({
  path: outputPath,
  content: `${source.trim()}\nApproved and written by AgentPlan.\n`
});
console.log(`Write result: ${writeOutcome.result.summary}`);
console.log(`Plan: ${writeOutcome.plan.planId}`);
