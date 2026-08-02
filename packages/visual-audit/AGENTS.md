# Visual-audit package instructions

Applies to `packages/visual-audit/`. Root `AGENTS.md` remains authoritative.

## Responsibility and boundaries

Visual-audit owns Playwright capture, browser measurements, evidence assets,
and mapping measurements into core findings. It may consume core/copy-audit; it
must not parse YAML or import CLI.

- Keep browser reads in the established bounded `page.evaluate` measurement
  closure. Capture evidence once and derive findings outside the page.
- Evidence is layered and provenance-bearing. Missing or partial layers produce
  skip/notice or conservative lower bounds, never fabricated completeness.
- A selector identifies one element. Never let one selector stand in for
  several nodes; preserve bounded samples and cardinality.
- Heuristic visual metrics remain `risk` even when counts are exact. Do not turn
  palette, density, symmetry, harmony, or balance measurements into objective
  design grades.
- Screen-reader-only/offscreen boxes and unsupported CSS values need explicit
  handling, not generic spacing/color findings.

## Adding or changing a detector

Change the core criterion/source, measurement type, browser evidence,
`findingsFromMeasurements`, one-defect good/bad fixtures, and tests together.
Serve and audit both fixtures: bad must trigger the intended finding; good must
stay silent. Check report copy and coverage, not only the raw measurement.

## Verification

```bash
pnpm --filter @design-harness/visual-audit typecheck
pnpm --filter @design-harness/visual-audit test
pnpm smoke:visual-metrics
pnpm smoke:selector-uniqueness
pnpm smoke:spacing-skip
CI=true pnpm release:check
```

If Playwright Chromium is absent, use the documented `pnpm playwright:install`;
do not silently skip live evidence.
