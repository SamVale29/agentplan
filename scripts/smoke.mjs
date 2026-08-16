import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const cli = path.join(root, "apps", "cli", "dist", "index.js");
const dashboard = path.join(root, "apps", "dashboard", "dist", "index.js");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agentplan-smoke-"));

function run(command, args, cwd, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`Smoke command timed out: ${command} ${args.join(" ")}`));
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve({ code: code ?? 1, signal, stdout, stderr });
      }
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) {
    throw new Error("Unable to allocate a smoke-test port.");
  }
  return port;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const init = await run(process.execPath, [cli, "init"], temporaryDirectory);
  assert(init.code === 0, `init failed: ${init.stderr}`);

  const doctor = await run(process.execPath, [cli, "doctor", "--json"], temporaryDirectory);
  assert(doctor.code === 0, `doctor failed: ${doctor.stderr}`);
  assert(JSON.parse(doctor.stdout).result === "pass", "doctor did not report pass");

  const blockedFile = path.join(temporaryDirectory, "blocked.yaml");
  await writeFile(blockedFile, [
    "actions:",
    "  - type: shell.execute",
    "    title: Block destructive command",
    "    resource:",
    "      kind: command",
    "      identifier: rm -rf ./data",
    "    input:",
    "      argv: [rm, -rf, ./data]",
    "    reversible: false",
    ""
  ].join("\n"), "utf8");
  const blocked = await run(process.execPath, [cli, "policy", "check", "--input", blockedFile, "--json"], temporaryDirectory);
  assert(blocked.code === 6, `policy check should block, got ${blocked.code}: ${blocked.stderr}`);

  const smokeConfig = path.join(temporaryDirectory, "smoke-config.yaml");
  await writeFile(smokeConfig, [
    "version: \"1\"",
    "project:",
    "  name: agentplan-smoke",
    "  environment: development",
    "defaults:",
    "  decision: deny",
    "  requireApprovalFrom: medium",
    "  preApproveLowRisk: true",
    "workspace:",
    "  root: .",
    "  allowRead: []",
    "  allowWrite: [\"./.agentplan/**\"]",
    "  deny: []",
    ""
  ].join("\n"), "utf8");
  const writeFilePath = path.join(temporaryDirectory, "write.yaml");
  await writeFile(writeFilePath, [
    "actions:",
    "  - type: filesystem.write",
    "    title: Write smoke output",
    "    resource:",
    "      kind: file",
    "      identifier: ./.agentplan/smoke-output.txt",
    "    input:",
    "      path: ./.agentplan/smoke-output.txt",
    "      content: smoke-ok",
    "      token: smoke-secret",
    "    reversible: true",
    ""
  ].join("\n"), "utf8");
  const planned = await run(process.execPath, [cli, "plan", "--config", smokeConfig, "--input", writeFilePath, "--json"], temporaryDirectory);
  assert(planned.code === 0, `plan failed (${planned.code}): ${planned.stderr || planned.stdout}`);
  const plan = JSON.parse(planned.stdout);
  assert(typeof plan.planId === "string", "plan did not return a plan id");

  const approved = await run(process.execPath, [cli, "approve", "--config", smokeConfig, plan.planId, "--json"], temporaryDirectory);
  assert(approved.code === 0, `approve failed: ${approved.stderr}`);
  const applied = await run(process.execPath, [cli, "apply", "--config", smokeConfig, plan.planId, "--json"], temporaryDirectory);
  assert(applied.code === 0, `apply failed: ${applied.stderr}`);
  assert((await readFile(path.join(temporaryDirectory, ".agentplan", "smoke-output.txt"), "utf8")) === "smoke-ok", "filesystem side effect was not applied");

  const port = await freePort();
  const server = spawn(process.execPath, [dashboard], {
    cwd: temporaryDirectory,
    env: { ...process.env, AGENTPLAN_DASHBOARD_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/plans`);
        if (response.ok) break;
      } catch {
        // The dashboard may still be starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(response?.ok === true, "dashboard did not become ready");
    const plans = await response.json();
    assert(Array.isArray(plans) && plans.some((item) => item.planId === plan.planId), "dashboard did not expose the created plan");
    const dashboardPlan = await fetch(`http://127.0.0.1:${port}/api/plans/${encodeURIComponent(plan.planId)}`);
    assert(dashboardPlan.ok, "dashboard plan endpoint failed");
    const dashboardBody = await dashboardPlan.json();
    assert(!JSON.stringify(dashboardBody).includes("smoke-secret"), "dashboard returned unsanitized data");
  } finally {
    server.kill();
    await new Promise((resolve) => server.once("close", resolve));
  }

  console.log("Smoke tests passed: CLI init/doctor/policy/plan/approve/apply and dashboard API.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
