import { access, readFile } from "node:fs/promises";
import path from "node:path";

const required = [
  "README.md",
  "README.pt-BR.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "ROADMAP.md",
  "ARCHITECTURE.md",
  "CHANGELOG.md",
  "docs/getting-started.md",
  "docs/configuration.md",
  "docs/cli.md",
  "docs/sdk.md",
  "docs/adapters.md",
  "docs/github.md",
  "docs/policies.md",
  "docs/risk-model.md",
  "docs/audit.md",
  "docs/security/threat-model.md",
  "docs/examples.md",
  "docs/limitations.md"
];

for (const relative of required) {
  await access(path.resolve(relative));
}
const english = await readFile(path.resolve("README.md"), "utf8");
const portuguese = await readFile(path.resolve("README.pt-BR.md"), "utf8");
const selector = "[English](README.md) | [Português do Brasil](README.pt-BR.md)";
if (!english.includes(selector) || !portuguese.includes(selector)) {
  throw new Error("Both README files must contain the language selector.");
}
for (const heading of ["## The problem", "## Installation", "## Security model", "## Limitations", "## Roadmap", "## License"]) {
  if (!english.includes(heading)) throw new Error(`README.md is missing ${heading}`);
}
for (const heading of ["## O problema", "## Instalação", "## Modelo de segurança", "## Limitações", "## Roadmap", "## Licença"]) {
  if (!portuguese.includes(heading)) throw new Error(`README.pt-BR.md is missing ${heading}`);
}
console.log(`Documentation check passed for ${required.length} required files.`);
