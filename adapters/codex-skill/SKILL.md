---
name: product-ui-designer
description: Use Design Harness artifacts to run a brief -> implementation -> audit -> report -> revision loop for product UI work.
---

# Product UI Designer (Codex)

Use this skill when improving a frontend UI with Design Harness evidence. Install by copying this directory to `.agents/skills/product-ui-designer/` in your project (or `$HOME/.agents/skills/product-ui-designer/` for all projects), then invoke it explicitly as `$product-ui-designer`. This adapter is intentionally thin: it makes Codex follow the same artifact contract as every other client. The rule content below is shared verbatim with the Claude Code adapter; the canonical copy lives in `adapters/shared/rules.md` and parity is CI-checked.

<!-- design-harness:shared:begin -->
## Workflow

1. Capture or read a short design brief before implementation.
2. Implement or inspect the UI.
3. Run the Design Harness CLI against the local URL:

```bash
npx @design-harness/cli@latest audit --url http://localhost:<port> --out runs/<run-id>
```

From a checkout of this repository, use `pnpm design-harness -- audit ...` instead.

4. Read `audit.json` and `report.md`.
5. If actionable findings exist, make one focused revision pass.
6. Rerun the audit into a new output directory and compare the reports.

## Revision Priority

1. Render failure or blank render.
2. Deterministic failures.
3. Deterministic risks with high or medium confidence.
4. Semantic accessibility and interaction-state risks that point to concrete selectors.
5. Heuristic `needs-review` prompts after confirming the product context.
6. Optional subjective critique and human visual polish notes.

## Rules

- Do not invent a parallel critique structure. Consume `audit.json`, `metadata.json`, screenshots, and `report.md`.
- Keep deterministic failures, deterministic risks, heuristic prompts, and optional subjective critique separate.
- Prefer findings with `criterionId`, `sourceRefs`, `determinism`, `resultKind`, `runtime`, `observed`, and `expected` when choosing fixes.
- Do not treat heuristic or subjective findings as hard failures without human review.
- Treat scores as advisory evidence, not objective design quality.
- Keep the core workflow model-agnostic; no required step should depend on one hosted LLM.

## Expected Artifacts

```text
runs/<run-id>/
  metadata.json
  audit.json
  report.md
  report-manifest.json
  screenshots/
    desktop.png
    mobile.png
```
<!-- design-harness:shared:end -->
