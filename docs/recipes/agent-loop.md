# Agent Loop Recipes

Design Harness is model-agnostic. The important thing is to give the agent the same evidence a human reviewer would use: `report.md`, `audit.json`, and the screenshots.

## Codex

```text
Use runs/design-harness/report.md as the source of truth.
Fix deterministic findings first, then high-confidence heuristic risks.
Do not treat needs-review notes as objective failures unless the screenshots support them.
After editing, rerun the same Design Harness command and summarize changed findings.
```

## Claude Code

```text
Read runs/design-harness/report.md and inspect the linked screenshots.
Make the smallest UI changes that resolve deterministic failures.
For heuristic risks, explain the tradeoff before changing layout or visual hierarchy.
Run the same audit again and include the new artifact path in your summary.
```

## Gemini CLI

```text
Ground the UI review in runs/design-harness/report.md, audit.json, and screenshots.
Prioritize concrete layout, accessibility, and interaction-state failures.
Leave subjective polish as review notes unless there is clear screenshot evidence.
Rerun the audit command after fixes.
```

## Human Reviewer

Use the report as a checklist, not a verdict. A good review usually asks:

- Is the finding backed by a screenshot, DOM measurement, or accessibility signal?
- Is the severity right for the product context?
- Did the fix improve the screen without flattening visual hierarchy?
- Should this failure become a fixture or regression test?
