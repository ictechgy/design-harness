# MCP Adapter

The v0.3 MCP adapter is checkout-local scaffolding: a small local dispatcher plus a tool manifest. It keeps the contract model-neutral and local-first while leaving room for a fuller MCP server package later. It is not yet a shipped npm package API.

- Manifest: `integrations/mcp/design-harness.tools.json`
- Dispatcher: `scripts/mcp-adapter.mjs`

List tools:

```bash
pnpm build
pnpm mcp:tools
```

Call the PR-comment renderer through the adapter:

```bash
pnpm build
node scripts/mcp-adapter.mjs call design_harness_render_pr_comment '{"runDir":"runs/design-harness"}'
```

Call the scenario runner through the adapter:

```bash
pnpm build
node scripts/mcp-adapter.mjs call design_harness_run_scenarios '{"configPath":"examples/scenarios/merchant-dashboard.scenarios.json","outDir":"runs/scenarios/merchant-dashboard"}'
```

## Safety Boundary

- The adapter does not call hosted models.
- Audit and scenario target URLs must be local HTTP(S) URLs. This validates initial targets; it does not yet block remote browser subresources loaded by the local app.
- `runDir`, `configPath`, and `outDir` are validated as workspace-relative paths before filesystem reads/writes or subprocess calls.
- Scenario subprocess calls have bounded runtime and compact stdout/stderr tails.
- Generated Midjourney reference images remain outside runtime.
- Tool outputs point to local artifacts instead of embedding screenshots into protocol messages.

MCP hosts can wrap the manifest entries as native tools, or call the dispatcher as a subprocess while preserving the same input schema.
