# npm Execution

Design Harness publishes the runnable audit CLI from `@design-harness/cli`. The PR-comment, scenario-audit, and MCP adapter workflows are checkout-local recipes until they are promoted to package APIs.

Before the first npm publish, use the checkout flow:

```bash
pnpm install
pnpm build
pnpm design-harness -- audit --url http://localhost:3000 --out runs/demo
```

After publish, the intended one-off audit flow is:

```bash
npx @design-harness/cli@0.4.3 --help
npx playwright install chromium
npx @design-harness/cli@0.4.3 audit --url http://localhost:3000 --out runs/demo
```

Parser-free copy CLI wiring is implemented in the current checkout but is not attributed to an npm version until that version is published. Test it from the checkout with the committed example:

```bash
pnpm design-harness -- audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --copy examples/configs/copy-style.ko-example.yaml
```

The CLI rejects unreadable, oversized, malformed, ambiguous, or schema-invalid config before launching Chromium or creating the output directory. Use the equivalent `npx @design-harness/cli@<version> ... --copy` form only after that version is actually published.

## Local Package Smoke Test

Maintainers can verify the packed CLI before publishing:

```bash
pnpm smoke:packed-cli
```

The smoke test packs the four workspace packages, installs the CLI tarball into a temporary consumer project, resolves the internal packages through local tarball overrides, checks `--copy` help, and verifies malformed and schema-invalid configs exit `1` without artifacts. Its installed help command is:

```bash
pnpm exec design-harness --help
```

This catches broken `bin` entries, missing package files, and workspace dependency packaging mistakes before npm publish.
