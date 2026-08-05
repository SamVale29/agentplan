import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const roots = ["packages", "apps", "tests", "scripts", "docs", ".github"];
const extensions = new Set([".ts", ".mjs", ".md", ".yaml", ".yml", ".json"]);
const ignored = new Set(["node_modules", "dist", ".git"]);
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(target);
    } else if (extensions.has(path.extname(entry.name))) {
      const source = await readFile(target, "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
        if (/\s+$/.test(line)) violations.push(`${target}:${index + 1}: trailing whitespace`);
      });
    }
  }
}

for (const root of roots) {
  await walk(path.resolve(root));
}
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Formatting check passed.");
}
