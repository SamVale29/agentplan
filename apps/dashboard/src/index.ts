import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FilePlanStore, redactValue, type AgentPlan } from "@agentplan/core";

export interface DashboardOptions {
  cwd?: string;
  host?: string;
  port?: number;
}

const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentPlan Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #10141f; color: #e8edf7; }
    body { margin: 0; } header { padding: 28px 36px; border-bottom: 1px solid #293247; display: flex; justify-content: space-between; align-items: center; }
    main { padding: 28px 36px; max-width: 1240px; margin: auto; } h1 { margin: 0; font-size: 1.5rem; } .muted { color: #96a2bb; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; } .card { background: #171d2b; border: 1px solid #2b3850; border-radius: 14px; padding: 18px; }
    .card h2 { font-size: 1rem; margin: 0 0 8px; } .pill { border-radius: 999px; border: 1px solid #52617c; padding: 3px 9px; font-size: .75rem; }
    .risk { color: #ffcf70; } a { color: #8ec5ff; text-decoration: none; } code { color: #b7e5ca; word-break: break-all; }
    .empty { padding: 48px 0; text-align: center; border: 1px dashed #394761; border-radius: 14px; }
  </style>
</head>
<body>
  <header><div><h1>AgentPlan</h1><div class="muted">Inspect. Approve. Execute. Audit.</div></div><span class="pill">local-first</span></header>
  <main><div id="app"><p class="muted">Loading plans…</p></div></main>
  <script>
    const app = document.getElementById('app');
    const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    fetch('/api/plans').then((response) => response.json()).then((plans) => {
      if (!plans.length) { app.innerHTML = '<div class="empty"><h2>No plans yet</h2><p class="muted">Run an AgentPlan example to create the first plan.</p></div>'; return; }
      app.innerHTML = '<div class="grid">' + plans.map((plan) => '<article class="card"><h2><a href="/api/plans/' + encodeURIComponent(plan.planId) + '">' + esc(plan.agent) + '</a></h2><p class="muted">' + esc(plan.planId) + '</p><p><span class="pill">' + esc(plan.status) + '</span> <span class="risk">risk ' + Math.max(0, ...plan.actions.map((action) => action.risk.score)) + '</span></p><p>' + plan.actions.length + ' action(s) · ' + esc(plan.environment) + '</p></article>').join('') + '</div>';
    }).catch((error) => { app.innerHTML = '<p>Unable to load plans: ' + esc(error.message) + '</p>'; });
  </script>
</body>
</html>`;

function safePlan(plan: AgentPlan): unknown {
  return redactValue({
    ...plan,
    actions: plan.actions.map((action) => {
      const { input: _input, ...safeAction } = action;
      return safeAction;
    })
  });
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer"
  });
  response.end(body);
}

function decodePlanId(value: string): string | undefined {
  try {
    const planId = decodeURIComponent(value);
    return /^plan_[A-Za-z0-9]+$/.test(planId) ? planId : undefined;
  } catch {
    return undefined;
  }
}

async function handle(request: IncomingMessage, response: ServerResponse, store: FilePlanStore): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && requestUrl.pathname === "/") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer"
    });
    response.end(dashboardHtml);
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/api/plans") {
    sendJson(response, (await store.listPlans()).map(safePlan));
    return;
  }
  const planMatch = /^\/api\/plans\/([^/]+)$/.exec(requestUrl.pathname);
  if (request.method === "GET" && planMatch?.[1]) {
    const planId = decodePlanId(planMatch[1]);
    if (!planId) {
      sendJson(response, { error: "Invalid plan id" }, 400);
      return;
    }
    const plan = await store.getPlan(planId);
    if (!plan) {
      sendJson(response, { error: "Plan not found" }, 404);
      return;
    }
    sendJson(response, safePlan(plan));
    return;
  }
  const auditMatch = /^\/api\/audit\/([^/]+)$/.exec(requestUrl.pathname);
  if (request.method === "GET" && auditMatch?.[1]) {
    const planId = decodePlanId(auditMatch[1]);
    if (!planId) {
      sendJson(response, { error: "Invalid plan id" }, 400);
      return;
    }
    sendJson(response, redactValue(await store.getAudit(planId)));
    return;
  }
  sendJson(response, { error: "Not found" }, 404);
}

export async function startDashboard(options: DashboardOptions = {}): Promise<Server> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const store = new FilePlanStore(path.join(cwd, ".agentplan"));
  await store.initialize();
  const server = createServer((request, response) => {
    void handle(request, response, store).catch((error: unknown) => {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 4321, options.host ?? "127.0.0.1", () => resolve()));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portValue = process.env.AGENTPLAN_DASHBOARD_PORT;
  const port = portValue ? Number.parseInt(portValue, 10) : 4321;
  await startDashboard({ port: Number.isFinite(port) ? port : 4321 });
  console.log(`AgentPlan dashboard listening at http://127.0.0.1:${Number.isFinite(port) ? port : 4321}`);
}
