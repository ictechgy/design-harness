# Open Design Handoff Spec

This is a retained v0.1 handoff contract only. Design Harness does not ship an Open Design plugin, and the integration is cut from the current roadmap unless the owner explicitly reopens it.

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

- Do not treat this spec as a production integration or as a commitment to build one.
- Do not collapse deterministic audit findings and subjective critique.
- Preserve evidence IDs so agents and humans can trace recommendations back to screenshots or measurements.
