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

Without `--copy`, the CLI does not discover a config or run copy analysis. The supported checks are `placeholder-leak`, `josa-hedge`, `glossary-banned-term`, `glossary-use-carefully-term`, and `banned-phrase`. Morphology, register, spelling, and model-judged checks are not enabled by this flag.

Font-family adherence is a separate explicit opt-in through the same strictly validated project guide used by guide compile/check:

```bash
design-harness audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --guide ./design-guide.yaml
```

`--guide` performs no discovery and may be combined with `--copy`. It unions the guide's heading/body family declarations with optional audit-only additions and evaluates the computed `font-family` list on visible text candidates. A list containing any undeclared member emits the low-severity deterministic project-contract risk `unapproved-font-family`; order and roles are not enforced, but every parsed member must be declared. Optional selectors exclude deliberate third-party subtrees from this check only.

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
```

`fontFamily` must contain at least one property. Each array, when present, has 1–32 entries. Additional values are decoded individual family names of 1–128 trim-stable safe Unicode scalars, not CSS lists or quoted CSS source; commas inside a named value are data. `kind` is `named` or `generic`, and generic entries must use a supported CSS generic. A generic-looking spelling can deliberately be named: `{ value: system-ui, kind: named }` permits computed `"system-ui"`, while `kind: generic` permits unquoted `system-ui`. Heading, body, then additional entries are deduplicated by kind plus ASCII-folded value while preserving the first spelling.

Audit-only additions describe intentional runtime alternatives such as mono roles, platform/CJK fallbacks, or generated companion names; they do not enter AGENTS/DESIGN guidance or `design.tokens.json`. A framework name such as `Pretendard Fallback` or a Next-generated companion must be declared exactly. There is no framework, suffix, alias, glob, or first-member auto-approval.

This evidence describes the computed family list, not the font face that rendered each glyph. Selector-engine or computed-family processing errors mark only this check partial and retain unrelated measurements. Without audit `--guide`, the CLI performs no font-policy loading, capture, findings, notices, or failed checks.

## Bounded loop

The loop described here is present in the current source checkout and remains unreleased after v0.6.0.

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

### Supported Design Guide Profile `v0.5a-1`

The [example guide](https://github.com/ictechgy/design-harness/blob/main/examples/configs/design-guide.example.yaml) shows the complete YAML shape. Its generation projection is exactly `schemaVersion: "0.2"`, `tokens`, `prohibitions`, and `signatureElement`; v0.5b adds the optional closed audit-only `audit.fontFamily` subtree.

- `tokens.color.semantic`: 4–6 lower-kebab leaves under `$type: color`; each `$value` is a literal `srgb` color with three finite components in `[0,1]` and optional alpha in `[0,1]`.
- `tokens.font.family`: exactly `heading` and `body` under `$type: fontFamily`; each value is one family or an array of 1–4 families.
- `tokens.spacing` and `tokens.radius`: 2–12 lower-kebab leaves each under `$type: dimension`; values are finite, non-negative `px` or `rem` dimensions.
- `prohibitions`: 1–8 unique IDs from the bundled, versioned project-guidance catalog.
- `signatureElement`: one sanitized, NFC-normalized line of 1–280 Unicode scalar values.
- `audit.fontFamily.additionalAllowedFamilies`: optional 1–32 unique-by-kind-and-ASCII-fold decoded `{value,kind}` members; values are 1–128 trim-stable safe Unicode scalars, and `generic` values must be supported CSS generics.
- `audit.fontFamily.ignoreSelectors`: optional 1–32 unique, trim-stable selectors of at most 256 safe Unicode scalar values; syntax is validated by the captured browser at audit time.
- If `audit.fontFamily` is present, at least one of those two properties is required; either may be used without the other.

This is a documented supported profile of DTCG 2025.10, not an arbitrary DTCG-file resolver or a full-conformance claim. v0.5a rejects aliases/references, `$extends`, `$root`, composites, gradients, token-file imports, themes, token-level metadata, and arbitrary input `$extensions`. It produces token JSON, not CSS or another platform format. The repository tests this profile with exact Style Dictionary 5.5.0 in a bounded CSS smoke; Style Dictionary is a root development dependency only, not a published runtime dependency.

The optional copy projection includes configured locale, register declarations, literal glossary tiers/preferred terms, and banned phrases. It does not emit `surfaceMapping`, adapter names, or selectors into agent instructions.

### Budget semantics and non-goals

`guide-token-estimate-v1` is deterministic and model-agnostic:

```text
max(Unicode scalar count, ceil(UTF-8 byte length / 2))
```

It is an estimate, not an exact tokenizer count. Diagnostics identify the method, value, and ceiling.

Audit `--guide` adds only computed-list font-family adherence, its exact audit-only additions, and its third-party selector exception. Palette/spacing adherence, actual glyph-face detection, framework inference, auto-discovery, automatic agent selection, a Claude skill, reference-file ingestion, anti-slop scoring, and obedience/quality claims remain out of scope. Partial audits still write artifacts and exit `2` unless `--allow-partial` is set; invalid audit config and invalid or stale guide operations exit `1`.

Repository: https://github.com/ictechgy/design-harness
