import { createAgentPlan } from "@agentplan/sdk";
import { spawn } from "node:child_process";

const agentPlan = createAgentPlan({ configFile: "./agentplan.yaml", agentName: "example-shell-agent" });
const runCommand = agentPlan.tool({
  name: "run_command",
  description: "Run a command using argv without a shell",
  actionType: "shell.execute",
  mapAction(input) {
    return {
      title: `Run ${input.argv.join(" ")}`,
      resource: { kind: "command", identifier: input.argv.join(" ") },
      input,
      effects: [`Execute ${input.argv[0]}`],
      permissions: ["shell.execute"],
      reversible: false
    };
  },
  async execute(input) {
    const executable = process.platform === "win32" && input.argv[0] === "npm" ? "npm.cmd" : input.argv[0];
    return new Promise((resolve, reject) => {
      const child = spawn(executable, input.argv.slice(1), { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ argv: input.argv, stdout, stderr, exitCode: code, note: "Executed with shell=false." }));
    });
  }
});

async function attempt(label, argv) {
  try {
    const outcome = await runCommand({ argv });
    console.log(`${label}: ${outcome.result.summary}`);
  } catch (error) {
    console.log(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await attempt("Allowed command", ["node", "--version"]);
await attempt("Approval-required install preview", ["npm", "install", "--help"]);
await attempt("Blocked destructive command", ["rm", "-rf", "./data"]);
