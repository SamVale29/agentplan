import type { CapabilityChange, CapabilityDiff } from "./capabilities.js";

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
}

export interface SarifResult {
  ruleId: string;
  level: "note" | "warning" | "error";
  message: { text: string };
  properties: Record<string, string>;
}

export interface SarifLog {
  $schema: "https://json.schemastore.org/sarif-2.1.0.json";
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        rules: SarifRule[];
        informationUri?: string;
      };
    };
    results: SarifResult[];
  }>;
}

export interface SarifOptions {
  toolName?: string;
  toolVersion?: string;
  informationUri?: string;
}

function ruleId(change: CapabilityChange): string {
  return `agentplan/${change.change}/${change.category}`;
}

function resultFor(change: CapabilityChange): SarifResult {
  const adapter = change.adapter === undefined ? "" : change.adapter;
  const properties: Record<string, string> = {
    change: change.change,
    category: change.category,
    value: change.value,
    severity: change.severity,
    reason: change.reason,
    ...(adapter.length === 0 ? {} : { adapter })
  };
  return {
    ruleId: ruleId(change),
    level: change.severity,
    message: { text: change.reason },
    properties
  };
}

function ruleFor(change: CapabilityChange): SarifRule {
  const id = ruleId(change);
  return {
    id,
    name: `${change.change} ${change.category}`,
    shortDescription: { text: `${change.change} ${change.category} capability` },
    fullDescription: { text: change.reason }
  };
}

export function capabilityDiffToSarif(diff: CapabilityDiff, options: SarifOptions = {}): SarifLog {
  const changes = [...diff.added, ...diff.removed];
  const rules = new Map<string, SarifRule>();
  for (const change of changes) {
    rules.set(ruleId(change), ruleFor(change));
  }
  const driver = {
    name: options.toolName ?? "AgentPlan",
    version: options.toolVersion ?? "0.1.0",
    rules: [...rules.values()],
    ...(options.informationUri === undefined ? {} : { informationUri: options.informationUri })
  };
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{ tool: { driver }, results: changes.map(resultFor) }]
  };
}

export function serializeSarif(log: SarifLog): string {
  return `${JSON.stringify(log, null, 2)}\n`;
}
