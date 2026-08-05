import { matchesGlob, isRecord, truncate } from "./utils.js";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|access[_-]?key|secret|token|password|passwd|credential|authorization|cookie|private[_-]?key|connection[_-]?string)/i;
const SECRET_PATTERNS: readonly RegExp[] = [
  /((?:authorization|proxy-authorization)\s*:\s*bearer\s+)[^\s,;]+/gi,
  /((?:authorization|proxy-authorization)\s*:\s*basic\s+)[^\s,;]+/gi,
  /((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /([a-z][a-z0-9+.-]*:\/\/[^\s/:]+:)[^\s@]+(@)/gi
];

export interface RedactionOptions {
  environmentPatterns?: readonly string[];
  additionalPatterns?: readonly string[];
  maxDepth?: number;
  maxStringLength?: number;
}

function compileAdditionalPatterns(patterns: readonly string[]): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, "gi");
    } catch (error) {
      throw new Error(`Invalid redaction pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function redactString(value: string, additionalPatterns: readonly RegExp[], maxStringLength: number): string {
  let result = truncate(value, maxStringLength);
  for (const pattern of [...SECRET_PATTERNS, ...additionalPatterns]) {
    result = result.replace(pattern, (_match, prefix?: string, suffix?: string) => {
      if (typeof prefix === "string") {
        return `${prefix}${REDACTED}${typeof suffix === "string" ? suffix : ""}`;
      }
      return REDACTED;
    });
  }
  return result;
}

export function redactValue(value: unknown, options: RedactionOptions = {}, depth = 0, seen = new WeakSet<object>()): unknown {
  const maxDepth = options.maxDepth ?? 8;
  const maxStringLength = options.maxStringLength ?? 10_000;
  const additionalPatterns = compileAdditionalPatterns(options.additionalPatterns ?? []);
  if (depth > maxDepth) {
    return "[MAX_DEPTH]";
  }
  if (typeof value === "string") {
    return redactString(value, additionalPatterns, maxStringLength);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => redactValue(item, options, depth + 1, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || (options.environmentPatterns ?? []).some((pattern) => matchesGlob(key, pattern))) {
      result[key] = REDACTED;
    } else {
      result[key] = redactValue(item, options, depth + 1, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function redactText(value: string, options: RedactionOptions = {}): string {
  const additionalPatterns = compileAdditionalPatterns(options.additionalPatterns ?? []);
  return redactString(value, additionalPatterns, options.maxStringLength ?? 10_000);
}

export function redactEnvironment(environment: NodeJS.ProcessEnv, patterns: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== "string") {
      continue;
    }
    result[key] = patterns.some((pattern) => matchesGlob(key, pattern)) ? REDACTED : redactText(value);
  }
  return result;
}

export function isSensitivePath(identifier: string): boolean {
  const normalized = identifier.replaceAll("\\", "/").toLowerCase();
  return normalized === ".env" || normalized.endsWith("/.env") || normalized.includes("/secrets/") || normalized.endsWith("/secrets");
}

export { REDACTED };
