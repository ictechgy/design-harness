# Release Checklist

Run this before tagging or publishing a public package. Do not run version, tag, publish, or GitHub release commands until the owner approves the exact release action in the current session.

```bash
pnpm install --frozen-lockfile
pnpm release:check
```

`pnpm release:check` runs:

- build,
- typecheck,
- tests,
- schema and calibration validation,
- dry-run package packing for `@design-harness/core`, `@design-harness/copy-audit`, `@design-harness/visual-audit`, and `@design-harness/cli`,
- temporary-project guide compile/check and Style Dictionary 5.5 compatibility smokes,
- a local packed-CLI install smoke test that installs the generated tarballs into a temporary consumer project and exercises audit/copy/guide help and failure gates.

Committed example runs are provenance artifacts, not release-version mirrors. Never mechanically bump their `harnessVersion` or `toolVersions`: either regenerate the complete run (`audit.json`, `metadata.json`, `report-manifest.json`, `report.md`, and screenshots) with the release candidate, or retain the version that actually produced the committed run.

## npm Publish

After an approved version bump and tag plan, publish the CLI surface and its workspace dependencies in dependency order:

```bash
pnpm --filter @design-harness/core publish --access public
pnpm --filter @design-harness/copy-audit publish --access public
pnpm --filter @design-harness/visual-audit publish --access public
pnpm --filter @design-harness/cli publish --access public
```

After publish, verify one-off execution from a separate temporary directory:

```bash
npx @design-harness/cli@<version> --help
npx playwright install chromium
npx @design-harness/cli@<version> audit --url http://localhost:3000 --out runs/demo
```

PR comment rendering, scenario audit, and MCP adapter usage remain checkout-local recipes for this release.

Do not publish generated Midjourney reference images. They are local-only calibration assets and are intentionally excluded from git and package artifacts.
