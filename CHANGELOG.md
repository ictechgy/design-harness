# Changelog

## Unreleased

No changes yet.

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
