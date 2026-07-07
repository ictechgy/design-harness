# AGENTS.md — Working Guide for AI Agents

Design Harness is an open-source, model-agnostic UI/UX QA loop for AI coding agents: local URL → Playwright screenshots → source-backed checks → `audit.json` / `report.md` → coding agent fixes. Monorepo: `@design-harness/core` (criteria, schemas, scoring, report), `@design-harness/visual-audit` (browser measurements + checks), `@design-harness/cli`.

Strategic direction, rationale, and evidence live in `REPORT.md` (git-ignored, Korean; long-form original in `.omx/plans/2026-07-07-evolution-research.md`). If those files are missing in your checkout, ask the owner before making strategic decisions. This file is the operational compression of that report — when in doubt, this file wins over your own judgment about scope.

## HARD RULES (never violate)

1. **Epistemic discipline is the product.** A finding with `determinism: heuristic` or `subjective` may NEVER have `resultKind: failure` (enforced by `packages/core/src/integrity.ts` — do not weaken it). Deterministic `failure` language is reserved for official-testable sources (WCAG 2.2) or explicit project-declared config (see ADR rule below). When unsure, downgrade to `risk` or `needs-review`.
2. **No npm publish, version bump, tag, or GitHub release without the owner's explicit approval in the current session.** Publish order when approved: core → visual-audit → cli.
3. **Never commit generated Midjourney images** or any binary from `datasets/midjourney-reference-lab/local-assets/`. `scripts/check-midjourney-reference-policy.mjs` guards this; do not bypass it. Committed artifacts derived from images (e.g. distilled token files) are fine.
4. **Never add hanspell / py-hanspell / Pusan National University / Naver / Daum spellcheck endpoints** as dependencies or default behavior — ToS-restricted and breakage-prone. At most an off-by-default adapter with a ToS warning, and only if the owner asks.
5. **License hygiene for the Korean copy stack**: `kiwi-nlp` is LGPL (allowed as unmodified dependency; document it), `spellcheck-ko` dictionary is GPLv3 (must be runtime-fetched data, never bundled into the Apache-2.0 packages).
6. **No hosted LLM in any required path.** LLM/VLM judge features must be opt-in (injectable callback / explicit flag), emit `needs-review` findings only, be excluded from the advisory score, and record model ID + prompt hash in `audit.json`.
7. **Audit targets stay local HTTP(S)** (`assertLocalHttpUrl` / `packages/core/src/input-policy.ts`). Do not widen this boundary.
8. **Report copy guardrails**: the harness's own report language must never claim "WCAG compliant", "accessible", "good design" etc. unqualified (`validateReportCopyGuardrails` in `packages/core/src/report.ts`).
9. **New enum values require lockstep edits.** Category/runtime enums are duplicated across `packages/core/src/types.ts`, `finding.schema.json`, `criterion.schema.json`, `audit-result.schema.json`, `rubric.yaml`, and `implementationAreaFor` in `report.ts`; report sections are duplicated in `packages/cli/src/output.ts`. Touch all of them or none. New source-strength kinds or check runtimes need a short ADR in `docs/` first.
10. **Do not start milestone work that is on the cut list** (below) without the owner explicitly reopening it.

## Commands

```bash
pnpm install && pnpm build          # build workspace (core → visual-audit → cli)
pnpm test                           # all package tests (CI=true for non-interactive)
pnpm release:check                  # build + typecheck + test + validate + pack + smoke
pnpm example:serve                  # serve merchant-dashboard fixture on :4173
pnpm design-harness -- audit --url http://localhost:4173 --out runs/demo
pnpm validate:midjourney-lab        # manifest + policy validators
pnpm check:v0.3-integrations        # scenario/MCP/PR-comment scaffolding checks
```

Playwright Chromium missing → `pnpm playwright:install`. Partial audits exit `2` unless `--allow-partial`.

## Adding a check (the established 7-step path)

Criterion in `packages/core/src/criteria.ts` (with `CRITERION_SOURCES` entry) → measurement fields in `ViewportMeasurements` (`packages/visual-audit/src/checks.ts`) → browser evidence in `browser-measurements.ts` (inside the single `page.evaluate` closure) → `findingsFromMeasurements` mapping → good/bad fixture pair in `examples/ui-quality-fixtures/` (one defect per detector) → unit tests → `pnpm release:check`. Details: `docs/criteria-and-checks.md`.

## Current roadmap (agreed 2026-07-07 — follow this sequence)

| Milestone | Scope |
|---|---|
| **v0.3.2** (current) | Publish v0.3.1 to npm AS-IS (owner approval required, no new code). Fix 2 CJK-bias bugs: line-length char-width `fontSize*0.52` → ~1.0 for majority-CJK text (`browser-measurements.ts` ~L543); English-only status regex → language-keyed table incl. 저장 중/로딩 중/완료/오류/실패 (~L634). Add `page-lang-missing` check (WCAG 3.1.1, official-testable, deterministic failure). Commit one finding-rich example report. Port `adapters/codex-skill` to a Claude Code skill. Run the week-zero experiment: audit a bad fixture → feed report.md to 2–3 coding agents → re-audit → record deltas. |
| **v0.4** | Page-wide text inventory + `page.ariaSnapshot()` as evidence assets. One ADR settling: new runtime name for model-judged checks + source-strength treatment for project-config-backed rules. Add `content` RubricCategory **in the same PR as** schema-duplication consolidation. New package `packages/copy-audit` (deterministic + heuristic Korean tiers only — see table below). Korean good/bad fixtures. Scoring fix: needs-review findings score-exempt, determinism-weighted deductions. Calibration runner: audit every fixture, diff vs manifest `expectedFindings`/`shouldNotFlag`, CI gate. |
| **v0.5** | `design-harness guide compile`: `design-guide.yaml` + `copy-style.yaml` → ≤2k-token pack (DESIGN.md, Claude skill, AGENTS.md section) + `tokens.css`. Hard constraints first. Token-adherence checks (off-palette-color, off-scale-spacing, unapproved-font-family) as deterministic **risk**, active only with `--guide`. `design-harness loop --until 'deterministic-failures==0' --max-iters N`. Publish per-agent obedience benchmarks (with/without pack) before marketing any "reins" claim. Midjourney art-direction workflow doc (manual first, no CLI). |
| **v0.6** | Optional LLM copy judge (injectable seam in `audit-url.ts` post-measurement; opt-in flag; Toss 8-principles + error-message structure rubric; always emits a suggested rewrite). Gate: measured owner-vs-judge agreement on Korean samples BEFORE shipping. Localize report output for the copy family (Korean). Private beta on 3–5 real Korean products before any public launch. |

**Cut list (do NOT build now)**: MCP server (file contract `audit.json`/`report.md` is the canonical interface; capture layer is commoditized), best-of-N candidate picker, community fixture pipeline, interaction-simulation / below-fold sweep / pixel contrast, more than two agent surfaces (Claude Code + Codex only), a `guide from-references` VLM-distiller CLI (manual workflow must prove value first), Open Design integration.

## Korean copy check tiering (decided — do not re-litigate)

| Check | Tier | Notes |
|---|---|---|
| `placeholder-leak` ({{var}}, unrendered ICU, lorem, TODO) | deterministic **failure** | unambiguous broken rendering |
| `page-lang-missing`/`mismatch` | deterministic **failure** | WCAG 3.1.1/3.1.2 |
| Rendered josa hedge "을(를)"/"이(가)" | deterministic **risk** | detection is exact, but it is also a deliberate convention in Korean forms — never failure |
| `josa-batchim-mismatch` (via es-hangul rule `(code−0xAC00)%28` over Kiwi tokens) | deterministic **risk**, confidence medium | downgrade near Latin/digit-final tokens, brand names, interpolation seams |
| Korean line-break (`break-all` / missing `keep-all`) | deterministic **risk** | computed-style |
| Glossary/terminology consistency | deterministic **risk** | only when a project glossary is configured |
| Register mixing (해요체/합쇼체/반말 via Kiwi EF tags) | heuristic | only flag deviations from a configured per-surface register map; real products mix registers deliberately; exclude noun-form labels/headings |
| Object honorifics (사물존칭, e.g. "나오셨습니다") | heuristic | pattern list, high precision achievable |
| Translationese (번역투) lexicon | heuristic | versioned data file seeded from NIKL materials; always-wrong subset (이중피동, 사물존칭) flagged individually, density-scored subset (~을 통해, ~에 대하여) by frequency |
| Korean spelling (spellcheck-ko) | heuristic, **never failure** | agglutination false positives |
| Tone / naturalness / contextual fit | LLM judge, subjective, **needs-review only**, score-exempt | opt-in; rubric = Toss 8 principles + 상태→원인→해결 error structure; temp 0; absolute anchored rubric; never graded by the model that wrote the copy |

Copy extraction happens at render time (post-interpolation) from the live page — not from locale files — because josa/agreement errors only manifest after variable interpolation.

## Design invariants (from the research — carry into every decision)

- **Agents obey gates, not prose.** Anything that must hold goes into a machine-checked gate (loop exit condition, hook, CI); prose guidance is a prior-shifter, capped at ~2k tokens, MUST rules first.
- **One config artifact drives both directions**: `design-guide.yaml` / `copy-style.yaml` compile into the pre-generation pack AND parameterize the post-render checks. Guidance and verification must never drift apart.
- **Midjourney lapse test**: if the Midjourney subscription lapsed tomorrow, zero roadmap items may break. Midjourney is an optional art-direction input (explore direction → distill tokens → seed design-guide.yaml); images stay local-only.
- **No claims without measurement**: repair-and-rescore deltas before marketing the loop; owner-vs-judge agreement before shipping the Korean judge; false-positive dogfooding on real Korean products before any public Korean launch.
- **Halve milestones**: solo maintainer. Every release must end in a publishable, honestly-documented state (README claims must match npm reality — the v0.3.1 lesson).

## Process conventions

- Branch from `main` (`codex/...` or `claude/...`), one coherent slice per PR, review loop before merge. CI runs `release:check` + example-smoke.
- `.omx/` is git-ignored durable working state (plans, handoffs, goal ledgers). Read the newest `.omx/handoffs/*.md` when resuming; write one when handing off. Do not commit `.omx/` or `REPORT.md`.
- Verify before claiming done: `pnpm release:check` locally; for check changes, run the audit against the relevant good/bad fixtures and confirm expected findings appear (and good fixtures stay clean).
