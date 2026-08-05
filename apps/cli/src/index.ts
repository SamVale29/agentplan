#!/usr/bin/env node

import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";
import {
  AgentPlanEngine,
  AgentPlanError,
  FilePlanStore,
  RawActionsDocumentSchema,
  capabilityDiffToSarif,
  createDefaultConfig,
  diffCapabilities,
  formatApplySummary,
  formatCapabilityDiffMarkdown,
  formatPlan,
  hashPlanContent,
  loadConfig,
  redactValue,
  serializeSarif,
  serializeConfig,
  stableStringify,
  type AgentPlan,
  type AgentPlanAction,
  type ApprovalDecision,
  type RawAction
} from "@agentplan/core";
import { FilesystemActionExecutor } from "@agentplan/adapter-filesystem";
import { HttpActionExecutor } from "@agentplan/adapter-http";
import { ShellActionExecutor } from "@agentplan/adapter-shell";
import { startDashboard } from "@agentplan/dashboard";

const VERSION = "0.1.0";
const EXIT_CODES = { success: 0, general: 1, configuration: 2, blocked: 3, approval: 4, drift: 5, policy: 6 } as const;

interface ParsedArgs {
  positionals: string[];
  passthrough: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

interface Context {
  cwd: string;
  configFile: string;
  loaded: Awaited<ReturnType<typeof loadConfig>>;
  store: FilePlanStore;
  engine: AgentPlanEngine;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const passthrough: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    if (argument === "--") {
      passthrough.push(...argv.slice(index + 1));
      break;
    }
    if (!argument?.startsWith("--")) {
      if (argument) {
        positionals.push(argument);
      }
      index += 1;
      continue;
    }
    const withoutPrefix = argument.slice(2);
    const equalIndex = withoutPrefix.indexOf("=");
    if (equalIndex >= 0) {
      values.set(withoutPrefix.slice(0, equalIndex), withoutPrefix.slice(equalIndex + 1));
      index += 1;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--") && ["config", "input", "agent", "by", "comment", "from", "to", "port", "host", "before", "after", "sarif"].includes(withoutPrefix)) {
      values.set(withoutPrefix, next);
      index += 2;
      continue;
    }
    flags.add(withoutPrefix);
    index += 1;
  }
  return { positionals, passthrough, flags, values };
}

function hasFlag(args: ParsedArgs, flag: string): boolean {
  return args.flags.has(flag);
}

function valueOf(args: ParsedArgs, key: string): string | undefined {
  return args.values.get(key);
}

function output(args: ParsedArgs, value: unknown, human?: string): void {
  if (hasFlag(args, "quiet")) {
    return;
  }
  if (hasFlag(args, "json")) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (human !== undefined) {
    console.log(human);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function safePlanForOutput(plan: AgentPlan): unknown {
  return {
    ...plan,
    actions: plan.actions.map((action) => ({ ...action, input: action.sanitizedInput }))
  };
}

function contextPath(args: ParsedArgs, cwd: string): string {
  return path.resolve(cwd, valueOf(args, "config") ?? process.env.AGENTPLAN_CONFIG ?? "agentplan.yaml");
}

async function createContext(args: ParsedArgs): Promise<Context> {
  const cwd = process.cwd();
  const configFile = contextPath(args, cwd);
  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig(configFile);
  } catch (error) {
    throw new AgentPlanError("CONFIGURATION", `Unable to load ${configFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const store = new FilePlanStore(path.join(cwd, ".agentplan"));
  const engine = new AgentPlanEngine({ config: loaded.config, workspaceRoot: loaded.workspaceRoot, store, nonInteractive: hasFlag(args, "non-interactive") });
  await engine.initialize();
  return { cwd, configFile, loaded, store, engine };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function commandInit(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const configFile = contextPath(args, cwd);
  const force = hasFlag(args, "force");
  if (await fileExists(configFile) && !force) {
    output(args, { initialized: false, configFile, reason: "configuration already exists" }, `Configuration already exists at ${configFile}. Use --force only when you intend to replace it.`);
    return EXIT_CODES.general;
  }
  const config = createDefaultConfig(path.basename(cwd));
  await mkdir(path.dirname(configFile), { recursive: true });
  await writeFile(configFile, serializeConfig(config), { encoding: "utf8", mode: 0o600 });
  const store = new FilePlanStore(path.join(cwd, ".agentplan"));
  await store.initialize();
  const gitignore = path.join(cwd, ".gitignore");
  const recommendations = ["", "# AgentPlan local state", "/.agentplan/"];
  const existing = await fileExists(gitignore) ? await readFile(gitignore, "utf8") : "";
  const missing = recommendations.filter((line) => line.length === 0 || !existing.split(/\r?\n/).includes(line));
  if (missing.length > 0) {
    await appendFile(gitignore, `${missing.join("\n")}\n`, { encoding: "utf8" });
  }
  output(args, { initialized: true, configFile, stateDirectory: path.join(cwd, ".agentplan") }, `Initialized AgentPlan in ${cwd}\nConfig: ${configFile}\nState: ${path.join(cwd, ".agentplan")}`);
  return EXIT_CODES.success;
}

async function commandInspect(args: ParsedArgs): Promise<number> {
  const context = await createContext(args);
  const capabilities = {
    project: context.loaded.config.project,
    adapters: [
      { adapter: "filesystem", tools: ["read", "write", "delete", "move"], permissions: ["filesystem.read", "filesystem.write", "filesystem.delete", "filesystem.move"], workspaceBound: true },
      { adapter: "shell", tools: ["execute"], permissions: ["shell.execute"], shell: "spawn(shell=false)" },
      { adapter: "http", tools: ["request"], permissions: ["network.request"], privateNetworks: "blocked" },
      { adapter: "mcp", tools: ["discover", "invoke"], permissions: ["mcp.invoke"], scope: "generic gateway" }
    ],
    workspace: { root: context.loaded.workspaceRoot, allowRead: context.loaded.config.workspace.allowRead, allowWrite: context.loaded.config.workspace.allowWrite, deny: context.loaded.config.workspace.deny },
    shell: context.loaded.config.shell,
    network: context.loaded.config.network,
    referencedEnvironmentVariables: context.loaded.config.redaction.environmentVariables,
    potentiallyDestructiveActions: ["filesystem.delete", "shell.execute", "database.schema", "git.push", "cloud.delete", "financial.charge", "identity.modify"]
  };
  output(args, capabilities, JSON.stringify(capabilities, null, 2));
  return EXIT_CODES.success;
}

async function readActionDocument(filePath: string): Promise<{ agent: string; actions: RawAction[] }> {
  const source = await readFile(path.resolve(filePath), "utf8");
  const parsed: unknown = parseYaml(source);
  const document = RawActionsDocumentSchema.parse(parsed);
  const inputActions = Array.isArray(document) ? document : document.actions;
  const actions: RawAction[] = inputActions.map((action) => ({
    type: action.type,
    title: action.title,
    resource: action.resource,
    input: action.input,
    ...(action.description === undefined ? {} : { description: action.description }),
    ...(action.source === undefined ? {} : { source: {
      adapter: action.source.adapter,
      ...(action.source.provider === undefined ? {} : { provider: action.source.provider }),
      ...(action.source.agent === undefined ? {} : { agent: action.source.agent }),
      ...(action.source.tool === undefined ? {} : { tool: action.source.tool })
    } }),
    ...(action.effects === undefined ? {} : { effects: action.effects }),
    ...(action.permissions === undefined ? {} : { permissions: action.permissions }),
    ...(action.reversible === undefined ? {} : { reversible: action.reversible }),
    ...(action.rollbackStrategy === undefined ? {} : { rollbackStrategy: action.rollbackStrategy })
  }));
  return { agent: Array.isArray(document) ? "cli-plan" : document.agent ?? "cli-plan", actions };
}

async function readStructuredDocument(filePath: string): Promise<unknown> {
  const source = await readFile(path.resolve(filePath), "utf8");
  return parseYaml(source);
}

async function commandPlan(args: ParsedArgs): Promise<number> {
  const inputFile = valueOf(args, "input");
  if (!inputFile) {
    throw new AgentPlanError("GENERAL", "agentplan plan requires --input <actions.json|actions.yaml>");
  }
  const context = await createContext(args);
  const document = await readActionDocument(inputFile);
  const plan = await context.engine.create(document.actions, valueOf(args, "agent") ?? document.agent);
  output(args, safePlanForOutput(plan), formatPlan(plan));
  return plan.status === "blocked" ? EXIT_CODES.blocked : EXIT_CODES.success;
}

async function commandShow(args: ParsedArgs): Promise<number> {
  const context = await createContext(args);
  const plan = await resolvePlan(context, args.positionals[1]);
  output(args, safePlanForOutput(plan), formatPlan(plan));
  return EXIT_CODES.success;
}

async function commandApprove(args: ParsedArgs, approved: boolean): Promise<number> {
  const context = await createContext(args);
  const planId = args.positionals[1];
  if (!planId) {
    throw new AgentPlanError("GENERAL", `${approved ? "approve" : "deny"} requires a plan id`);
  }
  const comment = valueOf(args, "comment");
  const decisionBase = {
    approved,
    approvedBy: valueOf(args, "by") ?? process.env.AGENTPLAN_APPROVER ?? "local-user",
    method: "interactive" as const
  };
  const decision: ApprovalDecision = comment === undefined ? decisionBase : { ...decisionBase, comment };
  const plan = await context.engine.approve(planId, decision);
  output(args, safePlanForOutput(plan), approved ? `Approved ${plan.planId}\nHash: ${plan.contentHash}` : `Denied ${plan.planId}`);
  return approved ? EXIT_CODES.success : EXIT_CODES.blocked;
}

async function commandApply(args: ParsedArgs): Promise<number> {
  const context = await createContext(args);
  const planId = args.positionals[1];
  if (!planId) {
    throw new AgentPlanError("GENERAL", "apply requires a plan id");
  }
  const executors = [
    new FilesystemActionExecutor({ workspaceRoot: context.loaded.workspaceRoot }),
    new ShellActionExecutor({ workspaceRoot: context.loaded.workspaceRoot }),
    new HttpActionExecutor()
  ];
  const plan = await context.engine.apply(planId, executors);
  output(args, safePlanForOutput(plan), formatApplySummary(plan));
  return plan.execution?.drift?.level === "no-drift" || plan.execution?.drift === undefined ? plan.status === "failed" ? EXIT_CODES.general : EXIT_CODES.success : EXIT_CODES.drift;
}

async function commandDiff(args: ParsedArgs): Promise<number> {
  const context = await createContext(args);
  const fromId = valueOf(args, "from") ?? args.positionals[1];
  const toId = valueOf(args, "to") ?? args.positionals[2];
  if (!fromId && !toId) {
    const plan = await resolvePlan(context, undefined);
    output(args, plan.execution?.drift ?? { level: "no-drift", reasons: [] }, JSON.stringify(plan.execution?.drift ?? { level: "no-drift", reasons: [] }, null, 2));
    return plan.execution?.drift?.level === "no-drift" || plan.execution?.drift === undefined ? EXIT_CODES.success : EXIT_CODES.drift;
  }
  if (!fromId || !toId) {
    throw new AgentPlanError("GENERAL", "diff requires both --from and --to plan ids");
  }
  const from = await context.engine.get(fromId);
  const to = await context.engine.get(toId);
  const fromByKey = new Map(from.actions.map((action) => [actionKey(action), action]));
  const toByKey = new Map(to.actions.map((action) => [actionKey(action), action]));
  const added = to.actions.filter((action) => !fromByKey.has(actionKey(action))).map(safeActionContent);
  const removed = from.actions.filter((action) => !toByKey.has(actionKey(action))).map(safeActionContent);
  const changed = to.actions.filter((action) => {
    const previous = fromByKey.get(actionKey(action));
    return previous !== undefined && stableStringify(safeActionContent(previous)) !== stableStringify(safeActionContent(action));
  }).map(safeActionContent);
  const diff = { from: from.planId, to: to.planId, added, removed, changed };
  output(args, diff, JSON.stringify(diff, null, 2));
  return EXIT_CODES.success;
}

function safeActionContent(action: AgentPlanAction): unknown {
  const { status: _status, timestamps: _timestamps, input: _input, ...content } = action;
  return { ...content, input: action.sanitizedInput };
}

function actionKey(action: AgentPlanAction): string {
  return `${action.sequence}:${action.type}:${action.resource.kind}:${action.resource.identifier}`;
}

async function commandPolicyCheck(args: ParsedArgs): Promise<number> {
  const inputFile = valueOf(args, "input");
  if (!inputFile) {
    throw new AgentPlanError("GENERAL", "policy check requires --input <actions.json|actions.yaml>");
  }
  const context = await createContext(args);
  const document = await readActionDocument(inputFile);
  const plan = await context.engine.create(document.actions, valueOf(args, "agent") ?? document.agent);
  const checks = plan.actions.map((action) => ({ actionId: action.id, type: action.type, resource: action.resource, risk: action.risk, policyResults: action.policyResults, status: action.status }));
  const denied = checks.some((check) => check.status === "blocked");
  output(args, { planId: plan.planId, checks, result: denied ? "blocked" : "pass" }, checks.map((check) => `${check.status === "blocked" ? "BLOCKED" : "CHECKED"} ${check.type}: ${check.policyResults.map((policy) => `${policy.decision} (${policy.configPath})`).join("; ")}`).join("\n"));
  return denied ? EXIT_CODES.policy : EXIT_CODES.success;
}

async function commandCapabilities(args: ParsedArgs): Promise<number> {
  const beforeFile = valueOf(args, "before");
  const afterFile = valueOf(args, "after");
  if (!beforeFile || !afterFile) {
    throw new AgentPlanError("GENERAL", "capabilities diff requires --before <file> and --after <file>");
  }
  const diff = diffCapabilities(await readStructuredDocument(beforeFile), await readStructuredDocument(afterFile));
  const sarifFile = valueOf(args, "sarif");
  if (sarifFile) {
    const target = path.resolve(sarifFile);
    await writeFile(target, serializeSarif(capabilityDiffToSarif(diff, { informationUri: "https://github.com/SamVale29/agentplan" })), "utf8");
  }
  const result = sarifFile === undefined ? diff : { ...diff, sarifFile: path.resolve(sarifFile) };
  output(args, result, formatCapabilityDiffMarkdown(diff));
  return hasFlag(args, "fail-on-critical") && diff.hasCritical ? EXIT_CODES.policy : EXIT_CODES.success;
}

async function commandAudit(args: ParsedArgs): Promise<number> {
  const context = await createContext(args);
  const mode = args.positionals[0] ?? "list";
  if (mode === "list") {
    const plans = await context.engine.list();
    const records = [];
    for (const plan of plans) {
      records.push({ planId: plan.planId, status: plan.status, events: (await context.engine.audit(plan.planId)).length });
    }
    output(args, records, records.map((record) => `${record.planId} ${record.status} events=${record.events}`).join("\n"));
    return EXIT_CODES.success;
  }
  if (mode === "show") {
    const planId = args.positionals[1];
    if (!planId) {
      throw new AgentPlanError("GENERAL", "audit show requires a plan id");
    }
    const events = await context.engine.audit(planId);
    output(args, events, events.map((event) => `${event.timestamp} ${event.event}${event.actionId ? ` ${event.actionId}` : ""}`).join("\n"));
    return EXIT_CODES.success;
  }
  throw new AgentPlanError("GENERAL", `Unknown audit command: ${mode}`);
}

async function commandDoctor(args: ParsedArgs): Promise<number> {
  const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }> = [];
  const [major] = process.versions.node.split(".").map(Number);
  checks.push({ name: "node", status: major !== undefined && major >= 20 ? "pass" : "fail", detail: process.versions.node });
  try {
    const context = await createContext(args);
    checks.push({ name: "configuration", status: "pass", detail: context.configFile });
    await context.store.initialize();
    checks.push({ name: "local store", status: "pass", detail: context.store.rootDir });
    checks.push({ name: "audit", status: context.loaded.config.audit.enabled ? "pass" : "warn", detail: context.loaded.config.audit.enabled ? "enabled" : "disabled" });
    checks.push({ name: "network safety", status: context.loaded.config.network.denyPrivateNetworks ? "pass" : "warn", detail: context.loaded.config.network.denyPrivateNetworks ? "private targets denied" : "private target protection disabled" });
    checks.push({ name: "default policy", status: context.loaded.config.defaults.decision === "deny" ? "pass" : "warn", detail: context.loaded.config.defaults.decision });
  } catch (error) {
    checks.push({ name: "configuration", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
  const failed = checks.some((check) => check.status === "fail");
  output(args, { node: process.versions.node, checks, result: failed ? "fail" : "pass" }, checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.detail}`).join("\n"));
  return failed ? EXIT_CODES.configuration : EXIT_CODES.success;
}

async function runChild(command: readonly string[], args: ParsedArgs, configFile: string): Promise<number> {
  const executable = command[0];
  if (!executable) {
    throw new AgentPlanError("GENERAL", "run requires a command after --, for example: agentplan run -- node agent.js");
  }
  const environment = {
    ...process.env,
    AGENTPLAN_CONFIG: configFile,
    AGENTPLAN_NON_INTERACTIVE: hasFlag(args, "non-interactive") ? "true" : process.env.AGENTPLAN_NON_INTERACTIVE ?? "false",
    AGENTPLAN_RUNNER: "true"
  };
  return new Promise<number>((resolve, reject) => {
    const child = spawn(executable, command.slice(1), { cwd: process.cwd(), env: environment, shell: false, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal ? EXIT_CODES.general : EXIT_CODES.success)));
  });
}

async function commandRun(args: ParsedArgs): Promise<number> {
  return runChild(args.passthrough, args, contextPath(args, process.cwd()));
}

async function commandDashboard(args: ParsedArgs): Promise<number> {
  const portValue = valueOf(args, "port");
  const port = portValue ? Number.parseInt(portValue, 10) : 4321;
  const server = await startDashboard({ cwd: process.cwd(), host: valueOf(args, "host") ?? "127.0.0.1", port: Number.isFinite(port) ? port : 4321 });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  output(args, { url: `http://${valueOf(args, "host") ?? "127.0.0.1"}:${actualPort}` }, `AgentPlan dashboard listening at http://${valueOf(args, "host") ?? "127.0.0.1"}:${actualPort}`);
  await new Promise<void>(() => undefined);
  return EXIT_CODES.success;
}

async function resolvePlan(context: Context, planId: string | undefined): Promise<AgentPlan> {
  if (planId) {
    return context.engine.get(planId);
  }
  const plans = await context.engine.list();
  const plan = plans[0];
  if (!plan) {
    throw new AgentPlanError("NOT_FOUND", "No plans found. Create one with agentplan plan --input actions.yaml.");
  }
  return plan;
}

function usage(): string {
  return [
    "AgentPlan — Terraform Plan for AI agents.",
    "",
    "Usage:",
    "  agentplan init",
    "  agentplan inspect",
    "  agentplan run -- node agent.js",
    "  agentplan plan --input actions.yaml",
    "  agentplan approve <plan-id>",
    "  agentplan apply <plan-id>",
    "  agentplan show [plan-id]",
    "  agentplan diff --from <plan-id> --to <plan-id>",
    "  agentplan capabilities diff --before <file> --after <file> [--sarif <file>]",
    "  agentplan policy check --input actions.yaml",
    "  agentplan audit list|show <plan-id>",
    "  agentplan doctor",
    "  agentplan dashboard",
    "  agentplan version",
    "",
    "Global options: --json --quiet --config <path> --no-color --non-interactive"
  ].join("\n");
}

async function dispatch(args: ParsedArgs): Promise<number> {
  const [command, subcommand] = args.positionals;
  if (!command || command === "help" || hasFlag(args, "help")) {
    output(args, { version: VERSION, usage: usage() }, usage());
    return EXIT_CODES.success;
  }
  if (command === "version") {
    output(args, { version: VERSION }, VERSION);
    return EXIT_CODES.success;
  }
  if (command === "init") return commandInit(args);
  if (command === "inspect") return commandInspect(args);
  if (command === "run") return commandRun(args);
  if (command === "plan") return commandPlan(args);
  if (command === "apply") return commandApply(args);
  if (command === "approve") return commandApprove(args, true);
  if (command === "deny") return commandApprove(args, false);
  if (command === "show") return commandShow(args);
  if (command === "diff") return commandDiff(args);
  if (command === "capabilities" && subcommand === "diff") return commandCapabilities({ ...args, positionals: args.positionals.slice(2) });
  if (command === "policy" && subcommand === "check") return commandPolicyCheck({ ...args, positionals: args.positionals.slice(2) });
  if (command === "audit") return commandAudit({ ...args, positionals: args.positionals.slice(1) });
  if (command === "doctor") return commandDoctor(args);
  if (command === "dashboard") return commandDashboard(args);
  output(args, { error: `Unknown command: ${args.positionals.join(" ")}`, usage: usage() }, usage());
  return EXIT_CODES.general;
}

function exitCodeForError(error: unknown): number {
  if (error instanceof AgentPlanError) {
    return error.code === "CONFIGURATION" ? EXIT_CODES.configuration : error.code === "BLOCKED" ? EXIT_CODES.blocked : error.code === "APPROVAL_REQUIRED" ? EXIT_CODES.approval : error.code === "DRIFT" ? EXIT_CODES.drift : error.code === "POLICY" ? EXIT_CODES.policy : EXIT_CODES.general;
  }
  return EXIT_CODES.general;
}

const args = parseArgs(process.argv.slice(2));
try {
  process.exitCode = await dispatch(args);
} catch (error) {
  const code = exitCodeForError(error);
  if (!hasFlag(args, "quiet")) {
    if (hasFlag(args, "json")) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), code }, null, 2));
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  process.exitCode = code;
}
