import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const examplesRoot = path.join(root, "examples");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(target));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(target);
    }
  }
  return files;
}

const files = await walk(examplesRoot);
for (const file of files) {
  await execFileAsync(process.execPath, ["--check", file], { cwd: root });
}
await access(path.join(examplesRoot, "actions", "file-write.yaml"));
await access(path.join(examplesRoot, "actions", "dangerous-shell.yaml"));
console.log(`Validated ${files.length} executable example modules.`);
