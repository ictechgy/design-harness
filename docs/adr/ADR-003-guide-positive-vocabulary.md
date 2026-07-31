# ADR-003: Guide Positive Vocabulary — Typed Signature Commitments and a Declared Primary Task

- Status: Accepted
- Date: 2026-08-01
- Deciders: owner (directed 2026-08-01 after the generation benchmark: act on the measured finding rather than re-running the same pack); evidence base: `pnpm check:generation-benchmark` snapshot recorded in the ROADMAP backlog, `pnpm check:slop-convergence` pack-confound analysis

## Context

The owner's stated goal for Design Harness is a tool that both guides a design toward being genuinely good and reduces AI slop. A 12-cell generation benchmark measured how much of that the compiled pack actually delivers. One fixed brief, six generations per arm, one executor family, 12/12 complete:

| Axis | Expectation | without-pack | with-pack | delta | Held |
|---|---|---:|---:|---:|---|
| Token-adherence convergence (pack-pinned dimensions) | with-pack lower | 0.7005 | 0.2859 | -0.4145 | yes |
| Composition divergence (pack-pushed dimensions) | with-pack higher | 0.2529 | 0.2523 | -0.0006 | **no** |

`colorLiterals` collapsed from 0.9880 to 0.1852, so the declared token contract demonstrably reached the output. Composition did not move, and `layoutModeHistogram` moved the wrong way (0.1007 → 0.0177).

The cause is visible in what the pack contains. Compiling the example guide yields five rules and ~1306 estimated tokens: one token contract, three catalog prohibitions, and one `signatureElement`. The schema's entire positive vocabulary — everything that tells an agent what to *do* rather than what to avoid — is **one free-text string**.

Two structural problems follow.

**Prohibition has a low ceiling.** Blandness is not the presence of banned patterns, it is the absence of intent. Three "avoid" rules cannot produce a distinctive screen. The benchmark is the measurement of that ceiling.

**Hierarchy has no referent.** `RubricCategory` `task-fit` carries exactly one criterion of 37, because the guide has no way to declare what a screen is *for*. Hierarchy can only be correct relative to a primary task. Without a declared task, `hierarchy.visual-weight.priority-risk` can observe that weights are uniform but never that the wrong element is first.

Widening the schema is a hard rule 10 change and therefore needs this ADR before implementation.

## Decision

### 1. `signatureElement` becomes typed and plural, without breaking the existing field

`signatureElement: string` stays required and valid. A new optional `signatureCommitments` array carries typed entries:

```
signatureCommitments?: Array<{
  id: string;            // ^[a-z][a-z0-9-]*$, unique
  scope: SignatureScope; // "layout" | "emphasis" | "navigation" | "state" | "motion"
  commitment: string;    // what to do
  instead: string;       // the interchangeable default it replaces
}>
```

`scope` is a closed enum so the compiler can order rules deterministically and so a later criterion can bind per scope. `instead` is required because the benchmark's prohibitions failed while carrying exactly that contrast, and a commitment with no stated alternative reduces to vague encouragement.

Why not simply allow an array of strings: the measured failure is not quantity of prose, it is that the pack gives an agent nothing structured to satisfy. A typed pair (do this / instead of that) is the same shape the slop-fingerprint catalog already uses for prohibitions, which keeps one rule vocabulary rather than two.

### 2. A declared primary task, scoped to the guide's own surface

```
primaryTask?: {
  statement: string;       // the one job this surface must make obvious
  supportingTasks?: string[];  // at most 3, deliberately capped
}
```

The cap is the point. A guide that declares five equally primary tasks has declared none, and the uniform-emphasis failure this is meant to address would survive. Three supporting tasks is an arbitrary but deliberate ceiling, recorded as arbitrary.

`primaryTask` is generation-side only in this ADR. It does **not** create a criterion, does not appear in `audit.json`, and does not gate anything. Wiring it to `task-fit` checking is deliberately out of scope: no measurement yet shows that a declared task statement can be verified against a rendered page, and inventing that check here would be exactly the unproven-precision work the project's own precision-over-recall invariant forbids.

### 3. Both fields are optional, and absence performs no work

Omitting either field emits no rule, changes no hash input beyond its own absence, and costs no tokens. This preserves the existing invariant that omitting a guide section runs none of that work. Every current `design-guide.yaml` stays valid with no migration.

### 4. Strength is unchanged: `project-contract`, and nothing upgrades

These fields describe what a project declared about itself. Per ADR-001's policy matrix, `project-contract`-sourced criteria cap at deterministic `risk`, and per the standing rule computation determinism never upgrades criterion strength. Nothing in this ADR creates a `failure`, a score input, or a deterministic claim. The compiled rules are pre-generation guidance; the only post-render checking that exists for guide data remains the already-shipped token adherence.

### 5. Generation profile advances to `design-guide-v0.5a-3` with prior-profile recognition

New fields change the compiled source hash, so owned artifacts compiled by `design-guide-v0.5a-2` would otherwise read as stale. The profile id advances and `design-guide-v0.5a-2` joins the recognized-prior set in `packages/cli/src/guide-targets.ts`, matching the migration path already used when `-1` gave way to `-2`.

### 6. The token ceiling is not raised

`GUIDE_TOKEN_HARD_CEILING` stays 2000. The example guide compiles to ~1306, so there is headroom, but a project that overruns the ceiling must cut rules rather than get a larger pack. The ceiling exists because prose guidance is a prior-shifter with diminishing returns, and the benchmark gives no evidence that more tokens help.

**Measured consequence, and it is the important one.** With the ceiling held at 2000, the ceiling — not the schema — becomes the binding limit on positive vocabulary. On top of the example guide's five existing rules:

| Configuration | Estimated tokens | Admitted |
|---|---:|---|
| baseline (no widening) | 1306 | yes |
| +1 commitment | 1494 | yes |
| +2 commitments | 1686 | yes |
| +3 commitments | 1882 | yes |
| +4 commitments | 2068 | **rejected** |
| primary task + 1 supporting | 1518 | yes |
| primary task + 2 commitments | 1898 | yes |
| primary task + 3 commitments | 2094 | **rejected** |

So a project gets roughly three commitments, or a primary task plus two. That is a real limit on how much this ADR can move the composition axis, and it is recorded rather than worked around. If the re-run shows composition still flat, the ceiling is the next suspect and raising it needs its own decision with evidence, not a quiet edit.

## Consequences

- `design-guide.schema.json`, `DesignGuide` in `types.ts`, and `compileDesignGuide` gain the two optional fields; `additionalProperties: false` means the schema change is required for the fields to be accepted at all.
- `schemaVersion` of the guide stays `"0.2"`: the change is additive and optional, and every prior document remains valid. `SCHEMA_VERSION` for `audit.json` is untouched at `0.2`.
- The generation benchmark can be re-run with a widened guide to test whether the composition axis moves. That re-run is the point of this ADR, and a second null result is an acceptable and reportable outcome — it would mean the pack mechanism itself, not its vocabulary, is the limit.
- No criterion, enum, detector, score, or CLI flag is added. `RubricCategory` is unchanged, so `check:enum-lockstep` is unaffected.
- `task-fit` remains at one criterion. This ADR gives a future task-fit check a place to read intent from; it does not build one.

## References

- ROADMAP backlog: generation benchmark v1 measurement and the two-axis constraint.
- `scripts/slop-convergence/pack-confound.mjs`: dimension classification showing pinned dimensions cannot distinguish slop from obedience.
- ADR-001: source-strength policy matrix; `project-contract` caps at deterministic risk.
- ADR-002: declared design data is evidence layer 4; provenance may downgrade a tier, never upgrade it.
- `datasets/slop-fingerprints.json`: the existing do/instead rule shape reused by `signatureCommitments`.
