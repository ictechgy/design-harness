# Fixture Catalog

Fixture pages live in `examples/ui-quality-fixtures`.

They are intentionally small, framework-free HTML pages used to calibrate deterministic checks and heuristic risks.

## Fixtures

- `deterministic-failure.html`: blank root content for render failure calibration.
- `deterministic-risk.html`: low contrast and wide content risks.
- `heuristic-needs-review.html`: repeated labels and long reading measure.
- `semantic-a11y-good.html`: good semantic structure and labels.
- `semantic-a11y-bad.html`: missing names, labels, alt text, heading order, landmark, and repeated label risks.
- `responsive-readability-good.html`: responsive layout, readable measure, and adequate targets.
- `responsive-readability-bad.html`: wide content, sticky obstruction, and long lines. (Its lone small button is spacing-exempt under WCAG 2.5.8, so it no longer emits a tap-target finding; `tap-target-bad.html` is the dedicated target-size fixture.)
- `interaction-state-good.html`: associated errors, live status, native controls, and controlled motion.
- `interaction-state-bad.html`: static signals for interaction-state risks.
- `midjourney-derived/scanability-good.html`: hand-authored dense-dashboard scanability fixture distilled from generic reference observations.
- `midjourney-derived/scanability-bad.html`: hand-authored dense-dashboard scanability stress fixture for responsive/readability risks.
- `korean-line-length-good.html`: Korean long-form text at a comfortable CJK measure (~40 chars/line); calibrates the CJK-aware line-length estimate against false positives.
- `korean-line-length-bad.html`: unconstrained full-width Korean paragraph; expects exactly one desktop `excessive-line-length` finding.
- `korean-line-break-good.html`: Korean body copy with `word-break: keep-all` plus `overflow-wrap: break-word`; must stay silent.
- `korean-line-break-bad.html`: the same copy with `word-break: break-all`; expects one `korean-line-break-risk` per Korean paragraph per viewport.
- `korean-status-good.html`: Korean "저장 중..." status with `role="status"`; must stay silent.
- `korean-status-bad.html`: Korean status text without live-region semantics; expects `status-live-region-risk` per viewport.
- `korean/copy-good.html`: synthetic improved Korean copy; expects zero parser-free copy findings under `josaHedgePolicy: allow`; its rendered `을(를)` line is the allow-policy control.
- `korean/copy-bad.html`: one synthetic defect for each parser-free copy criterion; the single-desktop copy smoke expects five findings and score 63.2.
- `korean/josa-good.html`: synthetic negative controls for the opt-in Kiwi particle detector, including correct forms and ambiguity/non-Hangul cases that must be skipped.
- `korean/josa-bad.html`: one synthetic mismatch for each supported pair (`은/는`, `이/가`, `을/를`, `과/와`).
- `page-lang-good.html`: html element declares `lang`; must stay silent.
- `page-lang-bad.html`: html element without a `lang` attribute; expects one `page-lang-missing` deterministic failure per viewport.
- `font-family-adherence-good.html`: every visible text candidate has only the guide's declared `Inter, sans-serif` list; records clean per-viewport summaries and no font finding.
- `font-family-adherence-bad.html`: one visible line adds an unapproved named family; expects one `unapproved-font-family` project-contract risk per viewport.
- `font-family-adherence-real-stack-good.html`: long platform/CJK, intentional mono, runtime companion, and named/generic `system-ui` stacks are declared through `design-guide.font-family-real-stack.yaml`; expects clean summaries and zero findings in both viewports.
- `font-family-adherence-real-stack-bad.html`: the same additional-only guide declares `Rogue` but omits `Rogue Fallback`; expects only the undeclared companion in one risk per viewport and proves there is no suffix magic.
- `font-family-adherence-ignored.html`: the same kind of mismatch is inside `.third-party-widget`; expects a non-zero ignored count and no font finding while an approved control remains evaluated.
- `color-adherence-good.html`: direct-text foregrounds, visible backgrounds, and the painted right border all use exact RGBA8 values projected from `design-guide.example.yaml`; transparent paint is ignored, while hidden, opacity-zero, non-painted, background-image, border-image fallback, and off-palette SVG paint stay out of violations; per-viewport summaries are complete and no color finding is expected.
- `color-adherence-bad.html`: the good fixture with only its right-border color changed from the approved `#1F61D1` to off-palette `#C026D3`; expects one `off-palette-color` project-contract risk per viewport.
- `color-adherence-root-bad.html`: the document element alone has an off-palette background while body content uses declared colors; expects one root-background risk per viewport.
- `color-adherence-ignored.html`: off-palette black text and border paint stay inside `.third-party-color-widget`, while an approved control remains evaluated; expects a non-zero ignored-slot count and no color finding.
- `color-adherence-incomplete.html`: an empty box supplies one `color(display-p3 1 0 0)` background slot; expects an unsupported-color skip notice, complete supported-slot analysis, and no fabricated color finding.
- `color-adherence-errors.html`: query-selected candidate-limit, root-geometry, and selector-evaluation failures; each expects only the color detector to become partial while unrelated measurements remain available.
- `spacing-adherence-good.html`: a globally reset page uses declared px/rem spacing at a 17px root, implicit zero, `auto` margin and `normal` gap skips, a matched negative margin, fractional rem padding, `calc(4px + 0px)`, and `4%` padding inside a fixed 100px containing block; expects both resolved values to land on the declared 4px member, exact accounting, three keyword skips, and no spacing finding.
- `spacing-adherence-bad.html`: the good fixture with only `#spacing-sample` right padding changed from the declared fractional value to `13px`; expects one `off-scale-spacing` project-contract risk per viewport.
- `spacing-adherence-ignored.html`: off-scale vendor margin, padding, and gap stay inside `.third-party-spacing-widget`, while an approved control remains evaluated; expects non-zero ignored-slot accounting and no spacing finding.
- `spacing-adherence-incomplete.html`: one element removes its `computedStyleMap` capability; its six margin/gap slots become explicit `typed-om-unavailable` skips while padding and the rest of the page remain evaluated.
- `spacing-adherence-errors.html`: query-selected 25,000-slot overflow, invalid root-font evidence, and selector-evaluation failures; each expects only the spacing detector to become partial while font, color, and base measurements remain available.
- `visual-metrics-typography-good.html`: two direct-text owners share one computed typography tuple under an explicit one-variant project budget; expects complete coverage and no typography-budget finding.
- `visual-metrics-typography-bad.html`: only the heading size changes, producing a second tuple; expects one low/low heuristic `typography-variant-count-budget` risk.
- `visual-metrics-palette-good.html`: rendered text/background paint stays within the fixture's explicit distinct-color and chromatic-hue-family budgets; expects complete coverage and no palette-budget finding.
- `visual-metrics-palette-bad.html`: only one text color changes, exceeding the explicit palette budgets; expects one low/low heuristic `palette-count-discipline` risk containing both overages.
- `visual-metrics-density-good.html`: two visible direct-text owners and two separate text-flow roots stay within the fixture's explicit high-side budgets; expects complete component coverage and no density finding.
- `visual-metrics-density-bad.html`: only one paragraph is added, exceeding both explicit density budgets; expects one low/low heuristic `density-complexity-budget` risk containing both overages.

The live example smoke audits the original three font fixtures with `examples/configs/design-guide.example.yaml` and the two real-stack fixtures with the additional-only `examples/configs/design-guide.font-family-real-stack.yaml`. It also pairs the basic good fixture with `examples/configs/design-guide.invalid-font-selector.yaml` and uses query-selected scenarios in `font-family-adherence-errors.html` to cover invalid syntax, hostile candidate volume, oversized computed serialization, and selector-evaluation failure. Each case proves that browser-level failure marks only `unapproved-font-family` partial, retains base measurements, and emits no finding from incomplete font evidence.

The same smoke audits the rendered-color fixtures with `examples/configs/design-guide.example.yaml`; the good/bad pair isolates exact palette comparison, the root case covers document-element paint, the ignored case exercises `.third-party-color-widget`, and the incomplete case preserves an explicit skip instead of treating unsupported color-space evidence as either allowed or mismatched. Pairing the good fixture with `examples/configs/design-guide.invalid-color-selector.yaml` proves browser-invalid selector syntax marks only `off-palette-color` partial while base measurements remain available. Query-selected scenarios in `color-adherence-errors.html` prove candidate overflow, root geometry failure, and selector evaluation also remain detector-scoped. Both invalid-selector guides and the font/color error-boundary fixtures are test-only; structural guide validation deliberately defers CSS syntax to the target browser.

Rendered-spacing smoke uses the same example guide and its separate `.third-party-spacing-widget` exception. The good/bad pair runs at a 17px root so live Chromium proves rem conversion and fractional serialization instead of repeating only the 16px unit vectors. `design-guide.invalid-spacing-selector.yaml` proves browser-invalid selector syntax is a detector-scoped partial. The error fixture proves the bounded 25,000-slot ceiling, missing root-font evidence, and selector evaluation do not erase successful font/color or base measurements. The example guide adds `4px`, `0.333333rem`, `2rem`, and `1.34rem` spacing values: the first two drive the dedicated vectors, while `2rem` and `1.34rem` retain clean legacy guide-backed fixtures whose rendered body padding and user-agent heading flow are 32px and 21.44px at the default root. The real-stack guide adds only those latter two compatibility values.

Visual-metric calibration is separate from the broad example smoke. `examples/ui-quality-fixtures/visual-metrics-calibration.json` is the closed oracle for the six synthetic atomic pages, one configured merchant-dashboard non-regression case, and every unrelated HTML fixture found recursively under this directory. It records frozen IDs, project policies, exact atomic/merchant measurements and findings, and pinned fixture/projection hashes. `pnpm check:visual-metrics-calibration` verifies exact keys, provenance, hashes, three good/bad pairs, merchant coverage, and the complete 52-fixture unrelated inventory without Chromium as part of `pnpm validate`.

`pnpm smoke:visual-metrics` requires complete evidence with no metric partial notices or failed checks for the six atomic fixtures and merchant case in the browser-equipped `example-smoke` CI job, then audits all 52 unrelated fixtures three times. Atomic/merchant expectations retain their full exact measurement projections. Unrelated entries use the manifest's `visual-metrics-corpus-portable-v1` committed hash: the three visual-metric summaries, findings, and notices remain present except for density text-fragment and edge-test diagnostic counts, whose values legitimately vary with the host font environment. Full audit evidence is still written, and the complete projection including both diagnostics must be byte-repeatable across the three runs within each environment. Unrelated existing findings/notices are allowed, but every audit must still return successful status and an empty `failedChecks`. The gate is intentionally not an assertion that all unrelated metric evidence is complete. `color-adherence-incomplete.html` is the sole reviewed visual-metric lower-bound case: it must keep zero visual-metric risks and exactly one `palette-discipline-slots-skipped` notice with `unsupported-color: 1`; every other visual-metric notice or risk, coverage/status or failed-check change, portable-hash mismatch, or full repeated-run drift fails. Atomic/merchant artifacts live under `runs/visual-metrics/<case-id>/`, corpus artifacts under `runs/visual-metrics/corpus/repeat-{1,2,3}/<entry-id>/`, and CI uploads the root. The project budgets in this oracle calibrate implementation drift only; they are not defaults or recommendations.

## Fixture Policy

- Add at least one good and one bad fixture for each new check family, including heuristic-risk checks.
- Keep fixtures plain HTML/CSS unless the check requires framework behavior.
- Prefer obvious, isolated failures over realistic but ambiguous pages.
- Do not copy proprietary product UI.
- Use fixtures to calibrate false positives as much as true positives.

## Reference-Derived Fixtures

Reference-derived fixtures must be hand-authored and reproducible without the reference generator. Generated images are not fixture source files.

See [Midjourney Reference Lab Workflow](midjourney-reference-lab/workflow.md) for the manual reference workflow, manifest policy, local asset policy, and review checklist.

## Calibration Datasets And Licenses (Korean copy work)

Fixture and calibration data for the copy-audit checks is license-tiered. Getting this wrong contaminates the Apache-2.0 repository.

Redistributable — may be committed:

- Synthetic josa gold suites (the batchim rule is phonological, so exhaustive generation is cheap and license-clean).
- IWSLT2023 EN-KO formality test data (CDLA-Sharing-1.0) for politeness-register calibration.
- Hand-authored Korean fixtures (`korean/copy-good.html`, `korean/copy-bad.html`), reviewed by a native speaker.

Internal calibration only — NEVER commit fixtures derived from these:

- NIKL corpora from 모두의 말뭉치 (application-gated; no redistribution; no LLM augmentation).
- 국립국어원 말평 task data (same restrictions).
- Smilegate SmileStyle (CC-BY-NC-4.0).
- K-NCT (repository has no license — ask the authors before any use beyond reading).

When in doubt, generate synthetic Korean data instead. Every copy criterion should carry at least one bad → improved example pair with a reason.

Every committed Korean fixture is listed in `examples/calibration-datasets/korean-copy/manifest.jsonl`. Each record partitions the calibrated copy checks between counted `expectedFindings` and registry-backed `shouldNotFlag.registeredCheckNames`; not-yet-implemented controls live separately under declared `futureCriteria`, and `josaHedgePolicy` records the fixture's explicit contract. `pnpm validate:korean-copy` verifies those expectations together with provenance, redistribution status, file existence, uniqueness, and complete fixture coverage.

After a workspace build and Chromium install, `pnpm calibrate:fixtures` serves and audits every manifest record at one desktop viewport. The parser-free checks run normally; `josa-batchim-mismatch` uses a deterministic injected token fixture so CI does not need licensed or external model assets. The runner scores the explicit calibrated-check registry, records other audit findings as out of scope, writes stable per-check TP/FP/FN data to `runs/calibration/calibration-summary.json`, and exits non-zero on any copy-check drift, incomplete audit, or model-fixture provenance leak.
