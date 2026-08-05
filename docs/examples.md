# Examples

All examples are deterministic demonstrations. The support example never calls a payment system, and the shell example never executes the denied destructive command.

## File agent

```bash
pnpm exec agentplan run -- node examples/file-agent/index.mjs
```

The allowed read is pre-approved. The write presents a plan with a medium risk score and waits for `A`. The output file and audit records are local artifacts; remove them after experimenting.

## Shell agent

```bash
pnpm exec agentplan run -- node examples/shell-agent/index.mjs
```

The command example uses argv and `shell: false`. The install preview requires approval. The `rm -rf` request is blocked before the callback is reached. Use `--non-interactive` to verify that approvals are refused in automation.

## Support agent

```bash
pnpm exec agentplan run -- node examples/support-agent/index.mjs
```

Ticket lookup is simulated. A refund of 50 is below the configured limit and requires approval; 150 is denied by the financial maximum. No network or payment provider is used.

## MCP agent

```bash
pnpm exec agentplan run -- node examples/mcp-agent/index.mjs
```

The example prints a discovered tool, normalizes an `mcp.invoke` action and asks for approval. The executor returns a simulated result.

## CLI documents

```bash
pnpm exec agentplan policy check --input examples/actions/dangerous-shell.yaml --json
pnpm exec agentplan plan --input examples/actions/file-write.yaml
```

The documents are suitable for policy and approval demonstrations; they are not a replacement for reviewing the configuration of a real project.
