# Midjourney Reference Lab Calibration Dataset

This directory contains public, reproducible calibration records for reference-derived fixtures.

It does not contain generated Midjourney images. Generated references are local-only by default and should live under the ignored path:

```text
datasets/midjourney-reference-lab/local-assets/
```

## Files

- `schema.json`: JSON schema for manifest records.
- `manifest.example.jsonl`: example JSONL records.
- `validate-manifest.mjs`: dependency-free validator for the example format.

Some records may use `commitPolicy: "local-only"` and point to ignored reference images under `datasets/midjourney-reference-lab/local-assets/`. Those references are private calibration aids; the public repo remains reproducible from the manifest, review notes, and hand-authored fixtures.

## Validate

```bash
pnpm validate:midjourney-lab
```

or directly:

```bash
node examples/calibration-datasets/midjourney-reference-lab/validate-manifest.mjs examples/calibration-datasets/midjourney-reference-lab/manifest.example.jsonl
```

## Rules

- Do not commit generated image assets here.
- Do not use absolute local paths or private CDN URLs in manifest examples.
- Use `commitPolicy: "local-only"` when a private local reference exists but should not be committed.
- Use `commitPolicy: "asset-approved"` only after explicit maintainer/legal approval.
- Use `future-criterion` or `human-review` when current Design Harness checks cannot observe the condition.
