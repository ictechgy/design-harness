# MCP Adapter

The v0.3 MCP adapter is a small local dispatcher plus a tool manifest. It keeps the contract model-neutral and local-only while leaving room for a fuller MCP server package later.

- Manifest: `integrations/mcp/design-harness.tools.json`
- Dispatcher: `scripts/mcp-adapter.mjs`

List tools:

```bash
pnpm mcp:tools
```

Call the PR-comment renderer through the adapter:

```bash
node scripts/mcp-adapter.mjs call design_harness_render_pr_comment '{"runDir":"runs/design-harness"}'
```

Call the scenario runner through the adapter:

```bash
node scripts/mcp-adapter.mjs call design_harness_run_scenarios '{"configPath":"examples/scenarios/merchant-dashboard.scenarios.json","outDir":"runs/scenarios/merchant-dashboard"}'
```

## Safety Boundary

- The adapter does not call hosted models.
- Audit targets remain local HTTP(S) URLs.
- Generated Midjourney reference images remain outside runtime.
- Tool outputs point to local artifacts instead of embedding screenshots into protocol messages.

MCP hosts can wrap the manifest entries as native tools, or call the dispatcher as a subprocess while preserving the same input schema.
