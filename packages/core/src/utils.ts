import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function makeId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const entropy = randomBytes(5).toString("hex");
  return `${prefix}_${timestamp}${entropy}`;
}

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  }
  if (seen.has(value)) {
    throw new Error("Cannot canonicalize a cyclic value");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return result;
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item !== undefined) {
      result[key] = canonicalize(item, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, new WeakSet<object>())) ?? "null";
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

export function globToRegExp(pattern: string, pathMode = false): RegExp {
  const normalized = normalizeSlashes(pattern);
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        expression += pathMode ? ".*" : ".*";
        index += 1;
      } else {
        expression += pathMode ? "[^/]*" : ".*";
      }
    } else if (character === "?") {
      expression += pathMode ? "[^/]" : ".";
    } else {
      expression += escapeRegex(character ?? "");
    }
  }
  expression += "$";
  return new RegExp(expression, "i");
}

export function matchesGlob(value: string, pattern: string, pathMode = false): boolean {
  const normalizedValue = pathMode ? normalizeSlashes(value) : value;
  const normalizedPattern = pathMode ? normalizeSlashes(pattern) : pattern;
  if (pathMode && normalizedPattern.startsWith("./") && !normalizedValue.startsWith("./")) {
    return globToRegExp(normalizedPattern.slice(2), true).test(normalizedValue.replace(/^\.\//, ""));
  }
  return globToRegExp(normalizedPattern, pathMode).test(normalizedValue);
}

export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function toWorkspaceIdentifier(root: string, target: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" ? "." : `./${normalizeSlashes(relative)}`;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = parts;
  return first === 10 || first === 127 || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1" || normalized === "0.0.0.0") {
    return true;
  }
  if (isPrivateIpv4(normalized)) {
    return true;
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}… [truncated]`;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
