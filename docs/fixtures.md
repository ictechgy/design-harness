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
- `responsive-readability-bad.html`: wide content, sticky obstruction, long lines, and small target risks.
- `interaction-state-good.html`: associated errors, live status, native controls, and controlled motion.
- `interaction-state-bad.html`: static signals for interaction-state risks.
- `midjourney-derived/scanability-good.html`: hand-authored dense-dashboard scanability fixture distilled from generic reference observations.
- `midjourney-derived/scanability-bad.html`: hand-authored dense-dashboard scanability stress fixture for responsive/readability risks.

## Fixture Policy

- Add at least one good and one bad fixture for each new deterministic check family.
- Keep fixtures plain HTML/CSS unless the check requires framework behavior.
- Prefer obvious, isolated failures over realistic but ambiguous pages.
- Do not copy proprietary product UI.
- Use fixtures to calibrate false positives as much as true positives.

## Reference-Derived Fixtures

Reference-derived fixtures must be hand-authored and reproducible without the reference generator. Generated images are not fixture source files.

See [Midjourney Reference Lab Workflow](midjourney-reference-lab/workflow.md) for the manual reference workflow, manifest policy, local asset policy, and review checklist.
