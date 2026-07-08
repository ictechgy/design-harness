# ADR-001: Copy-Audit Foundations — Runtime and Source-Strength Vocabulary, Criterion Policy Matrix, Scoring Weights

- Status: Accepted
- Date: 2026-07-08
- Deciders: owner for the content pre-settled in `docs/ROADMAP.md` v0.4 item 1 (enum names, policy matrix, `check:criteria-policy`, scoring weights, WCAG SC metadata); this ADR additionally decides the enforcement details marked "new in this ADR" below

## Context

The v0.4 Korean copy audit introduces checks that do not fit the existing vocabulary: findings produced by an opt-in LLM judge, and checks that assert conformance to a project's own declared configuration (`design-guide.yaml`, `copy-style.yaml`) rather than to an external standard. At the same time, the epistemic-discipline rule ("heuristic or subjective findings may never be failures") is only enforced at the finding level by `packages/core/src/integrity.ts`. Nothing prevents a criterion from being registered with a disallowed `sourceStrength` x `determinism` x `resultKind` combination in the first place.

## Decision

### 1. New `CheckRuntime` value: `model-judged`

Named `model-judged` — not `text-analysis`, not `llm-review`. Criteria with this runtime must declare `determinism: "subjective"` and therefore emit `needs-review` findings only. Judge features stay opt-in (injectable callback or explicit flag), score-exempt, and record model id plus prompt hash in `audit.json` (AGENTS.md hard rule 7).

### 2. New `SourceStrength` value: `project-contract`

For checks backed by the project's own declared config. A `project-contract` finding asserts "this violates YOUR declared contract" — never universal quality. Its deterministic ceiling is `risk`: even an exact, reproducible mismatch against a project's own declaration is not "broken rendering", so deterministic `failure` language stays reserved for official-testable sources.

Boundary note (new in this ADR): project config may also supply the ground truth for an *official-testable* determination (for example a `lang` mismatch measured against an explicit `--locale` declaration, per WCAG 3.1.1/3.1.2). That criterion remains `official-testable` — the config resolves what the standard already makes testable. `project-contract` covers claims whose only authority is the project's own contract. This ruling supersedes the ROADMAP v0.3.2 scope note that labeled the lang-mismatch source `project-contract` (amended in the same PR); it follows the AGENTS.md tier table, which places the page-lang row in the deterministic-failure tier. In particular, `placeholder-leak` emits `failure` under `official-testable` via the ICU MessageFormat specification (unrendered syntax is definitionally broken rendering), not under `project-contract`.

### 3. Criterion policy matrix (exhaustive; ceiling semantics)

Each cell is the **maximum** `resultKind` a criterion may declare; downgrading is always allowed ("when unsure, downgrade"). An empty cell means the determinism itself is disallowed for that source strength — computation determinism never upgrades criterion strength, so research-grade and philosophical criteria may never declare `deterministic` even when their metric is exactly countable (colors, font variants, density).

| sourceStrength \ determinism | deterministic | heuristic | subjective |
| --- | --- | --- | --- |
| `official-testable` | failure | risk | needs-review |
| `project-contract` | risk | risk | needs-review |
| `official-pattern` | risk | risk | needs-review |
| `industry-heuristic` | risk | risk | needs-review |
| `research-emerging` | — | risk | needs-review |
| `philosophical` | — | — | needs-review |

Anything not representable in this matrix is disallowed. Any source combined with `subjective` determinism (including everything produced through the `model-judged` runtime) is `needs-review` only.

This table completes the ROADMAP item-1 one-liner (new in this ADR): it adds cells the one-liner omitted but the shipped registry and the AGENTS.md Korean tier table already require — `official-testable` + heuristic (a11y.color-only-state.risk, interaction.status.feedback, a11y.moving-content.controls), `official-pattern`/`industry-heuristic` + deterministic (visual.text-clipping.none; the josa-hedge and Korean line-break tiers), and `project-contract` + heuristic (register mixing against a configured register map). Every added cell caps at `risk`.

### 4. Enforcement: `check:criteria-policy`

`packages/core/src/criteria-policy.ts` validates every registry entry against the matrix, plus:

- `model-judged` runtime requires `subjective` determinism;
- (new in this ADR) the declared `sourceStrength` must be backed by at least one referenced source of equal or greater strength on the ladder official-testable > official-pattern > industry-heuristic > research-emerging > philosophical; `project-contract` sits outside that ladder and must be matched exactly (a project contract neither borrows nor lends official strength);
- clause-map hygiene (decision 5).

`scripts/check-criteria-policy.mjs` runs it in `pnpm validate` (and therefore CI and `release:check`), alongside unit coverage in `criteria-policy.test.ts`. `integrity.ts` keeps enforcing the finding-level rules; this guard blocks disallowed combinations at the criterion level, before any finding exists.

### 5. Machine-readable regulatory clause metadata

`CriterionSource` gains an optional `clausesByCriterion: Record<criterionId, string[]>`. The `wcag-2-2` source entry now maps every criterion that cites it to its WCAG 2.2 success-criterion ids (for example `a11y.language.page-lang` → `3.1.1`). The map lives on the **source**, not the criterion, so a future standard remap (WCAG 3.0, KWCAG 2.2) is a new source entry with its own mapping — mechanical, no criterion edits. `check:criteria-policy` enforces that a clause-mapped source maps every citing criterion and that WCAG ids are well-formed (new in this ADR: generalizing completeness to any clause-mapped source and the id format check; the wcag-2-2 completeness requirement itself is pre-settled by ROADMAP item 1). KWCAG 2.2 clause mapping is deferred to the v0.6 Korean market slice (its mapping table is specified there); WCAG 3.0 stays watch-only until Candidate Recommendation (projected ≥ Q4 2027).

### 6. Scoring weights (decision recorded here; implementation is the v0.4a scoring slice)

`needs-review` findings become score-exempt. Deductions are weighted by evidence tier: deterministic `failure` 1.0, deterministic `risk` 0.6, heuristic `risk` 0.25, `needs-review` 0. The scoring change ships with a score-local `advisoryScore.formulaVersion` note in the audit artifact. The advisory score remains advisory — never an objective design-quality grade.

## Consequences

- The two enum additions land across `types.ts` and the three JSON-schema mirrors in one move (`check:enum-lockstep` enforces lockstep). No shipped criterion uses them yet; the matrix rows are active so the first `project-contract` or `model-judged` criterion is validated from day one.
- Existing registry entries all pass the matrix; combinations like `industry-heuristic` + `deterministic` + `risk` (e.g. text clipping) sit exactly at their cell's ceiling — deterministic computation never lifts them past `risk` (rule 1 corollary).
- Adding a criterion that cites `wcag-2-2` now requires adding its success-criterion id to `clausesByCriterion` — a deliberate speed bump that keeps regulatory mapping complete.
- Possible follow-up (not decided here): an `integrity.ts` rule that a finding's `resultKind` may not escalate above its criterion's declared `resultKind`.

## References

- `docs/ROADMAP.md` v0.4 item 1 (pre-settled content; its scoring sub-bullet ships as its own v0.4a scoring slice — see the Deciders note for what this ADR adds).
- `docs/criteria-and-checks.md` — source-strength rules, "computation determinism never upgrades criterion strength".
- AGENTS.md hard rules 1 (epistemic discipline), 7 (no hosted LLM in required paths), 10 (enum lockstep; ADR required for new kinds).
