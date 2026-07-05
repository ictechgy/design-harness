# Midjourney-Derived Fixtures

These fixtures are hand-authored examples distilled from generic reference observations. They do not copy generated images and do not require Midjourney to run.

## Fixture Pair

- `scanability-good.html`: dense operational dashboard with responsive layout, readable grouping, and adequate target size. It should not trigger overflow, target-size, or line-length risks.
- `scanability-bad.html`: dense operational dashboard stress case with fixed width, tiny actions, long rows, and repeated equal-weight modules. It is expected to trigger responsive, target-size, and hierarchy `needs-review` signals.
- `state-and-color-good.html`: checklist state fixture with one primary accent, consistent completed states, and a distinct current task.
- `state-and-color-bad.html`: checklist and color stress fixture with many saturated accents and inconsistent completed-state treatment.

## Expected Findings

See `examples/calibration-datasets/midjourney-reference-lab/manifest.example.jsonl`.

Important claim rules:

- deterministic findings require an existing official-testable `criterionId`,
- heuristic risks should stay risk language,
- subjective scanability judgments should stay `human-review` or `future-criterion`.
- repeated visual weight is measured from layout geometry, but still stays `needs-review` because priority hierarchy depends on product context.
- saturated color noise and checklist state visibility are measured from DOM/computed-style signals, but still stay `needs-review` because semantic color and state hierarchy depend on product context.
