# Output Contract

The v0.1 CLI command:

```bash
design-harness audit --url <local-url> --out runs/<timestamp>
```

Writes:

```text
runs/<timestamp>/
  metadata.json
  audit.json
  report.md
  report-manifest.json
  screenshots/
    desktop.png
    mobile.png
```

`audit.json` must validate against `packages/core/schemas/audit-result.schema.json`.

## Failure Behavior

- Invalid URL: exits non-zero and names the invalid URL.
- Browser unavailable: exits non-zero and recommends `pnpm playwright:install`.
- Page timeout or navigation issue: writes partial artifacts with `status: "partial"` when possible and exits `2` unless `--allow-partial` is set.
- Schema validation failure: exits non-zero and identifies validation issues.
