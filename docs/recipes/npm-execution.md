# npm Execution

Design Harness publishes the runnable local audit and guide CLI from `@design-harness/cli`. The PR-comment, scenario-audit, and MCP adapter workflows are checkout-local recipes until they are promoted to package APIs.

Before the first npm publish, use the checkout flow:

```bash
pnpm install
pnpm build
pnpm design-harness -- audit --url http://localhost:3000 --out runs/demo
```

After publish, the intended one-off audit flow is:

```bash
npx @design-harness/cli@0.5.0 --help
npx playwright install chromium
npx @design-harness/cli@0.5.0 audit --url http://localhost:3000 --out runs/demo
```

Parser-free copy CLI wiring is available since v0.4.4. Run it with the committed example config:

```bash
npx @design-harness/cli@0.5.0 audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --copy examples/configs/copy-style.ko-example.yaml
```

The CLI rejects unreadable, oversized, malformed, ambiguous, or schema-invalid config before launching Chromium or creating the output directory.

Guide compile/check is available in v0.5.0. From inside the project that owns an explicit `design-guide.yaml`:

```bash
npx @design-harness/cli@0.5.0 guide compile \
  --guide ./design-guide.yaml \
  --target .

npx @design-harness/cli@0.5.0 guide check \
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

The smoke test packs the four workspace packages, installs the CLI tarball into a temporary consumer project, resolves internal packages through local tarball overrides, checks audit/copy/guide help, exercises guide compile/check idempotence and drift, and verifies invalid copy and guide configs exit `1` without output artifacts. Its installed help command is:

```bash
pnpm exec design-harness --help
```

This catches broken `bin` entries, missing package files, and workspace dependency packaging mistakes before npm publish.
