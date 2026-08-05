# GitHub integration

AgentPlan keeps GitHub-specific transport outside the core. The `@agentplan/adapter-github` package handles issue comments, collaborator permissions and hash-bound approvals, while the core owns plan integrity and capability classification.

## Pull request policy check

The repository includes a local composite Action. It runs `doctor`, inspects the current configuration, compares it with the pull request base configuration, writes `agentplan.sarif` and can update one capability comment.

```yaml
permissions:
  contents: read
  issues: write

steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4
    with:
      version: 11.6.0
  - uses: actions/setup-node@v4
    with:
      node-version: 24.x
      cache: pnpm
  - run: pnpm install --frozen-lockfile
  - name: AgentPlan Policy Check
    uses: SamVale29/agentplan/.github/actions/agentplan-policy-check@main
    with:
      config: agentplan.yaml
      comment: true
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

Enable comments only for trusted repository pull requests. Fork pull requests receive a read-only token and should upload the SARIF artifact without attempting to write an issue comment.

## Approval adapter

Create the adapter with a repository, pull request number and a short-lived token:

```ts
import { GitHubApprovalAdapter } from "@agentplan/adapter-github";

const approval = new GitHubApprovalAdapter({
  owner: "SamVale29",
  repository: "agentplan",
  issueNumber: 42,
  token: process.env.GITHUB_TOKEN,
  timeoutMs: 15 * 60 * 1000
});
```

The adapter posts the sanitized plan and waits for an authorized collaborator to issue an exact command containing the plan hash. A changed plan produces a different hash and cannot reuse the earlier comment. Set `pollIntervalMs`, `timeoutMs` and `allowedPermissions` for the deployment's approval policy.

The adapter does not approve arbitrary comments, infer intent from prose or execute GitHub API calls beyond comments and permission checks. Keep `issues: write` and repository access scoped to the workflow that needs them.

## SARIF and capability diffs

Capability diffs are provider-neutral and can be used without GitHub:

```bash
agentplan capabilities diff \
  --before capabilities.before.json \
  --after capabilities.after.json \
  --sarif agentplan.sarif \
  --fail-on-critical
```

The SARIF file is suitable for upload by `github/codeql-action/upload-sarif` or as a normal CI artifact. It contains no raw action input; capability values are sanitized before classification and output.
