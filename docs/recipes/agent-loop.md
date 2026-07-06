# Agent Loop Recipes

Design Harness is model-agnostic. The useful unit is an evidence packet that any coding agent or reviewer can read the same way.

## Evidence Packet

Send this packet with every UI fix request:

```text
Target URL: <local URL>
Audit command: <exact command that produced this run>
Artifacts:
- runs/<name>/report.md
- runs/<name>/audit.json
- runs/<name>/screenshots/<viewport-name>.png
Rule: deterministic findings first, heuristic risks second, needs-review notes only when screenshot evidence supports them.
```

The agent should preserve the command and rerun it after changes. If the command cannot run, it should say why and leave the code in a state where the same command is still the next verification step.

## Fix Loop Contract

Use the same loop for Codex, Claude Code, Gemini CLI, or a human reviewer:

1. Read `report.md` first.
2. Open the screenshots before changing layout, color, spacing, or hierarchy.
3. Fix deterministic failures before heuristic risks.
4. Keep each change tied to a finding ID, selector, viewport, or screenshot region.
5. Do not flatten visual hierarchy while fixing overflow, contrast, or spacing.
6. Rerun the same audit command.
7. Summarize fixed findings, changed files, new artifact path, and remaining needs-review notes.

## Codex

```text
Use this Design Harness evidence packet as the source of truth:

<paste evidence packet>

Work in a tight review-fix-rerun loop.
Prioritize deterministic findings, then high-confidence heuristic risks.
For each code change, name the finding ID or screenshot evidence it addresses.
Do not treat needs-review notes as objective failures unless the screenshots make the issue clear.
After editing, rerun the exact audit command from the packet.
Finish with changed files, fixed findings, the new artifact path, and remaining risks.
```

Codex is strongest when the request also includes the repo branch and a specific acceptance line:

```text
Acceptance: the rerun report has no deterministic failures, and any remaining heuristic findings are explained.
```

## Claude Code

```text
Read the Design Harness report and inspect the screenshots before editing:

<paste evidence packet>

Make the smallest UI changes that resolve deterministic failures.
For heuristic risks, explain the tradeoff before changing layout or visual hierarchy.
Avoid broad redesign unless a finding cannot be fixed locally.
Rerun the exact audit command after changes.
Return a concise summary with files changed, findings resolved, and any remaining human-review items.
```

Claude Code often gives useful tradeoff notes. Ask it to keep those notes separate from measured failures:

```text
Separate measured failures from design judgment. Use "Measured", "Heuristic", and "Needs review" headings.
```

## Gemini CLI

```text
Ground the UI review in this Design Harness packet:

<paste evidence packet>

Prioritize concrete layout, accessibility, and interaction-state failures.
Use `audit.json` for exact finding IDs and `report.md` for the human-readable fix order.
Use the screenshots to confirm visual hierarchy before changing colors or spacing.
Leave subjective polish as review notes unless there is clear screenshot evidence.
Rerun the exact audit command and report the new artifact path.
```

Gemini CLI is useful for broad sweeps, but keep the implementation bounded:

```text
Do not refactor unrelated components. Fix only findings shown in the packet unless a direct dependency blocks the fix.
```

## Human Reviewer

Use the report as a checklist, not a verdict.

Review questions:

- Is each finding backed by a screenshot, DOM measurement, or accessibility signal?
- Is the severity right for the product context?
- Did the fix improve the screen without weakening the intended visual hierarchy?
- Did the agent rerun the same audit command?
- Should the issue become a fixture or regression test?

## PR Comment Template

```markdown
## Design Harness Review

Artifacts:
- report: `runs/<name>/report.md`
- audit: `runs/<name>/audit.json`
- screenshots: `runs/<name>/screenshots/`

Fixed:
- <finding id>: <short fix>

Still needs review:
- <finding id or screenshot region>: <why>

Verification:
- `<exact audit command>`: <passed / partial / blocked>
```
