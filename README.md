# Design Harness

Design Harness is an open-source, model-agnostic UI/UX critique, visual QA, and iteration harness for AI coding agents and design automation tools.

The v0.1 golden path is intentionally narrow:

```text
local URL -> desktop/mobile screenshots -> schema-valid audit.json -> report.md -> iteration prompt scaffold
```

Design Harness does not train a design model, require a hosted LLM, or claim that a numeric score is objective design quality. It creates repeatable evidence that humans and agents can use to improve UI work.

## Status

This repository is in early v0.1 implementation. The required path is a local CLI audit loop; MCP and Open Design materials are contracts/specs until verified implementations exist.

## Quickstart

```bash
pnpm install
pnpm build
pnpm design-harness -- audit --url http://localhost:3000 --out runs/demo
```

Expected output:

```text
runs/demo/
  metadata.json
  audit.json
  report.md
  screenshots/
    desktop.png
    mobile.png
```

## Packages

- `@design-harness/core`: schemas, validation, scoring, report rendering, shared types.
- `@design-harness/visual-audit`: Playwright screenshot capture and deterministic visual checks.
- `@design-harness/cli`: command-line entry point for the v0.1 audit workflow.

## What Gets Checked

The first deterministic checks are conservative:

- render failure or blank render
- horizontal overflow
- likely text clipping
- DOM-computed contrast risk

Every finding includes severity, confidence, viewport, category, evidence references, and a recommendation.

## Example Fixture

Run the merchant-dashboard fixture in one terminal:

```bash
pnpm example:serve
```

Then audit it:

```bash
pnpm design-harness -- audit --url http://localhost:4173 --out runs/merchant-dashboard
```

If Chromium is not installed for Playwright, run:

```bash
pnpm exec playwright install chromium
```

## Adapters And Specs

- `adapters/codex-skill`: thin Codex workflow adapter that consumes generated reports.
- `integrations/mcp-spec`: schema-only tool contract for future MCP clients.
- `integrations/open-design-spec`: handoff contract for future Open Design integration.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is Apache-2.0 licensed.
