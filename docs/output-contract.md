# Output Contract

The local CLI command:

```bash
design-harness audit --url <local-url> --out runs/<timestamp>
```

Writes:

```text
runs/<timestamp>/
  metadata.json
  audit.json
  report.md
  report-manifest.json
  screenshots/
    desktop.png
    mobile.png
```

`audit.json` must validate against `packages/core/schemas/audit-result.schema.json`.

## Finding Shape

The original v0.1 finding fields remain valid:

- `id`
- `category`
- `severity`
- `confidence`
- `viewport`
- `selector`
- `region`
- `evidenceRefs`
- `problem`
- `recommendation`
- `checkName`

Source-backed findings introduced in v0.2 and used by v0.3 can also include:

- `criterionId`: stable source-backed criterion ID.
- `sourceRefs`: source IDs from the criterion registry.
- `determinism`: `deterministic`, `heuristic`, or `subjective`.
- `resultKind`: `failure`, `risk`, or `needs-review`.
- `runtime`: `static-dom`, `computed-style`, `viewport-sweep`, `interaction-simulation`, or `human-review`.
- `observed`: measured value or sampled evidence.
- `expected`: threshold, pattern, or expected behavior.
- `humanReviewRecommended`: whether a human should review the finding before treating it as a fix requirement.

Reports group findings by determinism/result kind and include source-backed criteria when attached.

## Failure Behavior

- Invalid URL: exits non-zero and names the invalid URL.
- Browser unavailable: exits non-zero and recommends installing Chromium for Playwright with `npx playwright install chromium`, or `pnpm playwright:install` from a Design Harness checkout.
- Page timeout or navigation issue: writes partial artifacts with `status: "partial"` when possible and exits `2` unless `--allow-partial` is set.
- Schema validation failure: exits non-zero and identifies validation issues.
