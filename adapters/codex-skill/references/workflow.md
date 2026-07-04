# Design Harness Codex Workflow

This adapter is intentionally thin. It exists to make Codex follow the same artifact contract as every other client.

## Minimum Loop

1. Brief: identify users, goals, constraints, and success criteria.
2. Build: create or update the UI.
3. Audit: run the CLI against a local URL.
4. Read: inspect `report.md`, `audit.json`, and screenshots.
5. Revise: fix actionable deterministic findings first.
6. Verify: rerun the same CLI command into a new output directory.

## Revision Priority

1. Render failure or blank render.
2. Horizontal overflow.
3. Likely text clipping.
4. DOM-computed contrast risk.
5. Human visual polish notes.
