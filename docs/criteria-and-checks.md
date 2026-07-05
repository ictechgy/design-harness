# Criteria And Checks

Design Harness v0.2 findings are source-backed. A check should not emit a bare design opinion; it should emit evidence that points to a criterion.

## Criterion Registry

Criteria live in `packages/core/src/criteria.ts`.

Each criterion includes:

- `id`: stable identifier, for example `a11y.text-contrast.minimum`.
- `category`: one of the existing rubric categories.
- `sourceRefs`: IDs from `CRITERION_SOURCES`.
- `sourceStrength`: how strong the source basis is.
- `determinism`: `deterministic`, `heuristic`, or `subjective`.
- `resultKind`: `failure`, `risk`, or `needs-review`.
- `confidenceDefault`: default confidence for findings produced by mapped checks.
- `runtime`: `static-dom`, `computed-style`, `viewport-sweep`, `interaction-simulation`, or `human-review`.
- `checkNames`: runtime check names that map to the criterion.
- `remediationHint`: short implementation guidance.

## Source Strength Rules

Only `official-testable` criteria should support deterministic pass/fail language. Other sources should support risks, recommendations, or review prompts.

Source strengths:

- `official-testable`: scoped deterministic checks can emit failures or risks.
- `official-pattern`: recommendations and review prompts.
- `industry-heuristic`: heuristic risks and review prompts.
- `research-emerging`: exploratory framing only.
- `philosophical`: optional subjective critique only.

## Adding A Check

1. Add or reuse a criterion in `packages/core/src/criteria.ts`.
2. Add measurement fields to `ViewportMeasurements` in `packages/visual-audit/src/checks.ts`.
3. Collect browser evidence in `packages/visual-audit/src/browser-measurements.ts`.
4. Convert measurements to findings in `findingsFromMeasurements`.
5. Add good/bad fixture coverage under `examples/ui-quality-fixtures`.
6. Add unit coverage in `packages/visual-audit/src/checks.test.ts`.
7. Run:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm validate
pnpm smoke:example
```

## Reference-Derived Calibration

Reference images can suggest new fixture ideas, but they are not criteria. When a Midjourney Reference Lab example becomes a harness artifact:

- map deterministic expected findings to existing `criterionId` values with `official-testable` source strength;
- mark weaker observations as `heuristic-risk`, `human-review`, or `future-criterion`;
- keep generated assets out of the default commit path;
- validate the manifest with `pnpm validate:midjourney-lab`.

See [Midjourney Reference Lab Workflow](midjourney-reference-lab/workflow.md).

### Promoted Reference-Derived Heuristics

The first promoted Midjourney-derived heuristics are intentionally conservative. They emit `needs-review` findings, not deterministic failures:

- `hierarchy.visual-weight.priority-risk` via `repeated-visual-weight-risk`: flags many similarly sized modules that may flatten the scan path.
- `color.hierarchy.saturation-discipline` via `saturated-color-noise-risk`: flags many saturated color regions across several hue groups that may make color stop working as a priority signal.
- `state.checklist.activation-visibility` via `checklist-state-visibility-risk`: flags checklist state treatments that are inconsistent or too visually similar across checked and unchecked items.

These checks are useful prompts for reviewer attention. They should be interpreted alongside product context, user task priority, and any intentional brand or status system.

## Report Copy Guardrails

Reports should avoid unqualified claims such as:

- "WCAG compliant"
- "accessible"
- "good design"
- "best practice violation"
- "objectively better"

Use scoped language:

- "This observed element failed the configured contrast threshold."
- "This captured DOM may lack an accessible name."
- "This is a heuristic readability risk and should be reviewed."

## Current Check Families

- Render and operational stability.
- Responsiveness and overflow.
- Text clipping and contrast.
- Semantic accessibility: names, labels, images, headings, landmarks.
- Hierarchy review prompts: repeated equal-weight modules and saturated color noise that may flatten priority.
- Responsive readability: wide content, sticky obstruction, line length, target size.
- Interaction state: error association, color-only states, checklist state visibility, disabled controls, live status, dialogs, custom controls, moving content.
