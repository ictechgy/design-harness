# Midjourney Reference Lab Review Checklist

Use this checklist before committing any reference-derived manifest, fixture, or dataset record.

## Prompt Safety

- Prompt does not name real brands, trademarks, products, private companies, or proprietary design systems.
- Prompt does not ask for a living artist style or recognizable creator imitation.
- Prompt does not include private screenshots, customer data, internal tools, secrets, or personal information.
- Prompt does not rely on protected-class stereotypes or sensitive traits.
- Prompt asks for general UI archetypes and quality conditions, not exact copies.

## Generation Boundary

- Generation was manual.
- No scripts, bots, scrapers, browser automation, unofficial API wrappers, or Discord automation were used.
- Midjourney is not added as a package, service, test dependency, or runtime dependency.

## Asset Handling

- Generated image files are absent from the commit unless the asset-approved exception path is explicitly met.
- Local assets, if any, live under `datasets/midjourney-reference-lab/local-assets/`.
- Manifest paths are relative and do not expose `/Users/`, `/home/`, private CDN links, or account-specific URLs.
- `commitPolicy` is correct: `no-asset-commit`, `local-only`, or `asset-approved`.
- `rightsReview.status` is correct for the intended commit.

## Fixture Distillation

- Fixture is hand-authored HTML/CSS.
- Fixture does not copy pixels, composition, text, trademarks, or brand-specific structure from the reference.
- Fixture isolates a calibration target that the harness can evaluate or that humans can review.
- Good fixtures include "should not flag" notes.
- Bad fixtures include expected findings.

## Expected Findings

- Every expected finding has `claimType`.
- `deterministic` findings have `criterionId` and `sourceStrength: "official-testable"`.
- `heuristic-risk` findings are not described as objective pass/fail failures.
- `human-review` findings explain why judgment is contextual.
- `future-criterion` findings include a `futureCriterion` note.

## Learning Use

- `learningUse`, `allowedUse`, and `excludedUse` are explicit.
- Dataset wording says evaluator calibration or prompt/report tuning when that is the actual use.
- Any future fine-tuning or model training on generated assets is treated as a separate approval and research task.
