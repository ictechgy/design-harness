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
    <viewport-name>.png
```

`audit.json` must validate against `packages/core/schemas/audit-result.schema.json`.

Current artifact `schemaVersion`: `0.2`.

`harnessVersion` follows the package version that produced the run.

## Finding Shape

The original finding fields remain valid:

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

Source-backed findings can also include:

- `criterionId`: stable source-backed criterion ID.
- `sourceRefs`: source IDs from the criterion registry.
- `determinism`: `deterministic`, `heuristic`, or `subjective`.
- `resultKind`: `failure`, `risk`, or `needs-review`.
- `runtime`: `static-dom`, `computed-style`, `viewport-sweep`, `interaction-simulation`, `human-review`, or `model-judged`.
- `observed`: measured value or sampled evidence.
- `expected`: threshold, pattern, or expected behavior.
- `humanReviewRecommended`: whether a human should review the finding before treating it as a fix requirement.

Reports group findings by determinism/result kind and include source-backed criteria when attached.

## Operational Placeholder Markers

The `placeholder-leak` check treats the following project-defined markers as failed rendered output. Findings for these markers cite `design-harness-output-contract`, not the ICU or Mustache syntax sources.

- `TODO`: exact uppercase text that is not immediately adjacent to a Unicode letter, number, or underscore. `TODO:` matches; lowercase `todo`, `TODOLIST`, and Unicode-letter-adjacent text do not.
- `Lorem ipsum`: case-insensitive `lorem`, followed by one or more Unicode whitespace characters, followed by `ipsum`, with no adjacent Unicode letter, number, or underscore. `lorem` alone does not match.

These are deliberately narrow operational markers. Neighboring placeholder-like prose is outside this contract.

## Notices

`audit.json` may include an optional `notices` array. Each notice has a non-blank `code` and `message`, with optional `viewport` and structured `details`. Notices describe configuration or capability limits; they are not findings, do not affect the advisory score or `failedChecks`, and do not change run status. An empty notice list is normally omitted.

## Evidence Assets

Common evidence assets:

- `screenshot`: captured viewport image path.
- `measurement`: browser measurement data for checks.
- `text-inventory`: page-wide rendered text inventory, capped per text-like field with `truncated: true` when shortened. A configured capture adapter may add `copySurface: { surface, ruleIndex, matcher }`; this resolved provenance is capture-neutral and optional.
- `aria-snapshot`: Playwright role/name snapshot, capped with `truncated: true` when shortened.

Missing optional semantic-tree evidence is skipped. It does not make an audit partial. A failed attempted evidence capture can still produce partial artifacts with a failure evidence record.

Password input values are blanked while ARIA snapshots are captured and restored afterward; plaintext password values must not be stored in DOM attributes or output artifacts.

## Advisory Score

`advisoryScore.formulaVersion` is required and currently equals `epistemic-weight-v1`.

The score starts at 100 and subtracts finding deductions by severity, confidence, and evidence tier:

- deterministic `failure`: `1.0`
- deterministic `risk`: `0.6`
- heuristic `risk`: `0.25`
- `needs-review`: `0`

Unclassified findings fall back to the heuristic-risk weight `0.25`; subjective unclassified findings are score-exempt. Scores produced before this formula are not directly comparable.

## Failure Behavior

- Invalid URL: exits non-zero and names the invalid URL.
- Browser unavailable: exits non-zero and recommends installing Chromium for Playwright with `npx playwright install chromium`, or `pnpm playwright:install` from a Design Harness checkout.
- Page timeout or navigation issue: writes partial artifacts with `status: "partial"` when possible and exits `2` unless `--allow-partial` is set.
- Schema validation failure: exits non-zero and identifies validation issues.

## Schema 0.2 Migration Notes

- `content` is a first-class rubric category for rendered language, terminology, interpolation, and copy-style findings.
- `sourceStrength` includes `project-contract`.
- `runtime` includes `model-judged`.
- `EvidenceAsset.type` includes `text-inventory` and `aria-snapshot`.
- `advisoryScore.formulaVersion` is required.
