# CLI package instructions

Applies to `packages/cli/`. Root `AGENTS.md` remains authoritative.

## Responsibility and boundaries

CLI owns argument parsing, YAML loading, filesystem orchestration, guide
materialization, bounded repair loops, and user-facing output. Detection and
scoring logic belong in lower layers.

- Audit URLs remain local HTTP(S). Do not add remote capture exceptions.
- YAML and config-path resolution stay here. Config files must be explicit,
  contained in the real target, and protected against symlink/identity races.
- `guide check` is compare-only and performs zero writes. Compile/update uses
  marker ownership, private staging/recovery, identity checks, and fail-closed
  rollback; never substitute best-effort writes.
- Partial audits retain exit code 2 unless `--allow-partial` is explicit.
- Loop exit reasons, process boundaries, and no-progress detection are machine
  contracts. Preserve original failures and attach cleanup failures secondarily.
- Keep `audit.json`, `report.md`, metadata, and manifests consistent. Do not
  duplicate large evidence payloads in agent-facing Markdown.

## Verification

```bash
pnpm --filter @design-harness/cli typecheck
pnpm --filter @design-harness/cli test
pnpm smoke:guide
pnpm smoke:loop
pnpm smoke:packed-cli
CI=true pnpm release:check
```

For new flags, update args tests, help/output tests, and packed-CLI behavior in
the same change.
