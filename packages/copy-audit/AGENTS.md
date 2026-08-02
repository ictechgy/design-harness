# Copy-audit package instructions

Applies to `packages/copy-audit/`. Root `AGENTS.md` remains authoritative.

## Responsibility and boundaries

This package performs pure text analysis and may import only core plus its
declared morphology runtime. It does not capture pages, parse YAML, call hosted
services, read product config files, or own CLI behavior.

- `kiwi-nlp` stays pinned, dynamically/lazily loaded behind the copy path, and
  never statically vendored. Record the npm/repository LGPL declaration
  discrepancy rather than inventing a resolution.
- Never add hanspell, py-hanspell, Pusan, Naver, or Daum spellcheck endpoints.
  Hosted spelling providers are explicit opt-in integrations, never defaults.
- `spellcheck-ko` code/data is not bundled. Any future use requires a separate,
  explicit prepare step and license review.
- Parser-dependent analysis is heuristic. Only facts proven directly from the
  rendered string and explicit project config may use deterministic risk.

## Korean tier decisions

| Check family | Maximum tier |
|---|---|
| Placeholder leak; page `lang` missing | deterministic failure |
| Rendered josa hedge; `break-all`; configured glossary | deterministic risk |
| Parser-confirmed josa mismatch; register mixing; translationese | heuristic risk / needs-review |
| Spelling unknown words | heuristic risk, never failure |
| Object honorifics, tone, naturalness, contextual fit | opt-in judge, needs-review, score-exempt |

Do not infer a page-language mismatch without an explicit locale declaration.
`noun-form` is valid for labels/fragments. Digit, Latin, symbol-final, brand, and
interpolation boundaries do not justify guessed batchim findings.

## Verification

```bash
pnpm --filter @design-harness/copy-audit typecheck
pnpm --filter @design-harness/copy-audit test
pnpm smoke:copy
pnpm calibrate:fixtures
```

When morphology/model behavior changes, also run the exact-model smoke and the
licensed calibration gates documented in `docs/agent-protocol.md`.
