# Midjourney-Derived Fixtures

These fixtures are hand-authored examples distilled from generic reference observations. They do not copy generated images and do not require Midjourney to run.

## Fixture Pair

- `scanability-good.html`: dense operational dashboard with responsive layout, readable grouping, and adequate target size. It should not trigger overflow, target-size, or line-length risks.
- `scanability-bad.html`: dense operational dashboard stress case with fixed width, tiny actions, long rows, and overloaded hierarchy. It is expected to trigger responsive/readability risks and remain a human-review candidate for future density criteria.

## Expected Findings

See `examples/calibration-datasets/midjourney-reference-lab/manifest.example.jsonl`.

Important claim rules:

- deterministic findings require an existing official-testable `criterionId`,
- heuristic risks should stay risk language,
- subjective scanability judgments should stay `human-review` or `future-criterion`.
