# Criteria And Checks

Design Harness findings are source-backed. A check should not emit a bare design opinion; it should emit evidence that points to a criterion.

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
- `runtime`: `static-dom`, `computed-style`, `viewport-sweep`, `interaction-simulation`, `human-review`, or `model-judged`.
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
- `project-contract`: checks backed by the project's own declared config (`design-guide.yaml`, `copy-style.yaml`); asserts "violates your declared contract", never universal quality; deterministic ceiling is `risk`.

The exhaustive sourceStrength x determinism x resultKind matrix (ceiling semantics — downgrading is always allowed) is defined in [ADR-001](adr/ADR-001-copy-audit-foundations.md) and enforced at the criterion level by `pnpm check:criteria-policy` (`packages/core/src/criteria-policy.ts`).

## Copy Style Contract

`copy-style.yaml` is the project-declared contract for rendered-copy checks. The core schema is `packages/core/schemas/copy-style.schema.json`; until CLI YAML parsing is implemented with an approved dependency, JSON-equivalent fixtures validate the same structure.

The v1 contract includes:

- `locale`: BCP47-style locale such as `ko-KR`.
- `josaHedgePolicy`: `flag` or `allow` for rendered josa hedge forms such as `을(를)`.
- `surfaceRegisters`: optional per-surface register targets using canonical slugs:
  - `haeyoche` = 해요체
  - `hapsyoche` = 합쇼체
  - `noun-form` = 명사형
  - `banmal` = 반말
- `glossary`: typed term tiers `approved`, `banned`, and `use-carefully`, with optional `literal` or `lemma` matching.
- `bannedPhrases`: configured phrases that are contract risks only when the project declares them.
- `surfaceMapping`: DOM/ARIA hints that map text inventory nodes to configured surfaces.

Supported surfaces are `button`, `error`, `marketing`, and `body`. Text nodes that cannot be mapped to a configured surface are treated as unconfigured; surface-specific copy checks must stay silent for them.

Default mapping guidance:

| Surface | High-confidence hints |
|---|---|
| `button` | `button`, `[role="button"]`, button-like links such as `a.btn` |
| `error` | `[role="alert"]`, `aria-live`, error-like selectors such as `.error` |
| `marketing` | headings, hero selectors, or explicit `data-copy-surface="marketing"` |
| `body` | paragraph and article text that is not claimed by a more specific surface |

Copy-style-backed criteria use `sourceStrength: "project-contract"` and can emit deterministic `risk` at most. They assert "this captured copy conflicts with your declared contract", not universal language quality.

### Computation Determinism Never Upgrades Criterion Strength

A check can be deterministically computable while its criterion is research-grade. Color counts, font-variant counts, and density budgets are exact measurements, but the claim "this hurts design quality" rests on research whose best validated metric sets explain only ~30-50% of variance in human aesthetic ratings (Reinecke et al. CHI 2013, adj R² = .48; Miniukovich & De Angeli CHI 2015, 49% web / 32% app). Such checks land as `research-emerging` or `industry-heuristic` source strength, `heuristic` determinism, and `risk` or `needs-review` result kind — and the advisory score must never be presented as an objective design-quality grade. Evidence table: [Visual Metrics Evidence](research/visual-metrics-evidence.md).

### Advisory Score Weights

The advisory score uses `advisoryScore.formulaVersion: "epistemic-weight-v1"` and starts from 100. Each deduction is still based on finding severity and confidence, then weighted by evidence tier:

- deterministic `failure`: `1.0`
- deterministic `risk`: `0.6`
- heuristic `risk`: `0.25`
- `needs-review`: `0` (score-exempt)

Findings without determinism/resultKind metadata are treated as unclassified and use the heuristic-risk fallback weight `0.25`; subjective unclassified findings are score-exempt. When unsure, the score downgrades instead of upgrading.

### Precision Over Recall In Heuristic Tiers

A false positive costs more than a miss: repeated false flags cause reviewers to ignore the whole report. When a heuristic check's precision is unproven, ship it informational or logged-only and promote it after calibration data exists.

### Do Not Build (Peer-Reviewed Evidence Against)

- Hue-template color-harmony scoring: no predictive power for theme ratings; inter-rater agreement on color-theme quality is only 52% (O'Donovan et al. SIGGRAPH 2011). The evidence-backed palette signal is lightness-contrast structure with a restrained hue spread.
- Mirror-symmetry or center-of-mass balance scoring for real UIs: validates strongly only on abstract stimuli and fails to generalize (Silvia & Barona 2009).
- Scored Korean readability: no validated formula exists for short UI strings (KRIT reaches 0.746 on long-form textbook text; its authors state no public datasets or baselines exist).

### Regulatory Mapping

Every criterion that cites `wcag-2-2` carries its WCAG 2.2 success-criterion IDs machine-readably in that source's `clausesByCriterion` map in `CRITERION_SOURCES` (enforced by `check:criteria-policy`), so future WCAG 3.0 or KWCAG remaps are mechanical — a new source entry with its own mapping, no criterion edits. The KWCAG 2.2 clause map lands with the v0.6 Korean market slice. WCAG 3.0 remains watch-only until Candidate Recommendation (projected Q4 2027 or later).

## Adding A Check

1. Add or reuse a criterion in `packages/core/src/criteria.ts`.
2. Add measurement fields to `ViewportMeasurements` in `packages/visual-audit/src/checks.ts`.
3. Collect browser evidence in `packages/visual-audit/src/browser-measurements.ts`.
4. Convert measurements to findings in `findingsFromMeasurements`.
5. Add good/bad fixture coverage under `examples/ui-quality-fixtures`.
6. Add unit coverage in `packages/visual-audit/src/checks.test.ts`.
7. Run `CI=true pnpm release:check` (build + typecheck + test + validate + pack + smoke). If a subcommand cannot run in your environment, list which ones were skipped and why — do not report the step as passed.

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
- Semantic accessibility: names, labels, images, headings, landmarks, page language declaration.
- Hierarchy review prompts: repeated equal-weight modules and saturated color noise that may flatten priority.
- Responsive readability: wide content, sticky obstruction, line length, target size.
- Interaction state: error association, color-only states, checklist state visibility, disabled controls, live status, dialogs, custom controls, moving content.
