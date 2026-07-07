# Roadmap — Canonical Milestone Specs

How to read this file:

- Authority on conflict: owner's current-session instruction > `AGENTS.md` > this file and the other committed docs > git-ignored local notes > your judgment.
- **Current milestone: v0.3.2.** Work only inside the current milestone; out-of-scope ideas go to `.omx/ideas.md` as one line.
- Maintenance rule: any PR that changes scope, conventions, or architecture updates this file (and `AGENTS.md` if a rule changed) in the same PR.
- Common definition of done for every milestone: `CI=true pnpm release:check` passes, new checks ship with good/bad fixtures, docs updated, handoff written (`docs/agent-protocol.md`), README claims match npm/code reality.

## v0.3.2 (current) — ship, de-bias, gather evidence

1. **npm publish + GitHub release** — DONE 2026-07-07 (v0.3.1 on npm: core, visual-audit, cli; tag + release published; `pnpm dlx @design-harness/cli@0.3.1 --help` verified).
2. **CJK de-bias** — DONE 2026-07-07 (`korean-line-length-good/bad.html`, `korean-status-good/bad.html` fixtures verify the acceptance criteria below; English fixture results unchanged):
   - `excessive-line-length` (~L543): "majority-CJK" is defined as >50% of non-whitespace code points in the Hangul (`가-힯`, `ᄀ-ᇿ`), CJK (`⺀-鿿`), or full-width (`　-ヿ`) ranges. Majority-CJK text uses char-width factor ~1.0 (else keep 0.52) with a CJK band of 40–45 chars/line. While here, calibrate the Latin band to 50–75 cpl (55 optimum) and add Dyson & Haselgrove 2001 as a sourceRef — do not duplicate this into v0.4.
   - `status-live-region-risk` (~L634): replace the English-only regex with a language-keyed keyword table adding 로딩 중, 저장 중, 저장됨, 완료, 실패, 오류, 처리 중, 불러오는 중.
   - Acceptance (fixture-backed, exact counts): `korean-line-length-good.html` emits zero `excessive-line-length` findings; `korean-line-length-bad.html` emits exactly one; a Korean "저장 중..." fixture without a live region triggers `status-live-region-risk`; all existing English fixture results unchanged.
3. **`page-lang-missing` check** — new criterion `a11y.language.page-lang` (WCAG 3.1.1, official-testable, deterministic, resultKind failure, runtime static-dom). Full 7-step check path (criterion → measurement → check → fixtures → tests). Scope note: `lang` *mismatch* is deterministic only against an explicit declaration (`--locale` flag or config, `project-contract` source) — never via automatic language inference; the inference variant is out of scope.
4. **Finding-rich example report** — commit a real audit run of `semantic-a11y-bad.html` under `examples/reports/semantic-a11y-bad/` (NOT any directory named `runs/` — git-ignored), link from README.
5. **Claude Code skill port** — `adapters/claude-code-skill/` mirroring `adapters/codex-skill`. Parity mechanism: move shared agent rules into `adapters/shared/` canonical snippets; extend `scripts/check-agent-recipes.mjs` to compare normalized shared-rule content across both adapters, with an `intentional-differences` manifest as the only escape hatch.
6. **Codex repair-and-rescore rerun** — repeat the 2026-07-07 experiment (Claude tiers all repaired 0→100 from report.md alone) with Codex as executor, plus a more realistic page (merchant-dashboard with injected defects). No "model-agnostic" obedience claims anywhere until this exists.
7. **axe-core pin** — if any dependency-touching PR happens, pin axe-core >= 4.12.1 (target-size / aria-allowed-attr false-positive fixes).

## v0.4 — text evidence + Korean deterministic core

Capacity note: v0.4 ships as **two publishable slices** — v0.4a (items 1–3: ADR + schema/enum work + text evidence + scoring fix) and v0.4b (items 4–7: copy-audit package, fixtures, calibration runner). Each slice ends releasable; do not hold 4a hostage to 4b.

1. **ADR-001 first** (`docs/adr/ADR-001-copy-audit-foundations.md`), pre-settled content — do not re-litigate, just formalize:
   - New CheckRuntime value: `model-judged` (not `text-analysis`, not `llm-review`).
   - New SourceStrength value: `project-contract` — checks backed by the project's own declared config (design-guide.yaml, copy-style.yaml); asserts "violates YOUR declared contract", never universal quality.
   - **Policy matrix (exhaustive — anything not listed is disallowed)**: `official-testable` + deterministic → failure or risk · `project-contract` + deterministic → risk (max) · `official-pattern`/`industry-heuristic` + heuristic → risk or needs-review · `research-emerging` + heuristic → risk or needs-review · any source + subjective (incl. `model-judged` runtime) → needs-review only. `placeholder-leak` emits failure under `official-testable` via the ICU MessageFormat spec (unrendered syntax is definitionally broken rendering), not under project-contract.
   - Add `check:criteria-policy` (small script or core test): validate every registry entry against this matrix — `integrity.ts` only blocks heuristic/subjective failures at the finding level, not sourceStrength combinations at the criterion level.
   - Scoring: needs-review findings score-exempt; deductions weighted deterministic-failure 1.0 / deterministic-risk 0.6 / heuristic-risk 0.25 / needs-review 0. Scoring schemaVersion note.
   - Criterion metadata: every a11y criterion carries its WCAG 2.2 SC id (and KWCAG 2.2 clause where applicable) machine-readably in CRITERION_SOURCES, so future WCAG 3.0 / KWCAG remaps are mechanical. WCAG 3.0 stays watch-only (CR projected ≥ Q4 2027).
2. **Schema consolidation in the same PR as the `content` category** — keep `scripts/check-enum-lockstep.mjs` green while adding the category across all 6 locations. Definition: **`content` = rendered language, terminology, interpolation, and copy-style findings; `implementationAreaFor` maps it to area "content"**. Prefer generating schema enums from types or strengthening the drift test.
3. **Text evidence**: page-wide text inventory collector in the `page.evaluate` closure (per-leaf-block `{selector, text, region, fontSize, fontWeight, nearest lang, tag, role, accessibleName}`) → `ViewportMeasurements.textInventory`; `page.ariaSnapshot()` per viewport; new EvidenceAssetTypes `text-inventory`, `aria-snapshot`. Normalization/privacy rules: exclude password/hidden inputs, normalize whitespace, cap stored text at ~2000 chars/node with `truncated: true` recorded, dedupe against ancestors.
4. **`@design-harness/copy-audit`** — pure `analyzeCopy(textInventory, copyStyle) -> Finding[]`; deps kiwi-nlp (LGPL; lazy-load only when `--copy` is passed; enable typo-correction mode; expose user-dictionary hook for brand terms), es-hangul (MIT). Korean spelling is a **separately-enabled provider**: spellcheck-ko dict is fetched only by an explicit documented prepare step (never silently inside `--copy`); absent dict → spelling checks skip with a notice, never fail the audit. Checks and tiering per the AGENTS.md table, with these pass-2 precision guards:
   - `josa-batchim-mismatch`: **heuristic risk** (Kiwi-parser-dependent segmentation; the docs' own rule — full-parse checks inherit ~86.5% analyzer accuracy — forbids deterministic tier). A deterministic-risk subset is allowed only where the particle attachment is provable from raw text without parser segmentation (Hangul-final token immediately followed by a particle from a closed list). SKIP digit/Latin/symbol-final tokens; require kiwi-nlp `J*` POS confirmation. Optional later: digit/Latin reading table (3→삼, MP3→쓰리).
   - `register-mix`: hard-exclude strings with no sentence-final ending (noun fragments, labels, button text). Do not adopt kcbert-formal-classifier (binary only, no 해요체/합쇼체 split, no published accuracy, Python-only).
   - Object honorifics (사물존칭): **dropped from copy-audit v1** — no dataset or detector exists; NIKL states the 간접존대 boundary is undefined; goes to the v0.6 LLM-judge rubric only.
   - `korean-spelling`: hunspell unknown-word hits are risk-tier only, suppressible via per-project dictionary. Bareun.ai may be documented as an opt-in commercial provider — never a default (lapse test).
   - `translationese-lexicon`: no calibration corpus exists anywhere (verified 2026-07); ship with per-pattern suppression config and log match rates in audit.json for post-hoc precision estimation; needs-review only. Always-wrong subset: 이중피동 (not 사물존칭).
   - Docs: map check ids onto the KAGAS 14-type Korean error taxonomy; add a static docs-level mapping from copy findings to MQM 2.0 categories/severities (no schema change).
5. **copy-style.yaml v1** (`packages/core/schemas/copy-style.schema.json`): locale, per-surface register map (button/error/marketing → 해요체|합쇼체|명사형), glossary with typed term tiers (approved / banned / use-carefully — Writer.com model) and lemma-aware matching, bannedPhrases, josaHedgePolicy (flag|allow). **Surface mapping is part of this schema**: a documented DOM→surface table (e.g. `button`/`[role=button]`/`a.btn` → button; `[role=alert]`/`aria-live`/`.error` → error; headings/hero copy → marketing; default → body) resolves each text-inventory node to a surface — register checks stay silent for nodes that resolve to no configured surface.
6. **Korean fixtures + calibration datasets (license-tiered)** — every committed Korean fixture/calibration file gets a provenance entry (source, license, redistribution status, synthetic/derived flag) in a dataset manifest validated in CI:
   - In-repo (redistributable): synthetic josa gold suite (exhaustively generated — the rule is phonological); IWSLT2023 EN-KO formality test set (CDLA-Sharing-1.0) for register calibration; `examples/ui-quality-fixtures/korean/copy-good.html`/`copy-bad.html` (owner reviews the Korean text as native speaker).
   - Internal-only (NEVER commit): NIKL corpora (application-gated, no redistribution, no LLM augmentation), 말평 어문규범 RAG data, SmileStyle (CC-BY-NC-4.0), K-NCT (no license — ask authors). When in doubt, generate synthetic.
   - Every copy criterion carries ≥1 bad→improved example pair with a reason.
7. **Calibration runner** — `scripts/run-calibration.mjs`: serve each fixture → audit → diff vs manifest `expectedFindings`/`shouldNotFlag` → `calibration-summary.json` (per-checkName TP/FP/FN) → non-zero exit on drift; wire as `pnpm calibrate:fixtures` in CI. Split `shouldNotFlag` validation into registry-backed vs declared future-criterion.

## v0.5 — reins (gates + pack) + evidence-backed visual metrics

1. **`design-harness guide compile`** — inputs `design-guide.yaml` (+ optional copy-style.yaml): 4–6 semantic color tokens, one font pairing, spacing/radius scale, prohibition list (versioned `datasets/slop-fingerprints.json`), one signature-element sentence. Token ingestion/emission standardized on DTCG v2025.10 / style-dictionary v5 formats.
   - **Delivery order (measured, not aesthetic)**: primary = inline AGENTS.md section + CLAUDE.md `@import` shim; DESIGN.md as file artifact; Claude skill optional secondary only (Vercel: inline 100% vs skill 79%, skills un-invoked in 56% of cases). Include explicit trigger phrases. Generated blocks in user AGENTS.md/CLAUDE.md files live between strict markers (`<!-- design-harness:guide:begin/end -->`), are replaced idempotently, never touch content outside the markers, and pass a sanitizer — the compiler is editing high-authority instruction files.
   - Pack entries use name / one-line description / bad→good example pair structure (Ditto's finding: LLMs follow example-pair rules, invert conflicting prose); compile-time contradiction check across rules; ≤2k-token cap enforced by a CI guard (`guide check --max-tokens`).
   - Security: if guide compile ever ingests third-party AGENTS.md/CLAUDE.md/reference files, treat them as UNTRUSTED input — quote/sanitize; never splice into an instruction stream (ghostty ships a honeypot proving agents execute these files literally).
2. **Token-adherence checks** (rendered layer only): off-palette-color, off-scale-spacing, unapproved-font-family from computed styles vs the declared tokens — deterministic **risk**, source `project-contract`, active only with `--guide`, with allowlist config for third-party widget selectors. For token-FILE linting, evaluate integrating/shelling out to Terrazzo's MIT `tz lint` (contrast, min font size, naming, light/dark modes) before building anything.
3. **Evidence-backed visual metrics slice** (droppable as a unit — first cut if v0.5 overruns; pack lines and checks ship together or slip together):
   - `typography.variant-count.budget` (distinct face+size+weight+style combos; Ivory/Sinha/Hearst CHI 2001), `color.palette.count-discipline` (distinct colors + hue-family clustering, flag > ~3–4 chromatic families; O'Donovan 2011), `layout.density.complexity-budget` (visible-element + text-cluster counts; penalize HIGH only — inverse-linear per Miniukovich CHI 2020). All heuristic risk, configurable budgets, sources per `docs/research/visual-metrics-evidence.md`.
   - Matching guidance-pack lines (same registry entries): limit palette to 2–3 chromatic hue families with clear lightness contrast; keep density restrained (high complexity is the largest measured appeal penalty); align block edges to shared grid lines.
   - Deferred to backlog: whitespace-ratio band (single-study threshold), alignment/grid-quality metric.
4. **`design-harness loop`** — `--until 'deterministic-failures==0' --max-iters 3 --agent-cmd '<cmd>'`; no-progress detection (2 identical consecutive finding sets → stop); per-iteration artifacts; `loop-summary.json`. Heuristic/needs-review findings never gate the loop.
5. **Obedience benchmark before any "reins" marketing** — per-agent (Claude tiers + Codex) × delivery mechanism (inline AGENTS.md section vs skill vs no pack), repair-and-rescore protocol; publish in `docs/benchmarks/`.
6. **Midjourney art-direction workflow** — `docs/midjourney-reference-lab/art-direction.md`, manual first (explore → distill tokens → seed design-guide.yaml); a CLI command only after the owner has used the manual workflow on a real project. Images stay local-only.

## v0.6 — Korean LLM judge + private beta

1. **Judge seam**: `AuditUrlOptions.judge?: (evidence: {screenshotPath, textInventory, ariaSnapshot, viewport, brief?, copyStyle?}) => Promise<Finding[]>` at the post-measurement point; no default (zero-network preserved); mockable.
2. **Judge contract**: G-Eval form-filling (tone / register-fit per surface / contextual fit / terminology / naturalness, each 0–1), temperature 0, absolute anchored rubric, promptfoo-style `{pass, score, reason}` + mandatory `suggestedRewrite`; never graded by the model that wrote the copy; audit.json records model id + prompt hash + gating decision. Rubric = Toss 8 principles + component conventions (error = 상태→원인→해결; empty state = next action; confirm dialog = outcome predictable from button text) + 사물존칭 detection (moved here from v0.4).
3. **Cost gating (Phrase QPS pattern)**: judge runs only on surfaces that changed since the last audit or that tripped cheap deterministic/heuristic gates — never everything every run. Change detection: baseline = the prior run's `audit.json` (path passed via `--baseline <dir>`; absent baseline → all surfaces are "changed"); surface identity = hash of `selector + normalized text`; the gating decision per surface is recorded in audit.json.
4. **Launch gates, fixed order**: ① owner-vs-judge agreement measured on ≥50 owner-labeled Korean samples — hold if < 80% and iterate the rubric; ② Korean report output for the copy family; ③ private beta on 3–5 real Korean products with false-positive logging; ④ only then public launch + README.ko.md. Document the privacy implication (unreleased copy/screenshots go to a hosted model).
5. **Korean market slice**: KWCAG 2.2 mapping table in registry docs, citing 디지털포용법 (effective 2026-01-22, 50+-employee private companies) as the compliance driver; one new deterministic check axe lacks — KWCAG 2.1.3 minimum touch-target (6mm diagonal, documented px-per-mm assumption, deterministic risk). Second cut if v0.6 overruns.

## Backlog (evidence recorded — do not build without reopening)

- Docs claim checker: CI flag for percentages/benchmark claims in committed docs that don't cite `docs/benchmarks/` or an experiment record.
- Release-approval convention for non-hookable agents: a `docs/releases/vX.Y.Z-approval.md` file (owner-authored) as the CI-checkable evidence that a release was approved.

- Whitespace-ratio band (Coursaris 2012, single-study >50% harm threshold) and alignment/grid-quality (Miniukovich 2015) — see visual-metrics evidence doc.
- Error-message checks: length threshold, loanword/jargon density, sentence complexity (CHI 2021 measured predictors) — deferred from v0.4 on capacity; partially covered by the v0.6 judge rubric.
- textlint-compatible output adapter (textlint 15.x alive, zero Korean rules) — cheap editor-ecosystem surface; never a full plugin.
- plainkorean.kr 쉬운 우리말 사전 as loanword→plain-Korean data source (license review first).
- Claude Design handoff bundles as audit reference input.
- Figma Code Connect "expected vs rendered component" check.
- Label-vs-destination check (Caption, UIST 2025: next-screen context improves label accuracy) — the only recorded evidence for narrowly reopening interaction-simulation.
- OmniScore-style small learned scorer as a middle tier between heuristics and the LLM judge.
- Pixel-tier metrics via Aalto Interface Metrics (reuse, don't reimplement).

## Watch list (no action)

Markup AI (ex-Acrolinx) agent distribution via MCP/Cursor/GitHub Actions — main "reins" convergence threat; HIG Doctor packaging pattern (audit CLI + MCP + skills); WCAG 3.0 draft (~174 outcomes, CR ≥ Q4 2027); Chrome DevTools MCP as user-side capture alternative (docs note only).

## Cut list (with why)

- MCP server — capture layer is commoditized (playwright-mcp, chrome-devtools-mcp); the file contract (audit.json/report.md) is the canonical interface.
- Best-of-N candidate picker; community fixture pipeline (users follow demos, contributors follow users); more than two agent surfaces (Claude Code + Codex).
- Interaction-simulation / below-fold sweep / pixel contrast — serves neither goal now (Caption evidence recorded in backlog).
- `guide from-references` VLM-distiller CLI before the manual workflow proves value.
- Open Design integration (spec-only).
- **Evidence-against (peer-reviewed) — do not build**: hue-template color-harmony scoring (O'Donovan: no predictive power; 52% inter-rater agreement — use lightness-contrast structure instead); mirror-symmetry/balance scoring for real UIs (validates only on abstract stimuli); scored Korean readability (KRIT 0.746 on long-form textbook text; nothing validated for short strings — raw informational metrics at most); MQM translation-accuracy LQA product (owned by Lokalise/Phrase/Crowdin); Figma-plugin surface (crowded); generic English style-guide enforcement (Writer/Markup AI); Bareun or any hosted API in default paths (lapse test).
