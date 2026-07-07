# CLAUDE.md

**Read `AGENTS.md` first — it is the single source of truth** for hard rules, commands, the current roadmap, the cut list, Korean copy-check tiering, and design invariants. Do not duplicate or override it here.

Claude-specific notes:

- Strategic background (why the roadmap looks this way) is in `REPORT.md` (git-ignored, Korean) and `.omx/plans/2026-07-07-evolution-research.md`. Read them before proposing scope changes; if absent, ask the owner.
- The owner communicates in Korean. Write user-facing summaries in Korean; keep code, commits, and public docs in English.
- When resuming work, check the newest handoff in `.omx/handoffs/` — this repo is worked on alternately by Claude Code and Codex, and handoffs are the shared state.
- Scope discipline: if a task drifts toward anything on the AGENTS.md cut list (MCP server, best-of-N, extra agent surfaces, interaction simulation), stop and confirm with the owner instead of building it.
- Verification: prefer running the real loop (`pnpm example:serve` + `pnpm design-harness -- audit ...`) over unit tests alone when touching checks, measurements, or report rendering.
