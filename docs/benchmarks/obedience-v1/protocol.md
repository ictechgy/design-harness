# Obedience v1 protocol

Status: fixed protocol for the 2026-07-24 KST operator run. Machine timestamps
and the generated snapshot-date field use UTC.

## Scope and claim boundary

This protocol records one fresh execution for each of twelve cells against one
project-authored synthetic fixture. It measures whether that single execution
closes the fixture's detectable deterministic failures while preserving its
declared visible structure.

The only completion statement permitted for this milestone is:

> obedience-v1 descriptive snapshot complete

Comparative, statistical, provider/model-ranking, general-obedience, and
“reins” claims remain blocked pending a separately scheduled repeated/two-case
benchmark. The snapshot does not establish a causal effect for an instruction
mechanism, rank executors or models, estimate variance, measure general design
quality, establish accessibility or standards compliance, or generalize to
real applications.

## Fixed matrix

Every coordinate below must appear exactly once in the public result. A failed,
timed-out, errored, or unavailable cell remains visible.

| Cell ID | Executor | Requested model | Effort | Delivery |
|---|---|---|---|---|
| `claude-haiku-inline` | Claude Code | `haiku` | unsupported / omitted | `inline` |
| `claude-haiku-skill` | Claude Code | `haiku` | unsupported / omitted | `skill` |
| `claude-haiku-no-pack` | Claude Code | `haiku` | unsupported / omitted | `no-pack` |
| `claude-sonnet-inline` | Claude Code | `sonnet` | `low` | `inline` |
| `claude-sonnet-skill` | Claude Code | `sonnet` | `low` | `skill` |
| `claude-sonnet-no-pack` | Claude Code | `sonnet` | `low` | `no-pack` |
| `claude-opus-inline` | Claude Code | `opus` | `low` | `inline` |
| `claude-opus-skill` | Claude Code | `opus` | `low` | `skill` |
| `claude-opus-no-pack` | Claude Code | `opus` | `low` | `no-pack` |
| `codex-gpt-5-6-sol-inline` | Codex CLI | `gpt-5.6-sol` | `low` | `inline` |
| `codex-gpt-5-6-sol-skill` | Codex CLI | `gpt-5.6-sol` | `low` | `skill` |
| `codex-gpt-5-6-sol-no-pack` | Codex CLI | `gpt-5.6-sol` | `low` | `no-pack` |

Requested and resolved model identifiers are distinct fields. A command that
silently substitutes another model is invalid. An executor that cannot resolve
the requested model records an explicit terminal `unavailable` or `error`
result rather than disappearing from the matrix.

## Pinned common inputs

Every cell receives byte-identical copies of:

- `fixture.html`;
- `copy-style.yaml`;
- `common-task.md`;
- `preservation-oracle.json`;
- the same built Design Harness packages, audit configuration, desktop/mobile
  viewport set, and output schema/formula versions.

The preparation record pins each item with SHA-256. Every cell record repeats
`commonTaskSha256`, `fixtureSha256`, `copyStyleSha256`,
`preservationOracleSha256`, and `harnessBuildSha256`. The result validator
rejects drift across cells. It also rejects a different pass count, extra
re-audit, or different audit configuration.

The starting fixture intentionally has two deterministic failures in each of
the desktop and mobile viewports:

- `page-lang-missing`;
- `placeholder-leak`.

No other starting finding is part of the controlled defect set. The baseline
audit command uses explicit local inputs, including
`--copy copy-style.yaml`, and targets only an ephemeral loopback HTTP URL.

## Delivery mechanisms

Delivery is the only treatment dimension. The common task stays in its own file
and is never rewritten to describe a mechanism. Preparation adds one separate,
predeclared delivery stanza whose bytes are hashed as
`deliveryStanzaSha256`.

### `inline`

- Claude Code receives the canonical shared block from
  `adapters/shared/rules.md` in the cell's `CLAUDE.md`.
- Codex CLI receives the same canonical shared block in the cell's `AGENTS.md`.
- No Design Harness skill is installed in the cell.
- The delivery stanza says that the canonical rules are present in the
  executor's project instruction file.

### `skill`

- Claude Code receives `adapters/claude-code-skill/` at
  `.claude/skills/product-ui-designer/`.
- Codex CLI receives `adapters/codex-skill/` at
  `.agents/skills/product-ui-designer/`.
- No inline Design Harness block is added to `CLAUDE.md` or `AGENTS.md`.
- The delivery stanza explicitly invokes `/product-ui-designer` for Claude Code
  or `$product-ui-designer` for Codex CLI.

### `no-pack`

- No Design Harness instruction block or adapter skill is installed.
- The delivery stanza states only that no Design Harness rule pack is
  installed and the executor should complete the unchanged common task.

The adapter may describe a general audit loop, but the benchmark task is more
specific: the executor reads the already-created baseline evidence, performs
one focused source revision, and does not run an audit. The orchestrator owns
the one final re-audit so the audit count is identical across all cells.

## Isolation and external execution

Preparation creates twelve disposable cell roots outside the repository. An
executor's working directory is its one cell. It may write only within that
cell, and the common task permits changes only to `fixture.html`. The source
repository is not a writable executor target.

Provider execution is explicit and opt-in. Repository tooling prepares cells,
validates operator imports, renders the bounded public record, and validates
the result. It does not contain a provider SDK, credential flow, authentication
material, model-selection policy, or Claude/Codex-specific runtime driver.

For each cell, the operator supplies the exact external non-interactive command
at execution time through an untracked input. The orchestrator sends the
byte-identical common task and the cell's separate delivery stanza to that
command. It records a sanitized command descriptor and its SHA-256, not the raw
command. The descriptor may include only the executable basename, invocation
mode, requested model, effort, prompt input mode, and delivery mechanism.
Arguments containing credentials, environment values, absolute user paths, and
raw shell text are never serialized into tracked output.

Before the repair, the operator records the executor binary identity, how it
was resolved, CLI version, requested model, resolved model, and effort setting.
The tracked record uses a redacted source label such as `operator-path`, never
an absolute home path.

## Per-cell execution

The orchestrator applies these steps once per cell:

1. Verify the common input hashes and isolated cell boundary.
2. Start the fixture on an ephemeral loopback HTTP port.
3. Run exactly one baseline audit with the pinned Harness build and
   `--copy copy-style.yaml`; store it at `runs/baseline/`.
4. Verify that both controlled deterministic failures appear in both viewports.
5. Invoke exactly one operator-supplied external executor command.
6. Preserve its exit status, wall time, terminal status, usage data when
   exposed, and the final cell source even when it exits nonzero or times out.
7. After the executor terminates, run exactly one final audit and store it at
   `runs/final/`. This re-audit is mandatory even for `error`, `timeout`, and
   `unavailable` outcomes.
8. Apply the preservation oracle to the rendered final source.
9. Stop the local server, verify cleanup, and write a sanitized local import
   record.

The executor is one process invocation and one focused revision pass. A poor
repair, introduced failure, incomplete repair, or preservation failure is a
measurement result and is never retried to obtain a pass.

## Retry rule

At most one operational retry is allowed, and only for a documented
authentication failure or transient executor/tool transport failure that
occurred before a meaningful repair result was produced. The local private
record retains both attempts. The public cell identifies the accepted attempt
index and a sanitized retry reason.

No retry is allowed for a bad edit, incomplete closure, new failure, failed
preservation check, low score, or undesirable model response. If the single
allowed operational retry also fails, the cell remains visible with its
terminal failure status.

## Preservation oracle

`preservation-oracle.json` binds every required element to an immutable
`data-benchmark-feature` marker. The final rendered page must preserve all
markers exactly once and satisfy their tag, text, label, role, type, option,
alternative-text, and visibility constraints.

The oracle also requires at least:

- fifteen visible marked features;
- two visible headings;
- three visible controls;
- one visible image; and
- 180 visible text characters.

Preservation fails if a required feature is deleted, renamed, duplicated,
hidden, emptied, stripped of its accessible name or semantics, moved off
screen, reduced to zero size, made transparent, or placed under a hidden or
inert ancestor. It also fails if the interface is replaced by a generic
success/audit message. Focused language, interpolation, semantic markup, text,
or style repairs are allowed when the required content and controls remain
meaningful and visible.

## Cell record

Each machine-readable cell records at least:

- unique cell ID, executor family, mechanism, attempt index, and terminal
  status;
- executor binary basename, redacted binary/version source, CLI version,
  requested model, resolved model, and effort/reasoning setting;
- `commonTaskSha256`, `fixtureSha256`, `copyStyleSha256`,
  `deliveryStanzaSha256`, `preservationOracleSha256`,
  `harnessBuildSha256`, and sanitized `externalCommandSha256`;
- starting and final source SHA-256 values plus a SHA-256 of the private raw
  transcript;
- executor exit status, wall time, optional token/cost usage, and sanitized
  operational-retry metadata;
- initial/final deterministic-failure counts and identities, closure rate,
  newly introduced deterministic failures, preservation verdict, and the
  combined closure-plus-preservation verdict;
- initial/final advisory score and band, explicitly labeled formula-bound and
  secondary; and
- remaining deterministic risks and heuristic/needs-review counts.

Raw commands, transcripts, environment dumps, credentials, absolute home/temp
paths, browser binaries, and provider authentication artifacts remain private
and untracked.

## Aggregation and publication

The public result contains all twelve cells and bounded recomputed counts. It
commits the pinned common inputs plus each final `fixture.html` as replayable
text evidence. Aggregate values are derived from cells, never entered by hand.
Unavailable and unsuccessful cells remain in the table and denominator.

The dependency-free result validator rejects:

- a missing, extra, or duplicate matrix coordinate;
- missing provenance, terminal status, failure visibility, or final source;
- a source/result hash mismatch;
- cross-cell drift in common inputs, Harness/config, pass count, re-audit count,
  or preservation oracle;
- inconsistent failure counts, closure rates, new-failure sets, preservation
  verdicts, or aggregates;
- absolute private paths, credential-shaped keys, raw environment/command
  values, or unredacted secrets;
- public copy that claims superiority, causation, general obedience, design
  quality, accessibility/compliance, real-app generalization, or statistical
  evidence; and
- omission of the exact bounded completion phrase and the separate
  repeated/two-case claim gate.

The credential-free validator is part of `pnpm validate`. Preparation and
external executor invocation remain explicit, operator-controlled, non-CI
steps.

## Public limitations

Interpret every result with all of these limitations:

1. one project-authored synthetic fixture;
2. one run per cell and no variance estimate;
3. snapshot-specific CLI and resolved model versions;
4. provider-specific project-instruction and skill discovery;
5. only defects detectable by the pinned Harness checks;
6. advisory score and band are formula-bound secondary measurements;
7. no causal comparison among delivery mechanisms, executors, or models; and
8. no generalization to real applications, general agent obedience, design
   quality, accessibility, or standards compliance.

Any repeated, two-case, real-application, or positioning experiment is a
separate scheduled milestone and must not silently revise this snapshot's
meaning.
