# textlint Output Adapter

Checkout-local recipe. Converts a Design Harness `audit.json` into textlint's JSON result shape so an existing editor or CI toolchain can display findings without Design Harness owning a plugin.

`audit.json` and `report.md` remain the canonical integration boundary. This is a serialization, not an API.

## What it is not

- Not a textlint plugin, rule, preset, or package export.
- Not a lint pass — it never reads your source files.
- No textlint dependency is added. The format is emitted, not linked, so nothing here pins a textlint version.

## Usage

```bash
pnpm design-harness -- audit --url http://localhost:3000 --out runs/demo
pnpm render:textlint -- --run runs/demo --out runs/demo/textlint.json
```

Without `--out` the JSON goes to stdout and the summary to stderr, so it pipes cleanly:

```bash
node scripts/render-textlint-output.mjs --run runs/demo | your-consumer
```

`--label` overrides the grouping label, which otherwise uses the audited URL.

## Severity mapping

textlint has three levels. Design Harness grades findings on `determinism` and `resultKind`. The mapping is deliberately conservative:

| Design Harness | textlint | Level |
| --- | --- | --- |
| `deterministic` + `failure` | `error` | 2 |
| any other `risk` | `warning` | 1 |
| `needs-review`, or any `subjective` | `info` | 0 |

**Only a deterministic failure becomes an error.** An editor's error level is failure language, and HARD RULE 1 forbids presenting a heuristic or subjective finding as a failure. A high-`severity` heuristic risk is still a warning; the finding's own `severity` field never promotes it. This keeps the epistemic grading intact across the format boundary instead of flattening every finding into one red squiggle.

Auditing the committed `examples/reports/semantic-a11y-bad` fixture produces 0 errors, 12 warnings, and 2 info messages from its 14 findings — none of them is a deterministic failure, so none reaches error severity.

## Grouping and positions

textlint groups messages by file path. An audit has no source file, so the grouping key is `<label>#<viewport>`, which keeps desktop and mobile findings separable in an editor list.

`line` and `column` are fixed at `1` and every message carries `designHarness.positionIsSynthetic: true`. A rendered-DOM finding does not map to a source position, and inventing one would be a false provenance claim. A consumer that needs real evidence — selectors, regions, screenshots — must read `audit.json`.

## Provenance on every message

Each message carries a `designHarness` block with the adapter id, finding id, category, `determinism`, `resultKind`, `confidence`, and selector. textlint ignores unknown keys, so the extra data is safe to emit and lets a richer consumer recover the grading that the three-level severity scale cannot express.

## Why this recipe exists

The 2026-07-31 direction review found no external demand signal and argued the highest-leverage move is reaching a real consumer of the file contract. textlint 15.x is alive, has an established editor ecosystem, and ships zero Korean rules, so an output adapter is a cheap way to meet an existing toolchain where it already is. It is deliberately an adapter and not a plugin: the ROADMAP records "never a full plugin".
