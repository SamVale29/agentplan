import { readFile } from "node:fs/promises";
import path from "node:path";
import { CapabilityDiffSchema } from "../packages/core/dist/index.js";
import { GitHubCapabilityReporter, GitHubRestTransport } from "../packages/adapter-github/dist/index.js";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    const value = argv[index + 1];
    if (!key || value === undefined) {
      throw new Error("Usage: report-github-capabilities --diff <file> --token <token> --owner <owner> --repository <repo> --issue <number>");
    }
    values.set(key, value);
  }
  return values;
}

const values = parseArgs(process.argv.slice(2));
const diffFile = values.get("diff");
const token = values.get("token");
const owner = values.get("owner");
const repository = values.get("repository");
const issueNumber = Number.parseInt(values.get("issue") ?? "", 10);
if (!diffFile || !token || !owner || !repository || !Number.isInteger(issueNumber) || issueNumber <= 0) {
  throw new Error("Missing or invalid GitHub capability report arguments.");
}

const diff = CapabilityDiffSchema.parse(JSON.parse(await readFile(path.resolve(diffFile), "utf8")));
const transport = new GitHubRestTransport({ token });
const reporter = new GitHubCapabilityReporter({ transport, owner, repository, issueNumber });
const comment = await reporter.report(diff);
console.log(`AgentPlan capability comment updated${comment.htmlUrl === undefined ? "" : `: ${comment.htmlUrl}`}.`);
