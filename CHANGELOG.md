# Changelog

## Unreleased

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
- Package versions remain unchanged until an owner-approved release/version step is performed.
