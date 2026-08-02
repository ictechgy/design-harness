# Repository script instructions

Applies to `scripts/`. Root `AGENTS.md` remains authoritative.

Scripts are root-only policy gates, validators, benchmark tooling, release
guards, fixture servers, and smoke tests. They are not package runtime APIs.

- Validators fail closed on missing, extra, malformed, stale, reordered, or
  byte-drifted input. An exit code of 0 requires the terminal contract, not just
  process completion.
- Regression suites need an unchanged control plus targeted mutations at the
  exact acceptance boundaries. Prove at-cap and over-cap behavior separately.
- Preserve primary errors. Cleanup, rollback, and residue failures are secondary
  evidence and must not replace the initiating failure.
- Keep local experiments and credentials ignored. Public snapshots require
  provenance, canonical hashes, fixed counts, and explicit limitations.
- Benchmark axes, prompts, baselines, and aggregation rules freeze before runs.
  A result may support only the pre-registered dimension; do not generalize an
  on-target improvement into generic slop reduction.
- Hooks and policy scripts must include positive and negative samples. Never
  weaken a gate merely to make the current patch pass.

When adding a root command, wire it into `package.json`, its focused check, and
`pnpm validate` only if it is a required repository gate. Update `AGENTS.md` or
`docs/ROADMAP.md` in the same slice when the command changes a convention.

Run the focused script/regressions, `pnpm check:package-boundaries`,
`pnpm check:tracked-hygiene`, and the relevant smoke or release gate.
