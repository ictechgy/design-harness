# Midjourney Reference Lab Review Checklist

Use this checklist before committing any reference-derived manifest, fixture, or dataset record.

For project-guide decisions, also use
[`art-direction.md`](./art-direction.md) and the art-direction checks below.
That branch does not create a calibration manifest or expected finding.

## Prompt Safety

- Prompt does not name real brands, trademarks, products, private companies, or proprietary design systems.
- Prompt does not ask for a living artist style or recognizable creator imitation.
- Prompt does not include private screenshots, customer data, internal tools, secrets, or personal information.
- Prompt does not rely on protected-class stereotypes or sensitive traits.
- Prompt asks for general UI archetypes and quality conditions, not exact copies.

## Generation Boundary

- Generation was manual.
- No scripts, bots, scrapers, browser automation, unofficial API wrappers, or Discord automation were used to generate images or access the provider. The repo-local preparation helper may only inventory already-local opaque bytes.
- Midjourney is not added as a package, service, test dependency, or runtime dependency.

## Asset Handling

- Generated image files are absent from the commit unless the asset-approved exception path is explicitly met.
- Local assets, if any, live under `datasets/midjourney-reference-lab/local-assets/`.
- If `reference:session prepare` was used, `inventory.json` and `session.md`
  were created once under the same ignored session; `reference:session check`
  reported current bytes without modifying the worksheet or images.
- Manifest paths are relative and do not expose `/Users/`, `/home/`, private CDN links, or account-specific URLs.
- `commitPolicy` is correct: `no-asset-commit`, `local-only`, or `asset-approved`.
- `rightsReview.status` is correct for the intended commit.

## Fixture Distillation

- Fixture is hand-authored HTML/CSS.
- Fixture does not copy pixels, composition, text, trademarks, or brand-specific structure from the reference.
- Fixture isolates a calibration target that the harness can evaluate or that humans can review.
- Good fixtures include "should not flag" notes.
- Bad fixtures include expected findings.

## Art-direction decisions

- The local decision brief records the reference source, rights basis,
  confidentiality decision, target surface, constraints, and forbidden
  imitation targets before provider use.
- Public-by-default behavior is considered, and Stealth is not treated as an
  absolute confidentiality guarantee.
- Observed cues, candidate project choices, owner decisions, and rationale are
  separate fields; no raster cue is described as objective token extraction.
- Color roles, font stacks, spacing, radius, prohibitions, and the signature
  element fit the existing closed `design-guide.yaml` profile.
- Font family and license are selected separately rather than identified from
  a raster.
- Spacing and radius values are project-authored rather than recovered from
  pixels.
- Audit budgets come only from explicit project requirements or measured
  implementation evidence, never from a reference image.
- Only existing guide fields and prohibition IDs are used; the signature
  element is generalized rather than copied from a composition or brand.
- The guide and generated pack contain accepted decisions only. Prompts,
  model/version, provider settings, hashes, resource identifiers, asset paths,
  and rejected cues remain local.
- The generic dry-run is labeled non-authoritative: it proves guide
  compile/check compatibility, not real-project usefulness, accessibility, or
  design quality.
- The repo-local helper is described only as opaque-byte inventory and blank
  worksheet preparation. `guide from-references`, image analysis, OCR, VLM,
  provider/network automation, guide emission, audit interpretation, and
  public CLI packaging remain blocked.

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
