# @design-harness/cli

Command-line entry point for Design Harness.

## Audit

```bash
design-harness audit --url http://localhost:3000 --out runs/demo
```

The CLI captures desktop and mobile screenshots, writes `audit.json`, renders `report.md`, and includes an iteration prompt scaffold for AI coding agents.

Parser-free rendered-copy checks are explicit opt-in through a local, schema-validated YAML file:

```bash
design-harness audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --copy ./copy-style.yaml
```

Without `--copy`, the CLI does not discover a config or run copy analysis. The supported parser-free checks are `placeholder-leak`, `josa-hedge`, `glossary-banned-term`, `glossary-use-carefully-term`, and `banned-phrase`. Register, spelling, and model-judged checks are not enabled.

Korean particle morphology is a second explicit opt-in layered on `--copy`:

```bash
design-harness audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --copy ./copy-style.ko.yaml \
  --kiwi-model-dir /absolute/path/to/kiwi-0.23.0-cong
```

`--kiwi-model-dir` is accepted only with a copy style whose locale is exactly `ko` or `ko-KR`. The same option is available on `loop` and is prepared once, then forwarded unchanged to every audit iteration. No flag means no Kiwi preparation, loading, worker, finding, notice, or provenance.

The model path is local and offline. Design Harness never downloads or discovers model assets. Before Chromium or output creation, it requires a directory containing exactly five non-symlink regular files from the Kiwi `0.23.0` `cong` core profile:

| File | Bytes | SHA-256 |
|---|---:|---|
| `combiningRule.txt` | 3,584 | `3d864f76eade67b250d37f4ee83de848b04fb14d0cd6ed36c36d0b210ad38ebc` |
| `cong.mdl` | 75,667,563 | `bd9ca89ee1b72e750c8e2166a17c80a0fe3fabd828c78b1f0928486a6b1833a7` |
| `extract.mdl` | 17,370 | `a0c92ffc051e43ae497845cdb8d4c8b9e2f359893cb55c67279c76d1d531ee17` |
| `nounchr.mdl` | 9,734,234 | `4b687e36836dd60dcb7addcfcf369ac082b339bab76549574ac1ce2b7ccd6836` |
| `sj.morph` | 8,462,892 | `5e3dab2def6d2cc079e21d5477bd610a391c69045d08caf1e0bbeabda8db8d1b` |

After browser capture closes, one isolated worker re-verifies those files, initializes exact `kiwi-nlp@0.23.0` with the `cong` model and optional dictionaries/typo correction disabled, analyzes the complete rendered-copy batch, and terminates before audit return or the next loop pass. Input sizes and startup, analysis, and shutdown times are bounded. A morphology runtime error emits one non-failing notice, adds no morphology provenance, and never changes an audit to partial.

The initial `josa-batchim-mismatch` detector checks only `은/는`, `이/가`, `을/를`, and `과/와`. It requires exact raw offsets, a Kiwi `J*` token, exactly one adjacent noun interpretation, and a precomposed Hangul final syllable. Ambiguous, digit-, Latin-, symbol-, and non-noun cases are skipped. Findings are low-confidence heuristic risks with human review recommended, never deterministic failures.

Kiwi's model initialization is memory-intensive. A macOS Node 22 probe reached about 726 MiB RSS; measure the actual target environment before enabling it in CI or a long-running service. `kiwi-nlp` is lazy-loaded only for this explicit path and is not part of parser-free execution.

Maintainers can verify an already prepared profile offline, without browser
capture or asset download, after building the workspace:

```bash
pnpm smoke:kiwi-real-model -- --model-dir /absolute/path/to/kiwi-0.23.0-cong
```

The command runs the strict positive/negative control batch three times with a
fresh worker per run and requires byte-identical normalized results.

Guide adherence is a separate explicit opt-in through the same strictly validated project guide used by guide compile/check:

```bash
design-harness audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --guide ./design-guide.yaml
```

`--guide` performs no discovery and may be combined with `--copy`. Every valid guide projects three independent project-contract policies: computed `font-family` lists on visible text candidates; supported computed sRGB paint against exact RGBA8 values projected from `tokens.color.semantic`; and rendered computed CSS-pixel membership for four margin sides, four padding sides, and row/column gaps on visible viewport-intersecting elements against `tokens.spacing`. Undeclared computed family members emit the low-severity deterministic project-contract risk `unapproved-font-family`; rendered values outside the semantic color set emit `off-palette-color`; and rendered spacing outside the declared scale emits `off-scale-spacing` at the same tier.

Three additional visual-metric policies are strictly opt-in through their own `audit` sections. They compare rendered typography-variant, palette-count, or viewport-density measurements only with project-authored maxima. There are no defaults or universal recommendations. Configured overages emit low-severity, low-confidence heuristic risks; low values do not produce rewards or positive quality claims. Font order/roles, source-token provenance, palette-distance scoring or harmony, spacing rhythm/quality, authored-expression inference, lightness or alignment scoring, and overall layout, aesthetic, or accessibility quality are not inferred.

The closed audit overlay is:

```yaml
audit:
  fontFamily:
    additionalAllowedFamilies:
      - { value: "Pretendard Fallback", kind: named }
      - { value: ui-monospace, kind: generic }
      - { value: system-ui, kind: named }
    ignoreSelectors:
      - ".third-party-widget"
  color:
    ignoreSelectors:
      - ".third-party-color-widget"
  spacing:
    ignoreSelectors:
      - ".third-party-spacing-widget"
  # Illustrative project values, not recommendations:
  typographyVariants:
    maxDistinctVariants: 8
    ignoreSelectors:
      - ".third-party-type-widget"
  paletteDiscipline:
    maxDistinctColors: 24
    maxChromaticHueFamilies: 4
    ignoreSelectors:
      - ".embedded-chart"
  densityComplexity:
    maxVisibleElements: 120
    maxTextClusters: 48
    ignoreSelectors:
      - ".vendor-panel"
```

`fontFamily` must contain at least one property. Each array, when present, has 1–32 entries. Additional values are decoded individual family names of 1–128 trim-stable safe Unicode scalars, not CSS lists or quoted CSS source; commas inside a named value are data. `kind` is `named` or `generic`, and generic entries must use a supported CSS generic. A generic-looking spelling can deliberately be named: `{ value: system-ui, kind: named }` permits computed `"system-ui"`, while `kind: generic` permits unquoted `system-ui`. Heading, body, then additional entries are deduplicated by kind plus ASCII-folded value while preserving the first spelling.

Audit-only additions describe intentional runtime alternatives such as mono roles, platform/CJK fallbacks, or generated companion names; they do not enter AGENTS/DESIGN guidance or `design.tokens.json`. A framework name such as `Pretendard Fallback` or a Next-generated companion must be declared exactly. There is no framework, suffix, alias, glob, or first-member auto-approval.

Rendered-color membership covers direct-text foregrounds, visible backgrounds with no background image, and painted border sides with no border image. Fully transparent paint is ignored. Unsupported color spaces are recorded as skipped evidence; selector or collection failures make only `off-palette-color` partial. `audit.color.ignoreSelectors` applies to that detector only. This evidence does not prove source-token use, palette quality, accessibility, or pixel/compositor output.

Rendered-spacing membership uses the declared `px`/`rem` scale after per-viewport root-font conversion, implicit zero, negative-margin magnitude matching, and an inclusive fixed `0.001 CSS px` tolerance. For margins and gaps, CSS Typed OM preserves keyword evidence: `auto` margins and `normal` gaps are explicit skips. If Typed OM is unavailable, throws, or returns unsupported typed evidence, the affected margin/gap slot is skipped instead of accepting a resolved `getComputedStyle()` pixel fallback. Padding slots use computed CSS-pixel evidence directly; non-finite values and negative padding/gap are skipped as invalid evidence. `audit.spacing.ignoreSelectors` applies to this detector only.

Font-family evidence describes the computed list, not the font face that rendered each glyph. Selector-engine or computed-value processing errors mark only the affected check partial and retain unrelated measurements. Without audit `--guide`, the CLI performs no guide-policy loading or guide-specific capture, findings, notices, or failed checks.

### Visual metric budgets

Each configured metric adds a selector-free project-budget rule to generated AGENTS/DESIGN guidance and runs the matching viewport measurement during audit and bounded-loop audits. `ignoreSelectors` changes only runtime collection; it is excluded from generated guidance and the guide source hash. Omitting a metric section adds no rule, metric traversal, summary, notice, failed-check entry, finding, or score effect.

| Audit section | Budget bounds | Frozen IDs |
|---|---|---|
| `typographyVariants` | required `maxDistinctVariants`, integer `1..2000` | `typography-variant-budget-v1`; `rendered-typography-variants-v1` |
| `paletteDiscipline` | at least one of `maxDistinctColors` (`1..5000`) or `maxChromaticHueFamilies` (`1..12`) | `palette-discipline-budget-v1`; `rendered-rgba8-oklch-cover30-v1` |
| `densityComplexity` | at least one of `maxVisibleElements` (`1..10000`) or `maxTextClusters` (`1..20000`) | `density-complexity-budget-v1`; `viewport-dom-density-v1`; components `visible-content-elements-v1` and `text-flow-connectivity-v1` |

Each section is closed. Optional `ignoreSelectors` uses the same 1–32 item and 256-safe-scalar bounds as the other audit selectors. A section containing selectors but no required budget is invalid. Browser-invalid selector syntax or evaluation, a safety-cap breach, an unexpected collector exception, or invalid accounting discards only that metric's summary and marks its check partial.

Typography counts normalized computed family-stack + size + weight + style tuples on visible direct-text candidates. It does not identify the glyph-resolved face or assess pairing, roles, modular scale, or typography quality. Palette discipline counts distinct nontransparent computed RGBA8 paint values and a minimum closed 30-degree cover over chromatic OKLab hues. Its fixed chroma cutoff and span are reproducibility constants, not taste thresholds; the method does not enumerate pixels, composite paint, score hue harmony or lightness, or replace contrast checks. Density counts visible UI/media and direct-text owners plus connected components of text-flow fragments at the current viewport position. It does not resolve occlusion or measure below-fold, pixel, whitespace, alignment, symmetry, or balance.

The optional summaries are stored under each viewport's existing `measurement-<viewport>.data` evidence as `typographyVariants`, `paletteDiscipline`, and `densityComplexity`. Typography, palette, and visible-element summaries report `complete` or monotone `lower-bound` coverage; a lower bound can flag only when it already exceeds the configured maximum and is never described as a pass when it does not. Text-cluster connectivity reports `complete` or `incomplete`; incomplete cluster evidence is not compared with its budget and creates a density-component partial notice. A simultaneously sound visible-element overage can still emit the single density finding.

At most one finding per configured metric is emitted per viewport; a two-budget overage remains one finding with both components. All three criteria are `research-emerging`, `heuristic`, low-severity, low-confidence `risk`, and the criterion-bounded score counts each criterion once across viewports. Their exact computed counts do not establish universal or objective visual quality.

## Bounded loop

The bounded loop is available starting with v0.6.1.

```bash
design-harness loop \
  --url http://localhost:3000 \
  --out runs/repair-loop \
  --until deterministic-failures==0 \
  --max-iters 3 \
  --agent-cmd '<non-interactive command>' \
  --agent-timeout-ms 300000
```

Only the exact condition `deterministic-failures==0` is supported. The output root must not already exist. The CLI validates the local HTTP(S) target, explicit configs, limits, condition, and fresh output path before browser, output, or child-process side effects. It writes the baseline to `iterations/000-baseline`; `--max-iters N` then permits at most N agent commands and N additional audits. Heuristic risks, deterministic risks, and `needs-review` findings do not gate the loop. A partial audit always stops first with exit `2`; loop does not accept `--allow-partial`.

Exit codes are `0` for `already-clean` or `converged`, `1` for invalid input or an audit/agent/timeout/summary error, `2` for a partial audit, and `3` for `no-progress` or `max-iters`. Consecutive progress compares only the sorted multiset of deterministic-failure criterion/check/viewport/selector tuples, not generated finding IDs or scores.

Before each agent pass, the CLI inherits the caller environment except that the reserved `DESIGN_HARNESS_LOOP_*` prefix is cleared and replaced with exactly these fixed path/iteration variables:

- `DESIGN_HARNESS_LOOP_ITERATION`
- `DESIGN_HARNESS_LOOP_ROOT`
- `DESIGN_HARNESS_LOOP_ITERATION_DIR`
- `DESIGN_HARNESS_LOOP_AUDIT_PATH`
- `DESIGN_HARNESS_LOOP_REPORT_PATH`
- `DESIGN_HARNESS_LOOP_SUMMARY_PATH`

The fixed stdin message identifies page, audit, and report evidence as untrusted and directs the command to the environment paths. The CLI never interpolates evidence into the command. `loop-summary.json` keeps relative artifact paths, audit/agent outcomes, and the SHA-256 command hash; it does not persist the raw command, stdout, stderr, report content, stack traces, environment, or stdin. Stdout and stderr are streamed to the caller.

`--agent-cmd` executes one shell command with the caller's permissions, working directory, and inherited environment, which may expose credentials. Design Harness supplies no sandbox or network boundary. On POSIX, timeout cleanup targets the detached process group with `SIGTERM`, waits two seconds, then uses `SIGKILL` and reaps the child; direct-child signaling is the fallback. On Windows, the same direct-child sequence is best effort and may not terminate descendants. `--agent-timeout-ms` defaults to 300000 and accepts 1000–3600000.

The condition covers only recorded deterministic failures. It is not a completeness, conformance, or overall-quality guarantee.

## Guide compile and check

From inside the project that owns the guide:

```bash
design-harness guide compile \
  --guide ./design-guide.yaml \
  --copy ./copy-style.yaml \
  --target .

design-harness guide check \
  --guide ./design-guide.yaml \
  --copy ./copy-style.yaml \
  --target . \
  --max-tokens 2000
```

`--copy` is optional. `--guide` and `--target` are always explicit; neither command discovers config, targets, or remote input. The target must already exist. Guide and copy paths are resolved from the invocation working directory and must remain inside the target's real path without symlink traversal. An outside-target config is rejected at phase `containment` with a diagnostic that says that path class must be inside `--target`.

Compile derives all four outputs from the same normalized source:

- one owned guide block in `AGENTS.md`;
- `CLAUDE.md` with one marker-owned `@AGENTS.md` shim, unless a standalone import already exists;
- the same canonical guide block in `DESIGN.md`; and
- sorted, two-space `design.tokens.json` with a root `$extensions["dev.design-harness"]` ownership/provenance record.

AGENTS and DESIGN ownership uses exactly `<!-- design-harness:guide:begin -->` and `<!-- design-harness:guide:end -->`. Existing bytes outside the owned span are preserved. Malformed or ambiguous markers fail closed. An existing standalone Claude `@AGENTS.md` line remains byte-identical. An existing token file is replaceable only when its Design Harness extension proves ownership.

Compile preflights every input and output before staging any final body. A canonical private sibling lock (mode `0700` on POSIX) serializes cooperating guide compiles; inside it, the CLI probes same-device hard-link support, stages verified inodes, moves each existing destination into private recovery, and conditionally hard-links the staged inode into the now-empty destination. The bytes read from each config are bound to the identity captured during containment, and input, target-directory, stage, and output identities are revalidated around commit operations. A caught later failure restores verified originals without overwriting observable concurrent edits; unsafe residue remains under the lock and is reported as secondary evidence.

This is an all-or-restored protocol for handled filesystem errors and concurrent changes that remain observable across its identity guards. It is not globally atomic, crash-recoverable, or a defense against a hostile local process that swaps a parent directory away and back entirely inside one path-based filesystem-call window; Node does not expose the required directory-handle-relative link/rename primitives. Once a replacement is observed, the CLI stops mutating through that target path.

Check performs zero writes. It returns success only when the inputs are valid, every owned artifact is current, and the generated pack is within the requested estimate ceiling. `--max-tokens` accepts `1..2000`, defaults to 2000, and may only lower compile's hard ceiling.

### Supported Design Guide Profile `design-guide-v0.5a-2`

The [example guide](https://github.com/ictechgy/design-harness/blob/main/examples/configs/design-guide.example.yaml) shows the required base shape and the three adherence selector overlays. The illustrative YAML above shows the additional optional visual-metric sections; none of its numbers is a default. The base generation projection is exactly `schemaVersion: "0.2"`, `tokens`, `prohibitions`, and `signatureElement`. Audit-time checking adds six optional closed `audit` subtrees: the selector overlays `fontFamily`, `color`, and `spacing`, plus the project-budget `typographyVariants`, `paletteDiscipline`, and `densityComplexity` sections. Configured visual-metric budgets and frozen IDs also enter the generated guide rule and source hash; their selectors do not.

- `tokens.color.semantic`: 4–6 lower-kebab leaves under `$type: color`; each `$value` is a literal `srgb` color with three finite components in `[0,1]` and optional alpha in `[0,1]`.
- `tokens.font.family`: exactly `heading` and `body` under `$type: fontFamily`; each value is one family or an array of 1–4 families.
- `tokens.spacing` and `tokens.radius`: 2–12 lower-kebab leaves each under `$type: dimension`; values are finite, non-negative `px` or `rem` dimensions.
- `prohibitions`: 1–8 unique IDs from the bundled, versioned project-guidance catalog.
- `signatureElement`: one sanitized, NFC-normalized line of 1–280 Unicode scalar values.
- `audit.fontFamily.additionalAllowedFamilies`: optional 1–32 unique-by-kind-and-ASCII-fold decoded `{value,kind}` members; values are 1–128 trim-stable safe Unicode scalars, and `generic` values must be supported CSS generics.
- `audit.fontFamily.ignoreSelectors`: optional 1–32 unique, trim-stable selectors of at most 256 safe Unicode scalar values; syntax is validated by the captured browser at audit time.
- If `audit.fontFamily` is present, at least one of those two properties is required; either may be used without the other.
- `audit.color.ignoreSelectors`: required when `audit.color` is present; 1–32 unique, trim-stable selectors of at most 256 safe Unicode scalar values; syntax is validated by the captured browser at audit time.
- `audit.spacing.ignoreSelectors`: required when `audit.spacing` is present; 1–32 unique, trim-stable selectors of at most 256 safe Unicode scalar values; syntax is validated by the captured browser at audit time.
- `audit.typographyVariants.maxDistinctVariants`: required integer `1..2000`; optional `ignoreSelectors`.
- `audit.paletteDiscipline`: at least one of integer `maxDistinctColors: 1..5000` or `maxChromaticHueFamilies: 1..12`; optional `ignoreSelectors`.
- `audit.densityComplexity`: at least one of integer `maxVisibleElements: 1..10000` or `maxTextClusters: 1..20000`; optional `ignoreSelectors`.
- Each visual-metric selector list follows the same 1–32 unique, trim-stable, 256-safe-scalar rule and is validated by the captured browser.
- If `audit` is present, it must contain at least one of the six independent sections above.

This is a documented supported profile of DTCG 2025.10, not an arbitrary DTCG-file resolver or a full-conformance claim. v0.5a rejects aliases/references, `$extends`, `$root`, composites, gradients, token-file imports, themes, token-level metadata, and arbitrary input `$extensions`. It produces token JSON, not CSS or another platform format. The repository tests this profile with exact Style Dictionary 5.5.0 in a bounded CSS smoke; Style Dictionary is a root development dependency only, not a published runtime dependency. Compile recognizes the exact immediately prior owned `design-guide-v0.5a-1` / catalog `2026-07-18` tuple for transactional migration; check reports it stale and performs no write. Unknown ownership tuples still fail closed.

The optional copy projection includes configured locale, register declarations, literal glossary tiers/preferred terms, and banned phrases. It does not emit `surfaceMapping`, adapter names, or selectors into agent instructions.

### Budget semantics and non-goals

`guide-token-estimate-v1` is deterministic and model-agnostic:

```text
max(Unicode scalar count, ceil(UTF-8 byte length / 2))
```

It is an estimate, not an exact tokenizer count. Diagnostics identify the method, value, and ceiling.

Audit `--guide` adds computed-list font-family adherence, exact rendered-color adherence for semantic sRGB colors within the documented direct-text/background/painted-border scope, rendered computed CSS-pixel spacing membership within the documented margin/padding/gap scope, and only the visual-metric policies explicitly configured by the project. It does not infer spacing rhythm or aesthetics, source-token provenance, authored-expression intent, palette distance/harmony, lightness or alignment quality, actual glyph faces, universal typography/palette/density thresholds, low-density quality, overall layout/aesthetic quality, or accessibility. Framework inference, auto-discovery, automatic agent selection, a Claude skill, reference-file ingestion, anti-slop scoring, and obedience/quality claims remain out of scope. Partial audits still write artifacts and exit `2` unless `--allow-partial` is set; invalid audit config and invalid or stale guide operations exit `1`.

Repository: https://github.com/ictechgy/design-harness
