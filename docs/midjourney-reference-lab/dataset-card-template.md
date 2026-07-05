# Midjourney Reference Lab Dataset Card Template

Use this template for a reference batch or curated calibration subset.

## Dataset Card

Name:

Schema version:

Created:

Owner:

Purpose:

Allowed use:

- evaluator calibration:
- prompt tuning:
- report wording calibration:
- benchmark:
- fine-tune candidate:

Excluded use:

- runtime dependency:
- automated Midjourney generation:
- brand imitation:
- model training without separate approval:

Source summary:

- Generated references are manual Midjourney outputs.
- Public repo artifacts are manifests, descriptions, labels, and hand-authored fixtures.
- Generated image assets remain local/ignored unless explicitly approved.

UI archetypes:

- TBD

Quality targets:

- good:
- bad:
- ambiguous:
- edge-case:

Rights review:

- status:
- reviewer:
- notes:

Fixture links:

- TBD

Expected finding policy:

- Deterministic findings require existing official-testable criteria.
- Heuristic findings must be phrased as risks.
- Subjective items must be `human-review`.
- Missing measurement support must be `future-criterion`.

Known limitations:

- TBD

Verification:

```bash
pnpm validate:midjourney-lab
```
