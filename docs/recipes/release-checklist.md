# Release Checklist

Run this before tagging or publishing a public package:

```bash
pnpm install --frozen-lockfile
pnpm release:check
```

`pnpm release:check` runs:

- build,
- typecheck,
- tests,
- schema and calibration validation,
- dry-run package packing for `@design-harness/core`, `@design-harness/visual-audit`, and `@design-harness/cli`,
- a local packed-CLI install smoke test that installs the generated tarballs into a temporary consumer project and runs `design-harness --help`.

## First npm Publish

The initial public package should publish the workspace packages in dependency order:

```bash
pnpm --filter @design-harness/core publish --access public
pnpm --filter @design-harness/visual-audit publish --access public
pnpm --filter @design-harness/cli publish --access public
```

After publish, verify one-off execution from a separate temporary directory:

```bash
npx @design-harness/cli@0.2.0 --help
npx playwright install chromium
```

Do not publish generated Midjourney reference images. They are local-only calibration assets and are intentionally excluded from git and package artifacts.
