# Changelog

## Unreleased

- Reconciled release, install, roadmap, and integration documentation with the published v0.6.0 state; every entry below remains checkout-only and unreleased.
- Made DOM contrast measurement fail closed when `opacity`, `mix-blend-mode`, or `filter` on the measured element or an ancestor makes the painted result indeterminate, with exact coverage and live-fixture regression gates.
- Made current advisory scoring criterion-bounded with formula-discriminated v2 group membership, totals, and saturation while preserving validation of historical v1 artifacts under schema `0.2`.
- Added exact pre-cap cardinality for every reachable capped visual detector and one neutral audit-level notice when bounded finding samples are omitted.
- Added the unreleased bounded `design-harness loop` for the exact deterministic-failure gate, with fresh per-iteration artifacts, no-progress detection, an explicit timed agent-command boundary, sanitized atomic summaries, packed non-execution guards, and live repair/error smokes.

## 0.6.0 - 2026-07-23

- Added design-guide font-family adherence checks, including an explicit audit-only allowlist for intentional runtime families.
- Repaired DOM contrast measurement with both-channel alpha compositing, `oklab()` / `oklch()` conversion, and skip-on-unknown coverage; repaired tap-target spacing-exception handling; and added measurement-only layout metric distributions.
- Made report verdict and critique copy reflect the findings' actual epistemic composition, with the same copy guardrails enforced by the validation chain.
- Changed generated agent guidance to render semantic colors, dimensions, radii, and font stacks as CSS-usable literals while preserving machine-token output and source hashes.

Compatibility notes:

- `schemaVersion` remains `0.2`; additive contracts include the project-declared font-family criterion and optional layout metrics, with no enum change.
- Historical example artifacts retain the version of the producer that generated them.

## 0.5.0 - 2026-07-19

- Added explicit `design-harness guide compile` and zero-write `guide check` commands that derive marker-owned agent guidance and `design.tokens.json` from one local, schema-validated guide.
- Added the bounded `v0.5a-1` design-token profile, versioned prohibition catalog, optional safe copy-style projection, deterministic 2,000-token estimate ceiling, and a bounded Style Dictionary 5.5 compatibility smoke.
- Added fail-closed target containment, ownership, locking, staged commit, concurrent-change, rollback, and cleanup handling with source and packed-CLI regression coverage.

## 0.4.4 - 2026-07-18

- Added explicit parser-free copy analysis through `design-harness audit --copy <copy-style.yaml>` while preserving the visual-only default path.
- Added strict CLI-only YAML loading with bounded regular-file reads, UTF-8 and ambiguity checks, schema validation, and fail-closed errors before browser or artifact side effects.
- Added argument, loader, orchestration, packed-CLI, live-copy, calibration, and no-copy regression coverage for the public CLI path.

## 0.4.3 - 2026-07-14

- Made thrown navigation errors fail closed per viewport while preserving failure evidence and continuing later viewports.
- Recorded page cleanup rejections as partial failure evidence without discarding completed viewport output or aborting the audit loop.
- Restricted iteration prompts to deterministic failures and risks with stable priority ordering and a post-ordering five-finding cap.

## 0.4.2 - 2026-07-12

- Added `@design-harness/copy-audit` with five parser-free rendered-copy checks and programmatic `auditUrl({ copyStyle })` integration.
- Added the schema-backed copy-style contract and capture-neutral surface mapping with exact matcher provenance.
- Added synthetic Korean copy fixtures, fail-closed license/provenance validation, and a dedicated Chromium copy smoke.
- Added a six-fixture calibration gate with stable per-check TP/FP/FN output and CI artifact preservation.

## 0.4.1 - 2026-07-10

- Removed stale `v0.3` wording from the CLI help output while preserving the local HTTP(S) target policy.

## 0.4.0 - 2026-07-09

- Added schema version `0.2` for the v0.4a artifact contract.
- Added `content` rubric category support, text-inventory evidence, ARIA snapshot evidence, `project-contract` source strength, and `model-judged` runtime vocabulary.
- Added `advisoryScore.formulaVersion: "epistemic-weight-v1"` and evidence-tier score weights.
- Changed unclassified scoring fallback to downgrade to the heuristic-risk weight instead of full deterministic-failure weight.
- Changed ARIA snapshot capture to use Playwright locator snapshots for compatibility with the declared Playwright `^1.49.1` floor.
- Changed missing ARIA snapshot support to skip optional evidence instead of making the audit partial.
- Hardened password-value masking so plaintext values are not stored in DOM attributes while ARIA evidence is captured.
- Added validation guards for package/schema version lockstep and release-hook policy coverage.

Migration notes:

- Scores from `epistemic-weight-v1` are not directly comparable with scores produced before v0.4a.
- Audit consumers should accept `schemaVersion: "0.2"` and the new `text-inventory` / `aria-snapshot` evidence asset types.
