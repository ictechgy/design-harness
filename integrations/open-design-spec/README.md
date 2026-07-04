# Open Design Handoff Spec

This is a v0.1 handoff contract only. Design Harness does not ship a verified Open Design plugin yet.

## Goal

Let an Open Design workflow consume the same evidence bundle produced by the CLI:

```text
metadata.json
audit.json
report.md
screenshots/desktop.png
screenshots/mobile.png
```

## Inputs

- A local URL or future screenshot bundle.
- Optional design brief.
- Design Harness audit output directory.

## Outputs

- Imported screenshot references.
- Evidence-linked findings from `audit.json`.
- Optional subjective critique that references existing evidence IDs.
- A proposed iteration prompt or task list.

## Constraints

- Do not treat Open Design integration as production-ready until the API surface is verified.
- Do not collapse deterministic audit findings and subjective critique.
- Preserve evidence IDs so agents and humans can trace recommendations back to screenshots or measurements.
