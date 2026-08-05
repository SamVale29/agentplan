import { z } from "zod";
import type { AgentCapabilities } from "./model.js";
import { redactText } from "./redaction.js";
import { isRecord } from "./utils.js";

export const CapabilityChangeKindSchema = z.enum(["added", "removed"]);
export type CapabilityChangeKind = z.infer<typeof CapabilityChangeKindSchema>;

export const CapabilityCategorySchema = z.enum([
  "adapter",
  "tool",
  "permission",
  "environment-variable",
  "filesystem",
  "external-host",
  "destructive-action"
]);
export type CapabilityCategory = z.infer<typeof CapabilityCategorySchema>;

export const CapabilitySeveritySchema = z.enum(["note", "warning", "error"]);
export type CapabilitySeverity = z.infer<typeof CapabilitySeveritySchema>;

export const CapabilityChangeSchema = z.object({
  change: CapabilityChangeKindSchema,
  category: CapabilityCategorySchema,
  value: z.string().min(1),
  adapter: z.string().min(1).optional(),
  severity: CapabilitySeveritySchema,
  reason: z.string().min(1)
});
export type CapabilityChange = z.infer<typeof CapabilityChangeSchema>;

export const CapabilityDiffSchema = z.object({
  added: z.array(CapabilityChangeSchema),
  removed: z.array(CapabilityChangeSchema),
  requiresReview: z.boolean(),
  hasCritical: z.boolean(),
  summary: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative()
  })
});
export type CapabilityDiff = z.infer<typeof CapabilityDiffSchema>;

export type CapabilitySnapshot =
  | AgentCapabilities
  | readonly AgentCapabilities[]
  | Record<string, unknown>;

interface CapabilityRecord {
  category: CapabilityCategory;
  value: string;
  adapter?: string;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function addRecord(records: Map<string, CapabilityRecord>, category: CapabilityCategory, value: string, adapter?: string): void {
  const sanitizedValue = redactText(value);
  if (sanitizedValue.length === 0) {
    return;
  }
  const key = `${category}:${adapter ?? ""}:${sanitizedValue}`;
  const record = adapter === undefined ? { category, value: sanitizedValue } : { category, value: sanitizedValue, adapter };
  records.set(key, record);
}

function addAdapterRecords(records: Map<string, CapabilityRecord>, value: unknown): void {
  if (!isRecord(value) || typeof value.adapter !== "string" || value.adapter.length === 0) {
    return;
  }
  const adapter = value.adapter;
  addRecord(records, "adapter", adapter);
  for (const tool of stringValues(value.tools)) {
    addRecord(records, "tool", tool, adapter);
  }
  for (const permission of stringValues(value.permissions)) {
    addRecord(records, "permission", permission, adapter);
  }
  for (const host of stringValues(value.externalHosts)) {
    addRecord(records, "external-host", host, adapter);
  }
  for (const action of stringValues(value.destructiveActions)) {
    addRecord(records, "destructive-action", action, adapter);
  }
  if (isRecord(value.filesystem)) {
    for (const name of ["read", "write", "delete", "workspaceBound"]) {
      if (value.filesystem[name] === true) {
        addRecord(records, "filesystem", name, adapter);
      }
    }
  }
}

function addRootRecords(records: Map<string, CapabilityRecord>, root: Record<string, unknown>): void {
  for (const variable of stringValues(root.referencedEnvironmentVariables)) {
    addRecord(records, "environment-variable", variable);
  }
  for (const action of stringValues(root.potentiallyDestructiveActions)) {
    addRecord(records, "destructive-action", action);
  }

  const workspace = isRecord(root.workspace) ? root.workspace : undefined;
  for (const path of stringValues(workspace?.allowRead)) {
    addRecord(records, "filesystem", `read ${path}`);
  }
  for (const path of stringValues(workspace?.allowWrite)) {
    addRecord(records, "filesystem", `write ${path}`);
  }

  const shell = isRecord(root.shell) ? root.shell : undefined;
  for (const command of stringValues(shell?.allow)) {
    addRecord(records, "permission", `shell.execute ${command}`, "shell");
  }
  for (const command of stringValues(shell?.requireApproval)) {
    addRecord(records, "permission", `shell.execute approval ${command}`, "shell");
  }

  const network = isRecord(root.network) ? root.network : undefined;
  for (const host of stringValues(network?.allowHosts)) {
    addRecord(records, "external-host", host, "network");
  }

  const policy = isRecord(root.policy) ? root.policy : undefined;
  if (policy) {
    collectPolicyRecords(records, policy);
  }
}

function collectPolicyRecords(records: Map<string, CapabilityRecord>, value: Record<string, unknown>, prefix = "policy"): void {
  for (const [key, item] of Object.entries(value)) {
    const nextPrefix = `${prefix}.${key}`;
    if (typeof item === "string" && ["allow", "require-approval"].includes(item)) {
      addRecord(records, "permission", `${nextPrefix}=${item}`, "policy");
    } else if (isRecord(item)) {
      collectPolicyRecords(records, item, nextPrefix);
    }
  }
}

function collectRecords(snapshot: unknown): Map<string, CapabilityRecord> {
  const records = new Map<string, CapabilityRecord>();
  if (Array.isArray(snapshot)) {
    for (const adapter of snapshot) {
      addAdapterRecords(records, adapter);
    }
    return records;
  }
  if (!isRecord(snapshot)) {
    return records;
  }

  if (typeof snapshot.adapter === "string") {
    addAdapterRecords(records, snapshot);
  }
  if (Array.isArray(snapshot.adapters)) {
    for (const adapter of snapshot.adapters) {
      addAdapterRecords(records, adapter);
    }
  }
  addRootRecords(records, snapshot);
  return records;
}

function severityFor(kind: CapabilityChangeKind, category: CapabilityCategory, value: string): CapabilitySeverity {
  if (kind === "removed") {
    return "note";
  }
  if (category === "destructive-action") {
    return "error";
  }
  if (category === "permission" && /(delete|push|charge|refund|identity\.modify|shell\.execute|filesystem\.write|filesystem\.delete|cloud\.delete)/i.test(value)) {
    return "error";
  }
  if (["environment-variable", "external-host", "filesystem", "permission"].includes(category)) {
    return "warning";
  }
  return "note";
}

function reasonFor(kind: CapabilityChangeKind, category: CapabilityCategory, value: string): string {
  if (kind === "removed") {
    return `Capability removed: ${category} ${value}`;
  }
  if (category === "destructive-action") {
    return `New destructive capability requires manual review: ${value}`;
  }
  if (category === "external-host") {
    return `New external host expands the network boundary: ${value}`;
  }
  if (category === "permission") {
    return `New permission may expand the agent's authority: ${value}`;
  }
  return `New capability detected: ${category} ${value}`;
}

function compareRecords(left: CapabilityRecord, right: CapabilityRecord): number {
  return `${left.category}:${left.adapter ?? ""}:${left.value}`.localeCompare(`${right.category}:${right.adapter ?? ""}:${right.value}`);
}

function toChange(kind: CapabilityChangeKind, record: CapabilityRecord): CapabilityChange {
  const severity = severityFor(kind, record.category, record.value);
  const base = {
    change: kind,
    category: record.category,
    value: record.value,
    severity,
    reason: reasonFor(kind, record.category, record.value)
  };
  const withAdapter = record.adapter === undefined ? base : { ...base, adapter: record.adapter };
  return CapabilityChangeSchema.parse(withAdapter);
}

export function diffCapabilities(before: unknown, after: unknown): CapabilityDiff {
  const beforeRecords = collectRecords(before);
  const afterRecords = collectRecords(after);
  const added = [...afterRecords.entries()]
    .filter(([key]) => !beforeRecords.has(key))
    .map(([, record]) => toChange("added", record))
    .sort((left, right) => `${left.category}:${left.adapter ?? ""}:${left.value}`.localeCompare(`${right.category}:${right.adapter ?? ""}:${right.value}`));
  const removed = [...beforeRecords.entries()]
    .filter(([key]) => !afterRecords.has(key))
    .map(([, record]) => toChange("removed", record))
    .sort((left, right) => `${left.category}:${left.adapter ?? ""}:${left.value}`.localeCompare(`${right.category}:${right.adapter ?? ""}:${right.value}`));
  return CapabilityDiffSchema.parse({
    added,
    removed,
    requiresReview: added.length > 0,
    hasCritical: added.some((change) => change.severity === "error"),
    summary: { added: added.length, removed: removed.length }
  });
}

function changeMarker(change: CapabilityChange): string {
  return change.severity === "error" ? "⚠" : change.severity === "warning" ? "⚠" : "✓";
}

function formatChange(change: CapabilityChange): string {
  const adapter = change.adapter === undefined ? "" : ` (${change.adapter})`;
  return `- ${changeMarker(change)} **${change.category}**${adapter}: \`${change.value}\` — ${change.reason}`;
}

export function formatCapabilityDiffMarkdown(diff: CapabilityDiff): string {
  const result = diff.hasCritical ? "Manual review required" : diff.requiresReview ? "Review recommended" : "No capability changes";
  const lines = [
    "## AgentPlan capability diff",
    "",
    `Result: **${result}**`,
    `Added: ${diff.summary.added} · Removed: ${diff.summary.removed}`,
    ""
  ];
  if (diff.added.length > 0) {
    lines.push("### Added", "", ...diff.added.map(formatChange), "");
  }
  if (diff.removed.length > 0) {
    lines.push("### Removed", "", ...diff.removed.map(formatChange), "");
  }
  if (diff.added.length === 0 && diff.removed.length === 0) {
    lines.push("No capability changes detected.");
  }
  return lines.join("\n").trim();
}
