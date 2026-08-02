# AGENTS.md — Design Harness contributor contract

Design Harness is a model-agnostic UI/UX QA loop for coding agents: a local URL
becomes Playwright evidence, source-backed findings, `audit.json` / `report.md`,
and a bounded repair loop. The monorepo contains `core`, `copy-audit`,
`visual-audit`, and `cli` packages.

## Authority and instruction map

Owner instructions in the current session override this file. This file then
overrides committed docs, which override ignored notes (`REPORT.md`, `.omx/`).
If prose and an existing machine gate disagree, stop and report the drift; do
not weaken either just to pass. A nearer `AGENTS.md` adds rules for its subtree;
it cannot weaken this root contract.

| Area | Read before editing |
|---|---|
| `packages/core/` | `packages/core/AGENTS.md` |
| `packages/copy-audit/` | `packages/copy-audit/AGENTS.md` |
| `packages/visual-audit/` | `packages/visual-audit/AGENTS.md` |
| `packages/cli/` | `packages/cli/AGENTS.md` |
| `scripts/` | `scripts/AGENTS.md` |
| `docs/` | `docs/AGENTS.md` |
| `datasets/` | `datasets/AGENTS.md` |

Canonical detail lives in `docs/agent-protocol.md`, `docs/ROADMAP.md`,
`docs/criteria-and-checks.md`, and `docs/adr/`. Do not promote a rule from an
ignored note without also committing it here or enforcing it in code.

## Non-negotiable rules

1. **Epistemic discipline is the product.** Heuristic or subjective findings
   never become `failure`. Computation determinism does not upgrade criterion
   strength. When uncertain, downgrade.
2. **Release actions require exact current-session owner approval.** Do not run
   npm publish, version, tag, or GitHub Release commands without approval of the
   exact command. Publish order is core → copy-audit → visual-audit → cli.
3. **Required paths stay offline and provider-neutral.** Hosted judges are
   opt-in, `needs-review`, score-exempt, and provenance-recorded. Audit targets
   remain local HTTP(S).
4. **Preserve private and licensed boundaries.** Never track ignored owner
   evidence, generated Midjourney images, model assets, gated/non-commercial
   corpus derivatives, secrets, or credentials. `kiwi-nlp` is the exact-pinned
   LGPL runtime and stays lazy-loaded in copy-audit only. Follow the nearest
   data/copy instructions and `check:deps-policy`.
5. **Report only what evidence proves.** Never claim WCAG compliance,
   accessibility, good design, low false-positive rates, or general slop
   reduction without the required scoped evidence and citations.
6. **Keep contracts in lockstep.** Schema, enum, source-strength, runtime, and
   report-contract changes require the prescribed mirrors, tests, and ADRs.
7. **Core stays capture-agnostic.** Capture evidence may downgrade a finding;
   it may never upgrade one. Missing evidence means skip/notice, not invented
   evidence.
8. **Do not reopen cut-list or demand-gated surfaces alone.** Put the idea in
   `.omx/ideas.md` and ask the owner. The file contract remains canonical.
9. **Historical artifacts retain producer provenance.** Regenerate a complete
   artifact set or keep the versions that actually produced it; never bump
   historical versions mechanically.
10. **Agents obey gates, not aspirations.** A requirement that must persist
    belongs in a check, hook, schema, or test. Keep prose compact and concrete.

## Ask the owner before proceeding

- External publication, release, version, tag, or publish.
- A new runtime dependency, especially a networked one.
- Public README positioning or claim changes.
- Schema/enum changes outside an already approved milestone.
- A new deterministic + `failure` combination outside the current matrix.
- Reopening a cut-list item or adding a new capture/product surface.

## Session workflow

1. Read the newest `.omx/handoffs/*.md` if present; absence in a fresh clone is
   fine. Then run `git log --oneline -5`, `git status --short`, and identify the
   current branch/milestone.
2. Preserve user-owned dirty state. Never reset, overwrite, relabel, or commit
   ignored owner evidence. Use a separate worktree for unrelated work.
3. Read the nearest scoped `AGENTS.md`, relevant ADRs, and the verification row
   in `docs/agent-protocol.md` before editing.
4. Keep one coherent slice per branch/PR. Record out-of-scope ideas rather than
   implementing them.
5. Verify the real behavior, not only types. Report commands and failures
   truthfully. Before ending, write a concise handoff with the next action.

## Architecture boundaries

Dependency direction is `core` → `copy-audit` → `visual-audit` → `cli`; imports
may point left, never right. YAML parsing and filesystem orchestration stay in
CLI. Browser capture stays in visual-audit. Criteria, schemas, integrity,
scoring, and report contracts stay in core. `check:package-boundaries` enforces
the graph and exact runtime dependencies.

One config artifact drives both generation guidance and post-render checks.
Unsupported or absent evidence stays explicit; no implicit body fallback,
silent provider path, or best-effort repair may hide a contract failure.

## Verification shortcuts

```bash
pnpm build                       # workspace build in dependency order
pnpm typecheck                   # all package type checks
pnpm test                        # all package tests
pnpm validate                    # schemas, policies, benchmarks, hygiene
CI=true pnpm release:check       # full local release gate
pnpm example:serve               # merchant fixture on 127.0.0.1:4173
pnpm design-harness -- audit --url http://127.0.0.1:4173 --out runs/demo
```

For a changed check, add the criterion/source, measurement field, one browser
evidence path, finding mapping, a one-defect good/bad fixture pair, and unit +
live audit coverage in the same slice. For docs-only work, resolve links and run
`pnpm check:docs-claims` plus `pnpm check:tracked-hygiene`.

Never claim completion from a partial audit (exit 2 unless `--allow-partial`), a
flaky rerun without explanation, or tests that did not exercise the user path.
