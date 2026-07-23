# npm Execution

Design Harness publishes the runnable local audit, guide, and bounded-loop CLI from `@design-harness/cli`. The PR-comment and scenario-audit workflows are checkout-local recipes. The MCP manifest and dispatcher are checkout-local compatibility scaffolding, not a planned package API or server; the artifact files remain the canonical integration boundary.

For contribution work or checkout-local recipes, use the checkout flow:

```bash
pnpm install
pnpm build
pnpm design-harness -- audit --url http://localhost:3000 --out runs/demo
```

The published v0.6.1 CLI includes the bounded loop from the post-v0.6.0 maintenance train:

```bash
npx @design-harness/cli@0.6.1 loop \
  --url http://localhost:3000 \
  --out runs/repair-loop \
  --until deterministic-failures==0 \
  --max-iters 3 \
  --agent-cmd '<non-interactive command>'
```

The output path must be new, and only the exact `deterministic-failures==0` condition is accepted. N agent passes produce at most N+1 audits because the baseline comes first; a partial baseline or re-audit stops immediately with exit `2`. Exit `0` means already-clean/converged for that condition, `1` is an input/audit/agent/timeout/summary error, and `3` means no-progress or max-iters. The command is arbitrary shell code run with caller permissions and inherited environment, which may expose credentials; there is no sandbox or network boundary. See [Agent Loop Recipes](agent-loop.md) for fixed evidence variables, untrusted-evidence stdin, sanitized summary fields, and POSIX versus Windows termination behavior.

For the published v0.6.1 CLI, the pinned one-off audit flow is:

```bash
npx @design-harness/cli@0.6.1 --help
npx playwright install chromium
npx @design-harness/cli@0.6.1 audit --url http://localhost:3000 --out runs/demo
```

Parser-free copy CLI wiring is available since v0.4.4. Run it with the committed example config:

```bash
npx @design-harness/cli@0.6.1 audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --copy examples/configs/copy-style.ko-example.yaml
```

The CLI rejects unreadable, oversized, malformed, ambiguous, or schema-invalid config before launching Chromium or creating the output directory.

Guide compile/check has been available since v0.5.0. From inside the project that owns an explicit `design-guide.yaml`:

```bash
npx @design-harness/cli@0.6.1 guide compile \
  --guide ./design-guide.yaml \
  --target .

npx @design-harness/cli@0.6.1 guide check \
  --guide ./design-guide.yaml \
  --target . \
  --max-tokens 2000
```

Both commands require explicit local paths and perform no config or target discovery. `guide compile` owns only its marked spans and generated token file; `guide check` compares the same outputs without writing. Add `--copy ./copy-style.yaml` when the target also owns a compatible copy contract.

## Local Package Smoke Test

Maintainers can verify the packed CLI before publishing:

```bash
pnpm smoke:packed-cli
```

This browserless smoke test packs the four workspace packages, installs the CLI tarball into a temporary consumer project, resolves internal packages through local tarball overrides, checks audit/copy/guide/loop help, proves plain `audit` rejects `--agent-cmd` without launching it, exercises guide compile/check idempotence and drift, and verifies invalid copy and guide configs exit `1` without output artifacts. Its installed help command is:

```bash
pnpm exec design-harness --help
```

This catches broken `bin` entries, missing package files, and workspace dependency packaging mistakes before npm publish.

The browser-backed positive path is separate so `release:check` remains
browserless:

```bash
pnpm playwright:install
pnpm smoke:packed-loop
```

It creates another fresh consumer, pins that consumer to the checkout's
installed Playwright version, and runs `pnpm exec design-harness loop` from the
consumer. A consumer-local helper repairs one missing page language; the smoke
requires one agent pass, two audits, and convergence to zero deterministic
failures. The fixture, helper, server, and consumer are temporary. The validated
loop artifacts remain under `runs/packed-loop` for CI upload and local
inspection. CI runs this command only in the browser-equipped `example-smoke`
job.
