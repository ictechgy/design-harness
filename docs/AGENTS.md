# Documentation instructions

Applies to `docs/`. Root `AGENTS.md` remains authoritative.

- `docs/ROADMAP.md` is the canonical milestone and cut-list record.
  `docs/agent-protocol.md` owns procedure; `docs/criteria-and-checks.md` owns
  criterion policy. Keep each fact in its authoritative document and link to it
  rather than duplicating long sections.
- New source strengths, runtimes, capture surfaces, or architecture boundaries
  need a short ADR before implementation.
- Public claims must match released npm/code reality. Changing README
  positioning or publishing externally requires owner approval.
- Every quantitative claim cites a tracked experiment/benchmark in the same or
  preceding paragraph. State sample size, baseline, scope, and limitations; do
  not reuse an on-target result as a general claim.
- Use scoped language: “in the captured scope,” “risk,” “needs review,” and
  “no deterministic failures observed.” Never write unqualified compliance,
  accessibility, design-quality, or launch-readiness claims.
- Historical reports retain their producer version and full artifact set.
  Regenerate together or leave them untouched.
- Do not treat ignored `.omx` or `REPORT.md` notes as publishable evidence until
  they are reviewed and promoted into a tracked artifact.

For docs-only changes, resolve local links and run:

```bash
pnpm check:docs-claims
pnpm check:report-copy-guardrails
pnpm check:tracked-hygiene
```
