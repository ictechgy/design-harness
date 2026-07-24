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
- `korean-status-good.html`: Korean "저장 중..." status with `role="status"`; must stay silent.
- `korean-status-bad.html`: Korean status text without live-region semantics; expects `status-live-region-risk` per viewport.
- `korean/copy-good.html`: synthetic improved Korean copy; expects zero parser-free copy findings under `josaHedgePolicy: allow`; its rendered `을(를)` line is the allow-policy control.
- `korean/copy-bad.html`: one synthetic defect for each parser-free copy criterion; the single-desktop copy smoke expects five findings and score 63.2.
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

The live example smoke audits the original three font fixtures with `examples/configs/design-guide.example.yaml` and the two real-stack fixtures with the additional-only `examples/configs/design-guide.font-family-real-stack.yaml`. It also pairs the basic good fixture with `examples/configs/design-guide.invalid-font-selector.yaml` and uses query-selected scenarios in `font-family-adherence-errors.html` to cover invalid syntax, hostile candidate volume, oversized computed serialization, and selector-evaluation failure. Each case proves that browser-level failure marks only `unapproved-font-family` partial, retains base measurements, and emits no finding from incomplete font evidence.

The same smoke audits the rendered-color fixtures with `examples/configs/design-guide.example.yaml`; the good/bad pair isolates exact palette comparison, the root case covers document-element paint, the ignored case exercises `.third-party-color-widget`, and the incomplete case preserves an explicit skip instead of treating unsupported color-space evidence as either allowed or mismatched. Pairing the good fixture with `examples/configs/design-guide.invalid-color-selector.yaml` proves browser-invalid selector syntax marks only `off-palette-color` partial while base measurements remain available. Query-selected scenarios in `color-adherence-errors.html` prove candidate overflow, root geometry failure, and selector evaluation also remain detector-scoped. Both invalid-selector guides and the font/color error-boundary fixtures are test-only; structural guide validation deliberately defers CSS syntax to the target browser.

## Fixture Policy

- Add at least one good and one bad fixture for each new deterministic check family.
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

Every committed Korean fixture is listed in `examples/calibration-datasets/korean-copy/manifest.jsonl`. Each v2 record partitions the five parser-free copy checks between counted `expectedFindings` and registry-backed `shouldNotFlag.registeredCheckNames`; not-yet-implemented controls live separately under declared `futureCriteria`, and `josaHedgePolicy` records the fixture's explicit contract. `pnpm validate:korean-copy` verifies those expectations together with provenance, redistribution status, file existence, uniqueness, and complete fixture coverage.

After a workspace build and Chromium install, `pnpm calibrate:fixtures` serves and audits all six records at one desktop viewport. It scores only the five parser-free copy checks, records other audit findings as out of scope, writes stable per-check TP/FP/FN data to `runs/calibration/calibration-summary.json`, and exits non-zero on any copy-check drift.
