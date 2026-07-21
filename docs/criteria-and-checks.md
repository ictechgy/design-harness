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

### Copy Style Contract

`copy-style.yaml` is the project-declared contract for rendered-copy checks. The core schema is `packages/core/schemas/copy-style.schema.json`. CLI users pass one explicit local file with `--copy <copy-style.yaml>`; the CLI applies a strict YAML 1.2 subset and validates the result against that existing schema before browser launch. It does not auto-discover configuration.

The v1 contract includes:

- `locale`: a primary language subtag plus an optional uppercase two-letter region, such as `ko` or `ko-KR`.
- `josaHedgePolicy`: `flag` or `allow` for rendered josa hedge forms such as `을(를)`; omission means `flag`.
- `surfaceRegisters`: optional per-surface register targets using canonical slugs:
  - `haeyoche` = 해요체
  - `hapsyoche` = 합쇼체
  - `noun-form` = 명사형
  - `banmal` = 반말
- `glossary`: typed term tiers `approved`, `banned`, and `use-carefully`, with optional `literal` or `lemma` matching.
- `bannedPhrases`: configured phrases that are contract risks only when the project declares them.
- `surfaceMapping`: an ordered list of surface rules. Each rule has one or more OR-ed `role` or namespaced `adapter` matchers.

Supported surfaces are `button`, `error`, `marketing`, and `body`. One capture-side materializer evaluates the captured text node first, then each ancestor from nearest to farthest. At each candidate node it evaluates the entire rule list in array order, and matchers inside a rule run in order: `role` matches a separate surface-role token, while an `adapter` matcher is evaluated only by the adapter that owns its lowercase namespace. The first matching matcher is recorded as `copySurface: { surface, ruleIndex, matcher }`, then resolution stops. A direct node match therefore outranks every ancestor match; an ancestor surface is inherited only when no closer node matches. The pure copy analyzer consumes that resolution and never replays matchers against serialized evidence.

The serialized evidence `role` and the surface-role token have intentionally different contracts. Evidence preserves a trimmed explicit `role` attribute exactly, including case and fallback-token lists; nodes without an explicit role retain the text-inventory's legacy implicit-role mapping. For surface matching only, the web capture adapter lowercases and tokenizes an explicit fallback list, selects its first recognized concrete WAI-ARIA role while skipping unknown and abstract roles, and falls back to its native-HTML role resolver when no concrete token remains. Native resolution includes control-specific semantics such as `summary` as `button`, `input[type=range]` as `slider`, and multi-select as `listbox`. This deterministic adapter resolver is not a claim that the serialized value came from the browser accessibility tree or a browser AOM API.

No rule match on the node or its ancestors means unconfigured; `body` and `html` propagate only when explicitly matched and are not automatic fallbacks. Register checks run only when both a node surface and `surfaceRegisters[surface]` are configured. For glossary terms and banned phrases, omitted `surfaces` means all rendered copy, including unresolved nodes; a present non-empty list limits the rule to nodes resolved to those surfaces.

A supported adapter with a valid query that finds nothing is a normal non-match. An unsupported adapter namespace or malformed adapter query emits an explicit non-failing configuration notice and never matches; it must not silently look like a valid query that found nothing.

Recommended authoring rules, not built-in defaults:

| Surface | High-confidence matcher examples |
|---|---|
| `button` | role `button`, or `web-dom` query `button` / `a.btn` |
| `error` | role `alert`, or `web-dom` query `[aria-live]` / `.error` |
| `marketing` | `web-dom` query `h1` / `h2` / `.hero` |
| `body` | explicit `web-dom` queries such as `main p` / `article p` |

Copy-style-backed criteria use `sourceStrength: "project-contract"` and can emit deterministic `risk` at most. They assert "this captured copy conflicts with your declared contract", not universal language quality.

### Text Contrast Coverage (`dom-contrast-risk`)

`dom-contrast-risk` composites both the foreground and the backdrop before computing a WCAG 2.x ratio. The
element's own `background-color` is layer zero, ancestors are walked until one carries no alpha component,
and the base is the UA canvas measured from a `color: Canvas` probe rather than a hardcoded white. Both
channels are composited: text at `rgba(255,255,255,0.25)` on a dark surface is a real failure, and scoring
it as opaque white would report roughly 16.8:1 and pass it. `oklch()`, `oklab()`, and `color(srgb …)` are
converted exactly; `rgb(r g b / a%)` never reaches the parser because Chromium normalises it first.

Only elements that render their **own** direct text are scored, so a wrapper and its child no longer report
the same text twice. This is not a leaf rule: in `<p style="color:#777">x <strong style="color:#fff">y
</strong></p>` both elements render text in their own colour and both are evaluated.

**What it does not measure.** When the painted backdrop cannot be determined from computed styles, the check
emits *no finding* and records the element in `contrastCoverage` on the measurement evidence, plus a
`contrast-elements-skipped` notice. A skipped element is not a passing element, and `evaluatedElementCount`
is what distinguishes "looked and found nothing" from "never looked". Skips are:

| Condition | Why it is not measurable here |
|---|---|
| `background-image` anywhere in the chain | A gradient or raster has no single colour; sampling only its stops is unsound in both directions. |
| `backdrop-filter` in the chain | The painted result depends on what is behind the element, which computed style does not expose. |
| Out-of-flow element whose chain never reaches an opaque layer | DOM ancestry does not describe what paints behind a fixed or portalled overlay. |
| `color(display-p3 …)`, `lab()`, `lch()`, or any unparsed value | A scope decision, not a limit of the evidence — these are convertible and simply are not yet. |
| Foreground `alpha: 0` | No glyph is painted, so there is nothing to contrast. |

Additionally, the check is **blind to `opacity`, `mix-blend-mode`, and `filter`** on ancestors: it neither
composites them nor skips for them, so a ratio under those properties is reported from the unblended
colours. That is a known recall hole, recorded here rather than hidden, and it is unchanged from earlier
versions.

### Target Size (`tap-target-risk`)

`tap-target-risk` maps to `a11y.target-size.minimum` (WCAG 2.2 SC 2.5.8, deterministic/risk). An
interactive target under 24×24 CSS pixels is flagged **unless** the Spacing exception applies.

The Spacing exception is implemented in its conjunctive form, matching the normative text ("the circles do
not intersect another target or the circle for another undersized target"): an undersized target is exempt
when its 24px-diameter circle — radius 12, centred on the bounding box — intersects neither the bounding
box of any other target (the rect test) nor the 24px circle of any other *undersized* target (the circle
test). Intersection is strict, so a tangent circle is exempt. Both tests are needed: the rect test alone
under-exempts two small targets whose circles overlap while their boxes are far, and the circle test alone
over-exempts a small target hugging a large one. The geometry runs over the full interactive set before any
sample cap, so a genuine violation cannot be pushed out of the window by exempt neighbours. Inline controls
(text-flow targets sized by their line) are exempt, unchanged from earlier versions.

**Not implemented, by decision.** The *User-agent control* exception ("size determined by the user agent
and not modified by the author") is undecidable from the DOM: cloning tag+type into the same parent reports
an author `width: 13px` as "unmodified" when it coincides with the UA's 13px, and reports an empty button's
content-derived 16×6 as UA-default. It is also unnecessary — the Spacing exception already exempts every
adequately spaced UA-sized control. The *Equivalent* and *Essential* exceptions ("a conforming alternative
exists elsewhere" / "this exact size is required") are author intent, not readable from the DOM. Each is a
documented recall hole, not a silent one.

### Font Family Contract

CLI users may pass one explicit `design-guide.yaml` to `audit --guide`. The CLI projects heading, body, then optional `audit.fontFamily.additionalAllowedFamilies` into the allowed union and carries optional `audit.fontFamily.ignoreSelectors` in `font-family-adherence-v1`; neither YAML nor the whole guide crosses into the capture package. Without `--guide`, this check performs no loading, capture, or reporting work.

`audit.fontFamily` is closed and must contain at least one of its two properties. `additionalAllowedFamilies` has 1–32 decoded `{ value, kind }` members; values are 1–128 trim-stable safe Unicode scalars and `kind` is `named` or `generic`. A generic member must use a supported CSS generic value. A named member may deliberately spell a generic keyword—for example `{ value: system-ui, kind: named }` permits computed `"system-ui"`, while `{ value: system-ui, kind: generic }` permits the unquoted generic. Heading/body and additional overlap is allowed and deduplicated by kind plus ASCII-folded value, preserving the first declared spelling.

`unapproved-font-family` maps to `visual.font-family.project-contract` and emits low-severity, high-confidence deterministic `project-contract` risks. It evaluates the computed `font-family` serialization for the existing visible-text candidate set, ignores configured third-party selector subtrees for this check only, and reports when any parsed family member falls outside the declared union. Results are grouped by raw stack and capped at five findings per viewport. Intentional runtime, mono, platform, or generated companion names belong in `additionalAllowedFamilies`; entries there expand audit verification only and do not become generation recommendations. Framework-style names such as `Pretendard Fallback` or Next-generated companions are examples to declare explicitly, never automatically trusted aliases.

The evidence proves only that a computed family list conflicts with the declared list. It does not identify which face rendered a glyph, enforce heading/body roles or stack order, diagnose fallback loading, or establish typography quality. The v1 identity distinguishes named and generic families, folds ASCII letters only, preserves all non-ASCII code points exactly, and deliberately performs no Unicode normalization or locale-aware matching. Selector-engine or computed-family processing errors become a scoped partial check while unrelated measurements and findings remain available.

#### Parser-Free Copy Audit

Library callers can pass a validated `CopyStyle` through `auditUrl({ copyStyle })`. CLI callers can pass the same contract with `--copy <copy-style.yaml>`; the validated object enters that existing `auditUrl({ copyStyle })` path rather than a separate analyzer. The capture adapter resolves surfaces on live nodes, then `@design-harness/copy-audit` analyzes the serialized text inventory without importing Playwright.

| Check | Contract | Result |
|---|---|---|
| `placeholder-leak` | Narrow Mustache variables, ICU complex arguments, and the operational TODO/Lorem markers in `docs/output-contract.md` | deterministic failure; finding cites only the matched syntax family source |
| `josa-hedge` | Exact `을(를)` / `이(가)` when `josaHedgePolicy` is `flag` or omitted | deterministic project-contract risk |
| `glossary-banned-term` | Case-sensitive NFC/whitespace-normalized literal substring on applicable surfaces | deterministic project-contract risk |
| `glossary-use-carefully-term` | Same literal semantics for configured use-carefully terms | deterministic project-contract risk |
| `banned-phrase` | Same literal semantics for configured banned phrases | deterministic project-contract risk |

Approved glossary entries do not emit findings. Lemma entries never fall back to literal matching; until morphology is enabled they emit a score-exempt capability notice. Unsupported surface adapter namespaces and malformed `web-dom` selectors likewise emit notices, never findings or partial-audit failures. `pnpm smoke:copy` verifies the live materializer, source-backed findings, notices, evidence references, and single-desktop score lock.

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

The parser-free Korean copy checks use `pnpm calibrate:fixtures` as a live drift gate. All six licensed manifest fixtures are served and audited, the five in-scope copy `checkName` values are summarized as TP/FP/FN in `runs/calibration/calibration-summary.json`, and any FP, FN, or incomplete audit fails the command. Findings from other check families are retained in the summary as out of scope rather than silently discarded or misclassified as copy false positives.

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
