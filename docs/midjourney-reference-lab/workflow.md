# Midjourney Reference Lab Workflow

Midjourney Reference Lab is a manual calibration workflow for Design Harness. It uses Midjourney references to inspire broader UI examples, then commits only reproducible derived artifacts: prompts, manifests, labels, hand-authored fixtures, expected findings, and review notes.

This is not a product integration. Design Harness must not call Midjourney, automate Midjourney, require a Midjourney account, or depend on generated assets at runtime.

## Architecture

Public repo artifacts:

- workflow docs and prompt templates,
- JSONL manifest records,
- schema and validator,
- hand-authored HTML/CSS fixtures,
- expected findings and "should not flag" notes,
- learning-use labels for future evaluator calibration.

Private local companion artifacts:

- generated reference images under `datasets/midjourney-reference-lab/local-assets/`,
- optional local reference notes,
- optional local hashes that connect a private asset to a committed `batchId`.

The committed repository must remain complete without private local assets.

## Manual Flow

1. Pick a calibration target, such as dense dashboard scanability, mobile checkout clarity, empty-state hierarchy, or ambiguous interaction affordance.
2. Draft a safe prompt from `prompt-catalog.md`.
3. Generate references manually in Midjourney. Do not use scripts, bots, scrapers, or browser automation.
4. Save generated images only in the ignored local asset path if you need to keep them:
   `datasets/midjourney-reference-lab/local-assets/`.
5. Fill a manifest record in `examples/calibration-datasets/midjourney-reference-lab/manifest.example.jsonl` format.
6. Review the prompt and output with `review-checklist.md`.
7. Distill general observations into a hand-authored fixture. Do not copy pixels, brand names, private UI, or a generated image layout exactly.
8. Map expected findings to existing `criterionId` values when possible.
9. Mark subjective or future-facing observations as `human-review` or `future-criterion`; do not convert taste into deterministic failures.
10. Run the validator and repo verification commands.

## Reference To Fixture Rule

References are inspiration, not source. A committed fixture should express a general UI condition:

- "dense card grid with stable grouping and readable targets" is acceptable,
- "copy this generated screenshot" is not acceptable,
- "make this look like a specific product or brand" is not acceptable.

## Expected Finding Rules

Each expected finding should include `claimType`.

- `deterministic`: requires a `criterionId` tied to an official-testable source strength.
- `heuristic-risk`: use for observable risks that need review or lower confidence.
- `human-review`: use for subjective or contextual judgments.
- `future-criterion`: use when the harness does not yet have a criterion or measurement.

## Asset Policy

Generated images are local-only by default. Do not commit generated Midjourney assets unless the asset-approved exception path is explicitly followed.

Asset-approved exception requirements:

- maintainer/legal approval is visible in the PR or review note,
- manifest has `commitPolicy: "asset-approved"`,
- manifest has `rightsReview.status: "approved"`,
- asset lives outside `local-assets/` in a dedicated approved-assets path,
- manifest records prompt intent, source prompt hash, allowed use, excluded use, and why a derived fixture or text description is insufficient,
- the repo has a fallback so normal operation does not require the asset.

## Verification

```bash
pnpm validate:midjourney-lab
pnpm build
pnpm typecheck
pnpm test
pnpm validate
```

Run `pnpm smoke:example` when runnable examples or fixture behavior change.

Static policy checks:

```bash
rg -n "MIDJOURNEY_API_KEY|discord.*token|midjourney.*api|api.*midjourney|generate.*midjourney|browser.*midjourney|midjourney.*browser" package.json pnpm-lock.yaml packages scripts .github examples --glob "!examples/calibration-datasets/midjourney-reference-lab/**" --glob "!examples/ui-quality-fixtures/midjourney-derived/**"
rg -n "datasets/midjourney-reference-lab/local-assets" .gitignore
rg -n "midjourney.*api|api.*midjourney|discord.*bot|bot.*discord|browser.*midjourney|midjourney.*browser" package.json pnpm-lock.yaml packages/*/package.json scripts .github
git ls-files "datasets/midjourney-reference-lab/local-assets/**"
git ls-files "examples/calibration-datasets/midjourney-reference-lab/*.png" "examples/calibration-datasets/midjourney-reference-lab/*.jpg" "examples/calibration-datasets/midjourney-reference-lab/*.jpeg" "examples/calibration-datasets/midjourney-reference-lab/*.webp" "examples/calibration-datasets/midjourney-reference-lab/*.gif"
rg -n "/Users/|/home/|cdn\\.discordapp|media\\.discordapp|cdn\\.midjourney" examples/calibration-datasets
```
