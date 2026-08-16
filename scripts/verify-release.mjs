import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];

if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  throw new Error(`Release tag must use vMAJOR.MINOR.PATCH, received ${tag ?? "(missing)"}.`);
}
if (tag !== `v${root.version}`) {
  throw new Error(`Release tag ${tag} does not match the workspace version ${root.version}.`);
}

const packageDirectories = ["apps", "packages"];
for (const directory of packageDirectories) {
  const entries = await readdir(path.resolve(directory), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageFile = path.resolve(directory, entry.name, "package.json");
    const metadata = JSON.parse(await readFile(packageFile, "utf8"));
    if (metadata.private === true) {
      continue;
    }
    if (metadata.version !== root.version) {
      throw new Error(`${packageFile} has version ${metadata.version}; expected ${root.version}.`);
    }
  }
}

console.log(`Release ${tag} is consistent across all publishable workspace packages.`);
