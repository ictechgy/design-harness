# AGENTS.md — Working Guide for AI Agents

Design Harness is an open-source, model-agnostic UI/UX QA loop for AI coding agents: local URL → Playwright screenshots → source-backed checks → `audit.json` / `report.md` → coding agent fixes. Monorepo: `@design-harness/core` (criteria, schemas, scoring, report), `@design-harness/visual-audit` (browser measurements + checks), `@design-harness/cli`. Published on npm since v0.3.1.

**Authority on conflict**: owner's current-session instruction > this file > committed docs (`docs/ROADMAP.md`, `docs/agent-protocol.md`, `docs/criteria-and-checks.md`) > git-ignored local notes (`REPORT.md`, `.omx/`) > your judgment. Every MUST lives in this file or in a machine check; `REPORT.md` (Korean strategy rationale) and `.omx/` are optional background — never block on their absence, and if you find a MUST that exists only there, promote it here.

## HARD RULES (never violate)

1. **Epistemic discipline is the product.** A finding with `determinism: heuristic` or `subjective` may NEVER have `resultKind: failure` (enforced at finding level by `packages/core/src/integrity.ts`, at criterion level by `check:criteria-policy` per ADR-001 — do not weaken either). Deterministic `failure` language is reserved for official-testable sources (WCAG 2.2), including determinations resolved by explicit project-declared config (`lang` vs `--locale`); `project-contract`-sourced criteria cap at deterministic `risk` (ADR-001 matrix). **Computation determinism never upgrades criterion strength**: exactly countable metrics (colors, font variants, density) with research-grade criteria stay heuristic risk — see `docs/criteria-and-checks.md`. When unsure, downgrade.
2. **No npm publish, version bump, tag, or GitHub release without the owner's explicit approval in the current session.** Publish order: core → visual-audit → cli. *Enforced for Claude Code by a PreToolUse hook (`.claude/settings.json` → `scripts/hooks/block-release-commands.mjs`). For Codex no hook exists: Codex agents must not run publish/version/tag/release commands at all — ask the owner to run them, unless the owner approves the exact command text in the current session.*
3. **Never commit generated Midjourney images** or binaries from `datasets/midjourney-reference-lab/local-assets/`. *Enforced: `check:midjourney-policy`, `check:tracked-hygiene`.* Distilled token files derived from images are fine.
4. **Never add hanspell / py-hanspell / Pusan / Naver / Daum spellcheck endpoints** as dependencies or defaults (ToS-restricted, breakage history). Bareun and other hosted APIs: opt-in provider only, never a default path. *Enforced: `check:deps-policy`.*
5. **License hygiene (Korean copy stack)**: `kiwi-nlp` is LGPL (npm metadata says LGPL-2.1-or-later; its repo README says LGPL v3 — trust the npm declaration, record the discrepancy). Never statically vendor it; lazy-load behind the `--copy` flag. The `spellcheck-ko` dictionary is GPL-3.0 project / CC-BY-SA-4.0 data — never bundled; fetched only via an explicit, documented prepare step (opt-in spelling provider), not silently inside `--copy`. *Enforced in part: `check:deps-policy`.*
6. **Calibration-data licensing (prose-only, legal)**: never commit fixtures derived from gated or non-commercial corpora — NIKL 모두의 말뭉치 / 말평 data (no redistribution, no LLM augmentation), SmileStyle (CC-BY-NC-4.0), K-NCT (unlicensed). Redistributable: IWSLT2023 EN-KO (CDLA-Sharing-1.0) and synthetic generation. When in doubt, generate synthetic Korean data.
7. **No hosted LLM in any required path.** Judge features are opt-in (injectable callback / explicit flag), emit `needs-review` findings only, are score-exempt, and record model ID + prompt hash in `audit.json`.
8. **Audit targets stay local HTTP(S)** (`assertLocalHttpUrl`, `packages/core/src/input-policy.ts`). Do not widen.
9. **Report copy guardrails**: never claim "WCAG compliant", "accessible", "good design" etc. unqualified (`validateReportCopyGuardrails` in `packages/core/src/report.ts`). Scoped phrasing only — in reports AND public docs.
10. **Enum lockstep**: `RubricCategory` is duplicated across `types.ts`, 3 JSON schemas, `rubric.yaml`, and `implementationAreaFor`. *Enforced: `check:enum-lockstep` — if the script and this sentence disagree, the script wins.* New source-strength kinds or check runtimes need a short ADR in `docs/adr/` first (ADR-001 added runtime `model-judged` and source strength `project-contract`; its policy matrix is enforced by `check:criteria-policy`).
11. **Do not build cut-list items** (see Roadmap section below) without the owner explicitly reopening them.

## Ask the owner first (never proceed alone)

npm publish / version tags / GitHub releases / any external publication · adding a runtime dependency (especially networked) · schema or enum changes not in the current milestone spec · reopening any cut-list item · new deterministic+failure combinations outside the existing matrix · changing positioning or claims in public docs (README).

## Commands

```bash
pnpm install && pnpm build          # build workspace (core → visual-audit → cli)
pnpm test                           # all package tests (CI=true for non-interactive)
pnpm release:check                  # build + typecheck + test + validate + pack + smoke
pnpm validate                       # schemas, manifests, policy + guard scripts below
pnpm check:enum-lockstep            # category enum in lockstep across 6 locations
pnpm check:criteria-policy          # criterion registry vs ADR-001 policy matrix
pnpm check:deps-policy              # ToS/GPL dependency policy
pnpm check:tracked-hygiene          # local-only files untracked; AGENTS.md line budget
pnpm example:serve                  # merchant-dashboard fixture on :4173
pnpm design-harness -- audit --url http://localhost:4173 --out runs/demo
```

Playwright Chromium missing → `pnpm playwright:install`. Partial audits exit `2` unless `--allow-partial`. CI runs `--frozen-lockfile`: any new dependency requires a lockfile change — this is also the slopsquatting guard (5–22% of LLM-recommended packages don't exist).

## Adding a check (the established 7-step path)

Criterion in `packages/core/src/criteria.ts` (with `CRITERION_SOURCES` entry) → measurement fields in `ViewportMeasurements` (`packages/visual-audit/src/checks.ts`) → browser evidence in `browser-measurements.ts` (single `page.evaluate` closure) → `findingsFromMeasurements` mapping → good/bad fixture pair in `examples/ui-quality-fixtures/` (one defect per detector) → unit tests → `pnpm release:check`. Details and registry policy: `docs/criteria-and-checks.md`.

## Roadmap

**Current milestone: v0.4a** — ADR-001 (`model-judged` runtime, `project-contract` source strength, policy matrix, `check:criteria-policy`, scoring weights), `content` category + schema/enum consolidation, page-wide text inventory + ariaSnapshot evidence, axe-core >= 4.12.1 pin. Full specs and acceptance criteria: **`docs/ROADMAP.md`** (committed, canonical). Do not start a future milestone without reading its spec there. (v0.3.2 completed 2026-07-08.)

**Cut list (do NOT build now)**: MCP server (file contract `audit.json`/`report.md` is canonical; capture is commoditized) · best-of-N picker · community fixture pipeline · interaction-simulation / below-fold sweep / pixel contrast · more than two agent surfaces (Claude Code + Codex) · `guide from-references` CLI before the manual workflow proves value · Open Design integration · **evidence-against, do not build**: hue-template color harmony, symmetry/balance scoring for real UIs, scored Korean readability, MQM translation LQA, Figma-plugin surface, generic English style-guide enforcement (details: `docs/ROADMAP.md` cut list).

## Korean copy check tiering (decided — do not re-litigate)

| Check | Tier | Notes |
|---|---|---|
| `placeholder-leak` ({{var}}, unrendered ICU, lorem, TODO) | deterministic **failure** | unambiguous broken rendering |
| `page-lang-missing` | deterministic **failure** | WCAG 3.1.1; `lang` mismatch is deterministic ONLY against an explicit declaration (`--locale` / config), never via language inference |
| Rendered josa hedge "을(를)"/"이(가)" | deterministic **risk** | pure regex, no parser; also a deliberate Korean form convention — never failure; configurable via `josaHedgePolicy` |
| `josa-batchim-mismatch` | **heuristic** risk | Kiwi-parser-dependent segmentation → heuristic (rule 1 corollary below). Deterministic risk allowed ONLY for the parser-free subset: Hangul-final token + particle provable from raw text. SKIP digit/Latin/symbol-final tokens; require `J*` POS confirmation |
| Korean line-break (`break-all` / missing `keep-all`) | deterministic **risk** | computed-style |
| Glossary/terminology (typed term tiers: approved/banned/use-carefully) | deterministic **risk** | only when a project glossary is configured |
| Register mixing (해요체/합쇼체/반말 via Kiwi EF tags) | heuristic | only against a configured per-surface register map; hard-exclude strings with no sentence-final ending (labels, fragments, buttons) |
| Object honorifics (사물존칭) | **LLM judge only** (v0.6, needs-review, score-exempt) | re-tiered 2026-07-07: no dataset or detector exists; NIKL calls the 간접존대 boundary undefined; no rule check in copy-audit v1 |
| Translationese (번역투) lexicon | heuristic, needs-review | versioned data seeded from NIKL materials; always-wrong subset = 이중피동; no calibration corpus exists — log match rates in audit.json, per-pattern suppression |
| Korean spelling (spellcheck-ko) | heuristic, **never failure** | unknown-word hits = risk with per-project dictionary (brand names/neologisms dominate) |
| Tone / naturalness / contextual fit | LLM judge, subjective, **needs-review only**, score-exempt | opt-in; Toss 8 principles + 상태→원인→해결 rubric; temp 0; never self-graded; always emits `suggestedRewrite` |

Copy extraction happens at render time (post-interpolation) from the live page — not from locale files — because josa/agreement errors only manifest after variable interpolation. Any check requiring a full morphological parse of informal text inherits Kiwi's ~86.5% web-text accuracy and cannot be deterministic-tier.

## Design invariants

- **Agents obey gates, not prose.** Anything that must hold becomes a machine check (loop exit, hook, CI); prose guidance is a prior-shifter capped at ~2k tokens, MUST rules first.
- **Precision over recall in every heuristic tier.** False positives cause banner blindness and kill trust (Ditto's measured lesson). Unproven-precision checks ship informational/logged-only.
- **One config artifact drives both directions**: `design-guide.yaml` / `copy-style.yaml` compile into the pre-generation pack AND parameterize the post-render checks — guidance and verification never drift apart.
- **Midjourney lapse test**: if the subscription lapsed tomorrow, zero roadmap items may break.
- **No claims without measurement**: obedience benchmarks before "reins" marketing; owner-vs-judge agreement (≥80% on ≥50 samples) before the Korean judge ships; false-positive dogfooding on real Korean products before any public Korean launch.
- **Halve milestones.** Solo maintainer. Every release ends publishable with README claims matching npm/code reality.

## Process

- Session protocol: (1) newest `.omx/handoffs/*.md` if present; (2) `git log --oneline -5` + `git status`; (3) current milestone only — out-of-scope ideas go to `.omx/ideas.md`, never code; (4) verify before claiming done (matrix in `docs/agent-protocol.md`); (5) write a handoff before ending. Never list unverified work as Done.
- Branch from `main` (`codex/...` or `claude/...`), one coherent slice per PR, review before merge. CI runs `release:check` + example-smoke.
- **Maintenance rule**: any PR that changes a convention, command, check pipeline, or architecture updates this file and/or `docs/ROADMAP.md` in the same PR. This file has a 150-line CI budget (`check:tracked-hygiene`) — a budget, not science; move detail to the committed docs instead of growing this core.
- Full protocol, anti-drift table, verification matrix, handoff/experiment formats: `docs/agent-protocol.md`.
