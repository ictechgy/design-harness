---
name: product-ui-designer
description: Use Design Harness artifacts to run a brief -> implementation -> audit -> report -> revision loop for product UI work.
---

# Product UI Designer

Use this skill when improving a frontend UI with Design Harness evidence.

## Workflow

1. Capture or read a short design brief before implementation.
2. Implement or inspect the UI.
3. Run the Design Harness CLI against the local URL:

```bash
pnpm design-harness -- audit --url http://localhost:<port> --out runs/<run-id>
```

4. Read `audit.json` and `report.md`.
5. If actionable findings exist, make one focused revision pass.
6. Rerun the audit and compare the new report against the previous run.

## Rules

- Do not invent a parallel critique structure. Consume `audit.json`, `metadata.json`, screenshots, and `report.md`.
- Keep deterministic audit findings separate from optional subjective critique.
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
