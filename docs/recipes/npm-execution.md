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
npx @design-harness/cli@0.4.2 --help
npx playwright install chromium
npx @design-harness/cli@0.4.2 audit --url http://localhost:3000 --out runs/demo
```

## Local Package Smoke Test

Maintainers can verify the packed CLI before publishing:

```bash
pnpm smoke:packed-cli
```

The smoke test packs the four workspace packages, installs the CLI tarball into a temporary consumer project, resolves the internal packages through local tarball overrides, and runs:

```bash
pnpm exec design-harness --help
```

This catches broken `bin` entries, missing package files, and workspace dependency packaging mistakes before npm publish.
