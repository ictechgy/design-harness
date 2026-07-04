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

These fixtures intentionally stay framework-free so checks can isolate DOM, style, viewport, and report behavior.
