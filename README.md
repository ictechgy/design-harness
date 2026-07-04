# Design Harness

Design Harness is an open-source, model-agnostic UI/UX critique, visual QA, and iteration harness for AI coding agents and design automation tools.

The local CLI golden path is intentionally narrow:

```text
local URL -> desktop/mobile screenshots -> schema-valid audit.json -> report.md -> iteration prompt scaffold
```

Design Harness does not train a design model, require a hosted LLM, or claim that a numeric score is objective design quality. It creates repeatable evidence that humans and agents can use to improve UI work.

## Status

This repository has the local CLI audit loop implemented and is expanding the v0.2 research-backed quality model. MCP and Open Design materials remain contracts/specs until verified implementations exist.

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
  report-manifest.json
  screenshots/
    desktop.png
    mobile.png
```

## Packages

- `@design-harness/core`: schemas, validation, scoring, report rendering, shared types.
- `@design-harness/visual-audit`: Playwright screenshot capture and source-backed DOM, layout, accessibility, and interaction checks.
- `@design-harness/cli`: command-line entry point for the v0.1 audit workflow.

## What Gets Checked

Checks are conservative and source-backed:

- render failure or blank render
- horizontal overflow
- likely text clipping
- DOM-computed contrast risk
- semantic accessibility risks: missing names, form labels, image alternatives, heading issues, landmarks
- responsive readability risks: wide content, sticky obstruction, excessive line length, target size
- interaction state risks: error association, color-only states, disabled controls, live status, dialogs, custom controls, moving content

Every finding includes severity, confidence, viewport, category, evidence references, and a recommendation. v0.2 findings may also include `criterionId`, `sourceRefs`, `determinism`, `resultKind`, runtime type, observed evidence, and expected behavior.

See [Criteria And Checks](docs/criteria-and-checks.md) and [Fixture Catalog](docs/fixtures.md).

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
pnpm playwright:install
```

Partial audits still write artifacts but exit with code `2` by default. Use `--allow-partial` when a debugging workflow should treat partial artifacts as success.

## Adapters And Specs

- `adapters/codex-skill`: thin Codex workflow adapter that consumes generated reports.
- `integrations/mcp-spec`: schema-only tool contract for future MCP clients.
- `integrations/open-design-spec`: handoff contract for future Open Design integration.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is Apache-2.0 licensed.
