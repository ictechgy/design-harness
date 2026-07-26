# UI Quality Fixtures

Small pages used to calibrate source-backed criteria and report wording.

- `deterministic-failure.html`: operational render failure shape for "no meaningful content".
- `deterministic-risk.html`: measurable accessibility/layout risks such as low contrast and overflow.
- `heuristic-needs-review.html`: suggestive UX risks that should be review prompts instead of hard failures.
- `semantic-a11y-good.html`: semantic structure and labels that should avoid the semantic accessibility risks.
- `semantic-a11y-bad.html`: missing names, labels, alt text, heading order, landmark, and repeated-label risks.
- `responsive-readability-good.html`: responsive layout, readable measure, and adequate targets.
- `responsive-readability-bad.html`: fixed width, sticky obstruction, long lines, and small target risks.
- `interaction-state-good.html`: associated errors, live status, native controls, and controlled motion.
- `interaction-state-bad.html`: static signals for interaction-state risks.
- `font-family-adherence-good.html`: approved computed family lists only.
- `font-family-adherence-bad.html`: one isolated undeclared family member.
- `font-family-adherence-real-stack-good.html`: approved long platform/Korean, monospace, runtime-companion, and named/generic `system-ui` computed lists.
- `font-family-adherence-real-stack-bad.html`: a declared `Rogue` family plus one deliberately undeclared `Rogue Fallback` companion.
- `font-family-adherence-ignored.html`: one vendor mismatch under the configured selector exception plus an evaluated control.
- `font-family-adherence-errors.html`: query-selected hostile candidate, computed-value, and selector-evaluation boundaries for the live smoke.
- `color-adherence-good.html`: direct text, background, and painted-border slots use only colors projected from the guide.
- `color-adherence-bad.html`: the good fixture with only its right-border color changed to one off-palette value.
- `color-adherence-root-bad.html`: one off-palette document-element background proves root paint is included.
- `color-adherence-ignored.html`: off-palette vendor paint under the configured selector exception plus an evaluated control.
- `color-adherence-incomplete.html`: one unsupported `display-p3` background slot that must be skipped without fabricating a mismatch.
- `color-adherence-errors.html`: query-selected hostile candidate, computed-geometry, and selector-evaluation boundaries for the live smoke.
- `spacing-adherence-good.html`: declared px/rem values at a 17px root, implicit zero, keyword skips, a matched negative margin, fractional rem, resolved `calc()`, and fixed-container percentage padding without a spacing finding.
- `spacing-adherence-bad.html`: the good fixture with only its right padding changed to one off-scale rendered value.
- `spacing-adherence-ignored.html`: off-scale vendor spacing under the spacing-only selector exception plus an evaluated control.
- `spacing-adherence-incomplete.html`: one element with unavailable or throwing Typed OM keyword evidence; margin/gap slots are skipped while its padding remains evaluated.
- `spacing-adherence-errors.html`: query-selected 25,000-slot, root-font, and selector-evaluation boundaries for the live smoke.
- `visual-metrics-typography-good.html`: two direct-text owners share one computed typography tuple and stay within the fixture's explicit one-variant budget.
- `visual-metrics-typography-bad.html`: the same page changes only the heading size, producing a second tuple and one `typography-variant-count-budget` heuristic risk.
- `visual-metrics-palette-good.html`: text and background paint stay within the fixture's explicit distinct-color and chromatic-hue-family budgets.
- `visual-metrics-palette-bad.html`: the same page changes only one text color, exceeding the fixture's palette budgets and producing one `palette-count-discipline` heuristic risk.
- `visual-metrics-density-good.html`: two visible direct-text owners and their separate flow roots stay within the fixture's explicit high-side density budgets.
- `visual-metrics-density-bad.html`: the same page adds one paragraph, exceeding both fixture density components in one `density-complexity-budget` heuristic risk.
- `midjourney-derived/scanability-good.html`: hand-authored dense-dashboard scanability fixture.
- `midjourney-derived/scanability-bad.html`: hand-authored dense-dashboard scanability stress fixture.
- `midjourney-derived/state-and-color-good.html`: hand-authored checklist and color hierarchy fixture that should preserve clear state meaning.
- `midjourney-derived/state-and-color-bad.html`: hand-authored checklist and color hierarchy stress fixture for saturated color and state-visibility review prompts.

- `tap-target-good.html`: interactive controls spaced beyond the 24px Spacing exception; must stay silent.
- `tap-target-bad.html`: two cramped icons plus a wide-neighbour discriminator; three genuine violations.
- `clean-corpus-surface.html`: correct dark-theme translucent surfaces in legacy `rgba()`; must stay silent.
- `clean-corpus-surface-defective.html`: the same page with one genuinely sub-threshold translucent label.
- `clean-corpus-tokens.html`: correct dark theme authored in `oklch()` and `color-mix()`; must stay silent.
- `clean-corpus-tokens-defective.html`: the same page with one genuinely sub-threshold `oklch` label.
- `contrast-effects.html`: five-candidate ancestor-paint gate; two candidates are evaluated and opacity,
  blend, and filter each skip one opaque-child candidate.
- `contrast-effect-priority.html`: six-candidate skip-priority gate covering every browser-produced contrast
  reason exactly once.
- `finding-coverage-over-limit.html`: 25 exact semantic matches each for text clipping, low contrast, and
  non-exempt tap targets in both viewports; calibrates complete pre-cap counts against five emitted samples.

These fixtures intentionally stay framework-free so checks can isolate DOM, style, viewport, and report behavior.

The six `visual-metrics-*` pages are closed synthetic calibration pairs, not examples of universally correct counts. `visual-metrics-calibration.json` binds their hashes, frozen policy/method IDs, project-authored policies, exact complete measurements, and findings; it also includes the existing merchant dashboard as a configured complete all-metric non-regression case. `pnpm check:visual-metrics-calibration` validates that oracle and the exact recursively discovered unrelated-corpus inventory without a browser under `pnpm validate`.

After a workspace build and Chromium install, `pnpm smoke:visual-metrics` reproduces those seven complete cases and writes their `audit.json`, `metadata.json`, and `report.md` under `runs/visual-metrics/<case-id>/`. It also audits all 48 unrelated recursive HTML fixtures three times under `runs/visual-metrics/corpus/repeat-{1,2,3}/<entry-id>/` and pins both raw-fixture and portable metric-projection hashes. The `visual-metrics-corpus-portable-v1` committed projection includes the three new visual-metric summaries, findings, and notices but omits density text-fragment and edge-test diagnostic counts because host-font line wrapping changes them. Full audit evidence remains written, and the full projection including those diagnostics must repeat exactly three times within the same environment. Unrelated pre-existing findings/notices are allowed, while every audit must still return successful status and no failed checks. This broader corpus does not claim complete metric evidence for every page: `color-adherence-incomplete.html` intentionally retains the one reviewed lower-bound outcome—zero visual-metric risks and exactly one `palette-discipline-slots-skipped` notice with `unsupported-color: 1`. Any other visual-metric, portable-hash, or full repeated-run drift fails.

## Clean corpus scope rule

The four `clean-corpus-*` pages are a **false-positive gate for `dom-contrast-risk` only**. They exist to
prove the detector stays silent on correct modern styling, and their defective twins prove it has not been
disabled to achieve that silence.

They are therefore deliberately minimal on every other axis. Do not add `class` or `id` values matching
`status`/`error`/`success`/`warning`, `data-state` attributes, disabled controls, animation, or
`position: sticky` — a realistic dashboard trips `status-live-region-risk`, `disabled-without-explanation`,
`color-only-state-risk`, and the repeated-weight review prompts, each of which is a legitimate check and
none of which this corpus is arbitrating. Keep interactive targets ≥24px and well spaced so
`tap-target-risk` stays out of the picture.

If a page emits a finding from any third check, the correct response is to remove the trigger from the
fixture and record the observation in `.omx/ideas.md` — not to widen the corpus's purpose.

Every element under test has a hand-computed entry in `clean-corpus-expected.md`, written before the
detector was ever run against these pages. That document, not the tool's output, is the reference: an
emitted finding with no counterpart there is a tool bug, and a fixture edited until the tool goes quiet is
a mirror rather than a gate.
