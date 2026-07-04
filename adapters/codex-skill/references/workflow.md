# Design Harness Codex Workflow

This adapter is intentionally thin. It exists to make Codex follow the same artifact contract as every other client.

## Minimum Loop

1. Brief: identify users, goals, constraints, and success criteria.
2. Build: create or update the UI.
3. Audit: run the CLI against a local URL.
4. Read: inspect `report.md`, `audit.json`, and screenshots.
5. Revise: fix actionable deterministic failures first, then deterministic risks, then heuristic review prompts.
6. Verify: rerun the same CLI command into a new output directory.

## Revision Priority

1. Render failure or blank render.
2. Deterministic failures.
3. Deterministic risks with high or medium confidence.
4. Semantic accessibility and interaction-state risks that point to concrete selectors.
5. Heuristic `needs-review` prompts after confirming the product context.
6. Optional subjective critique and human visual polish notes.

## Finding Fields

Prefer findings with `criterionId`, `sourceRefs`, `determinism`, `resultKind`, `runtime`, `observed`, and `expected`.

Do not treat heuristic or subjective findings as hard failures without human review.
