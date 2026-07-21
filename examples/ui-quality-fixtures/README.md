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

These fixtures intentionally stay framework-free so checks can isolate DOM, style, viewport, and report behavior.

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
