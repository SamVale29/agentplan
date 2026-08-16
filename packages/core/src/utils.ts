import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { isIP } from "node:net";

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

function parseIpv4(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!];
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) {
    return false;
  }
  const [first, second, third] = parts;
  return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 0 && third === 0) || (first === 192 && second === 0 && third === 2) || (first === 192 && second === 168) || (first === 198 && (second === 18 || second === 19 || second === 51)) || (first === 203 && second === 0 && third === 113) || first >= 224;
}

function ipv6Words(hostname: string): number[] | undefined {
  const value = hostname.toLowerCase().replace(/%25.*$/, "");
  const ipv4Marker = value.lastIndexOf(":");
  let normalized = value;
  if (value.includes(".")) {
    if (ipv4Marker < 0) {
      return undefined;
    }
    const ipv4 = parseIpv4(value.slice(ipv4Marker + 1));
    if (!ipv4) {
      return undefined;
    }
    const [first, second, third, fourth] = ipv4;
    const high = (first << 8) | second;
    const low = (third << 8) | fourth;
    normalized = `${value.slice(0, ipv4Marker + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const pieces = normalized.split("::");
  if (pieces.length > 2) {
    return undefined;
  }
  const head = pieces[0] ? pieces[0].split(":").filter(Boolean) : [];
  const tail = pieces.length === 2 && pieces[1] ? pieces[1].split(":").filter(Boolean) : [];
  if ([...head, ...tail].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return undefined;
  }
  const missing = pieces.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0 || (pieces.length === 1 && head.length !== 8)) {
    return undefined;
  }
  return [...head.map((part) => Number.parseInt(part, 16)), ...Array.from({ length: missing }, () => 0), ...tail.map((part) => Number.parseInt(part, 16))];
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (isIP(normalized) !== 6) {
    return false;
  }
  const words = ipv6Words(normalized);
  if (!words || words.length !== 8) {
    return false;
  }
  const first = words[0]!;
  const mappedIpv4 = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mappedIpv4) {
    const ipv4 = `${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`;
    return isPrivateIpv4(ipv4);
  }
  return words.every((word) => word === 0) || (words.every((word, index) => index === 7 ? word === 1 : word === 0)) || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }
  return isPrivateIpv4(normalized) || isPrivateIpv6(normalized);
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}… [truncated]`;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
