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

## Bounded Loop Artifacts

The bounded loop is published starting with v0.6.1. Its exact invocation shape is:

```bash
design-harness loop \
  --url <local-http-url> \
  --out <new-directory> \
  --until deterministic-failures==0 \
  --max-iters 3 \
  --agent-cmd '<non-interactive command>' \
  [--agent-timeout-ms <bounded-ms>] \
  [audit configuration flags]
```

Only `deterministic-failures==0` is accepted. The output root must be fresh and is claimed exclusively after non-filesystem preflight. The baseline is always audit `000`; `--max-iters N` permits no more than N commands and N+1 audits. A partial audit stops with exit `2` before a zero count or progress comparison is evaluated and before any later command is launched.

```text
<out>/
  loop-summary.json
  iterations/
    000-baseline/
      metadata.json
      audit.json
      report.md
      report-manifest.json
      screenshots/
    001/
      ...
```

`loop-summary.json` has `schemaVersion: "design-harness-loop-summary/v1"`. It is a CLI-local contract, separate from audit schema `0.2`, and records:

- `harnessVersion`, `loopRunId`, and normalized `target`;
- the exact `condition` and `budget`;
- `status` and its matching `exitCode`;
- `commandSha256`, never the command text;
- root-relative paths under `artifacts`;
- ordered `audits` with run/status, deterministic-failure count, `failure-progress-v1` fingerprint, and relative artifact paths; and
- ordered `agents` with duration, configured timeout, raw exit code, and signal.

Invalid input or preflight failure exits `1` before a loop root or summary necessarily exists. Once the root is claimed, terminal summary statuses map as follows: `already-clean` or `converged` → `0`; `audit-error`, `agent-error`, `agent-timeout`, or `summary-error` → `1`; `partial` → `2`; and `no-progress` or `max-iters` → `3`. The implementation writes a unique temporary sibling, flushes/closes where supported, and renames it within the loop root so readers do not observe a partially written summary.

The `failure-progress-v1` value is SHA-256 over the sorted multiset of `[criterionId ?? "", checkName, viewport, selector ?? ""]` tuples for deterministic failures only. Finding IDs, input order, evidence references, recommendations, geometry, advisory scores, deterministic risks, heuristic findings, and `needs-review` findings do not affect progress.

The summary must not contain raw command text, stdout, stderr, report/page contents, stack traces, environment values, credentials, or the fixed stdin message. Agent output is streamed rather than stored. The process inherits the caller environment after clearing the reserved `DESIGN_HARNESS_LOOP_*` prefix, then receives exactly six fixed evidence variables under that prefix; fixed harness-authored stdin labels the audit/report/page evidence as untrusted. See [Agent Loop Recipes](recipes/agent-loop.md) for the exact names and process termination contract.

The command runs as arbitrary shell code with caller permissions and inherited credentials. There is no sandbox or network boundary. POSIX timeout cleanup targets a process group; Windows direct-child cleanup is best effort and may leave descendants. Reaching the loop condition covers only recorded deterministic failures and is not a completeness, conformance, or overall-quality guarantee.

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

`contrast-elements-skipped` is one count-neutral audit-level notice with no top-level viewport. Its
`details.viewports[]` entries are sorted by viewport and record `{ viewport, skippedElementCount,
skippedByReason }`. The canonical complete counts remain in each measurement asset's `contrastCoverage`.

### Bounded finding samples

Measurement evidence may include `findingCoverage: { viewport, entries }` for the capped visual detectors.
When present, it is an exact 20-check inventory. Each entry records the semantic `detectedCount` before the
first browser or Node sample cap, the actual materialized `emittedCount`, their difference as
`omittedCount`, and the materializer `limit`. `empty-heading`, `heading-level-skip`, and `duplicate-h1`
add `capGroup: "headingIssues"` because they share one five-finding bound. Their counts remain separate by
check name.

If any count is omitted, the audit emits exactly one `finding-samples-truncated` notice. It has no top-level
viewport; `details.viewports[]` is sorted by viewport and contains `{ viewport, checks }`, where `checks`
contains only omitted entries in stable check-name order. The complete per-viewport inventory remains in
measurement evidence. This diagnostic does not change findings, advisory score, status, or `failedChecks`.
Artifacts without `findingCoverage` remain valid.

Font-family adherence retains its existing total/emitted/truncated summary and is not duplicated here. The
semantic aggregate checks for repeated visual weight, saturated colour noise, and checklist-state visibility
also have no generic coverage entries because their current algorithms cannot reach their nominal
materializer caps. Text-field shortening, ARIA snapshot shortening, and layout-metric sampling are payload
bounds rather than omitted findings.

## Evidence Assets

Common evidence assets:

- `screenshot`: captured viewport image path.
- `measurement`: browser measurement data for checks.
- `text-inventory`: page-wide rendered text inventory, capped per text-like field with `truncated: true` when shortened. A configured capture adapter may add `copySurface: { surface, ruleIndex, matcher }`; this resolved provenance is capture-neutral and optional.
- `aria-snapshot`: Playwright role/name snapshot, capped with `truncated: true` when shortened.

Missing optional semantic-tree evidence is skipped. It does not make an audit partial. A failed attempted evidence capture can still produce partial artifacts with a failure evidence record.

Password input values are blanked while ARIA snapshots are captured and restored afterward; plaintext password values must not be stored in DOM attributes or output artifacts.

## Advisory Score

`advisoryScore.formulaVersion` is required. Current producers emit
`epistemic-criterion-max-v2`; the schema also accepts historical `epistemic-weight-v1` scores without
rewriting them.

For v2, each scoreable finding first receives a rounded base deduction from severity points, confidence,
and evidence-tier weight:

- deterministic `failure`: `1.0`
- deterministic `risk`: `0.6`
- heuristic `risk`: `0.25`
- `needs-review`: `0`

Findings are then grouped in distinct criterion and legacy-check namespaces: registry-backed findings use
`criterionId`, while legacy findings use `checkName`. Equal text in those two namespaces remains two groups. A group deducts
only its maximum base value, so repeated occurrences and viewports remain visible without multiplying that
criterion's score influence. Equal maxima select the smallest finding ID by locale-independent UTF-16
code-unit order. Deductions are sorted by the same order on group key, with criterion before legacy check
when the text keys are equal, and expose the representative
`findingId`, complete sorted `findingIds`, and unique sorted `viewports`. `needs-review`, subjective, and
other zero-weight findings are omitted from deduction membership.

`totalDeduction` is the rounded grouped total before the zero floor. `saturated` is true only when that total
is greater than 100; an exact total of 100 therefore has `value: 0` and `saturated: false`. The displayed
value is `max(0, round(100 - totalDeduction))`; score bands are unchanged.

The audit-result schema is a closed, formula-discriminated union. V1 rejects v2-only score and deduction
fields. V2 requires `totalDeduction`, `saturated`, and each deduction's `findingIds` and `viewports`. Unknown
formula versions fail validation. Unclassified scoreable findings retain the heuristic-risk fallback weight
`0.25`; subjective unclassified findings are score-exempt. V1 and v2 values are not directly comparable.

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
- `advisoryScore.formulaVersion` is required; historical v1 and criterion-bounded v2 score shapes are
  formula-discriminated while `schemaVersion` remains `0.2`.
