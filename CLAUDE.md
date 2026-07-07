@AGENTS.md

Claude-specific notes (AGENTS.md above is the single source of truth — never duplicate or override it here):

- Operational specs live in committed docs: `docs/ROADMAP.md` (milestones), `docs/agent-protocol.md` (session protocol, anti-drift table, verification matrix). `REPORT.md` (git-ignored, Korean) is optional strategic rationale — read relevant sections before proposing scope changes when present, but never block on its absence.
- The owner communicates in Korean. Write user-facing summaries in Korean; keep code, commits, and public docs in English.
- When resuming work, check the newest handoff in `.omx/handoffs/` — this repo is worked on alternately by Claude Code and Codex, and handoffs are the shared state.
- Scope discipline: if a task drifts toward anything on the AGENTS.md cut list, stop and confirm with the owner instead of building it.
- Verification: prefer running the real loop (`pnpm example:serve` + `pnpm design-harness -- audit ...`) over unit tests alone when touching checks, measurements, or report rendering.
