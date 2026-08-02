# Core package instructions

Applies to `packages/core/`. Root `AGENTS.md` remains authoritative.

## Responsibility

Core owns capture-neutral contracts: criteria, types, schemas, integrity,
scoring, report rendering, guide compilation, and shared validation. It must not
import Playwright, DOM/capture libraries, YAML, filesystem orchestration, or any
other workspace package.

## Invariants

- `heuristic` and `subjective` findings can never be `failure`; keep
  `integrity.ts`, criterion source policy, scoring, and report wording aligned.
- Project-contract criteria cap at deterministic `risk`. Exact arithmetic does
  not promote research-derived heuristics.
- `RubricCategory`, source-strength/runtime/evidence enums, schemas,
  `rubric.yaml`, and implementation-area mappings move in lockstep. New source
  strengths or runtimes require an ADR first.
- Report verdicts must reflect actual finding composition. Assets are referenced
  by path/manifest, never inlined into `report.md`.
- Guide compiler output must be deterministic. Marker ownership, budgets,
  contradictions, and sanitization fail closed.

## Verification

Run focused core tests first, then:

```bash
pnpm --filter @design-harness/core typecheck
pnpm --filter @design-harness/core test
pnpm --filter @design-harness/core validate
pnpm check:criteria-policy
pnpm check:enum-lockstep
pnpm check:core-purity
```

Schema, report, or guide-contract changes also require the matching full
verification row in `docs/agent-protocol.md` and `CI=true pnpm release:check`.
