# Repeated two-case obedience protocol

Status: `READY_FOR_OPERATOR`.

## Scope

This sibling protocol schedules exactly two project-authored synthetic cases,
three independent repetitions, and the twelve executor/model/delivery
coordinates fixed by obedience-v1. The complete matrix therefore contains 72
unique executions.

The protocol records whether each single execution closes the case's detectable
deterministic failures while preserving the case-specific visible structure.
It reports observed within-coordinate variation only after all 72 terminal
records exist.

It does not establish causation, statistical significance, provider/model
ranking, real-application generalization, general agent obedience, design
quality, accessibility, standards compliance, or a “reins” claim.

## Cases

- `operations-queue` reuses the byte-pinned public obedience-v1 fixture and
  case-specific preservation oracle.
- `support-triage` uses a different DOM hierarchy, source selector mapping,
  content domain, marker set, and case-specific preservation oracle.

Both starting pages intentionally expose the same deterministic failure
families once in each desktop/mobile viewport:

- `page-lang-missing`;
- `placeholder-leak`.

Selectors are case-specific and are not compared across cases.

## Matrix

The twelve logical executor/model/delivery coordinates remain exactly those in
`../obedience-v1/protocol.md`: Claude Code logical `haiku`, `sonnet`, and
`opus`, plus Codex CLI `gpt-5.6-sol`, each delivered through `inline`, `skill`,
and `no-pack`.

Each coordinate appears once for every case and repeat index `1..3`.
Requested and resolved model identifiers are recorded separately. Silent model
substitution invalidates a cell; unavailable/error/timeout remains visible.

## Execution

Preparation creates 72 isolated roots outside the repository and never invokes
a provider. For every execution the operator must:

1. verify all case, task, delivery, adapter, build, and configuration hashes;
2. run exactly one local baseline audit;
3. invoke exactly one meaningful external executor attempt;
4. record model, CLI, effort, timestamps, bounded usage, exit/timeout state,
   transcript hash, and sanitized command descriptor;
5. run exactly one mandatory final local audit even after terminal failure;
6. validate the case-specific preservation oracle and editable-file boundary.

At most one retry is allowed, only after a pre-result authentication or
transient tool/transport failure. Both attempts remain recorded. Bad edits,
incomplete repairs, new failures, failed preservation, low scores, and
undesired answers are never retried.

Raw commands, workspaces, transcripts, provider authentication material,
absolute paths, and environment values remain private and untracked.

## Publication

The public snapshot is published atomically only after a dependency-free
validator accepts all 72 unique terminal coordinates, every final source and
hash, all aggregates, all within-coordinate variation records, the exact
closed public tree, and deterministic report parity.

Until then, only the repository-safe preparation contract is public and the
status remains `READY_FOR_OPERATOR`. No partial public result table may be
presented as a completed snapshot.
