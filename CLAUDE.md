@AGENTS.md

# Claude Code notes

`AGENTS.md` is the cross-agent source of truth. Do not duplicate or override it
here. Before editing a subtree, read its nearest scoped `AGENTS.md`; Claude does
not get to assume the root import contains those local rules.

- The owner communicates in Korean. Use Korean for user-facing progress,
  decisions, blockers, and handoffs. Keep code, identifiers, commits, PRs, and
  public project documentation in English unless the artifact is explicitly
  Korean-language evidence.
- On resume, read the newest `.omx/handoffs/*.md`, then verify Git/CI state.
  Handoffs are shared by Claude Code and Codex and may be newer than chat
  context, but ignored artifacts never override committed rules.
- `REPORT.md` is optional Korean strategy context. Read the relevant section
  before proposing scope or positioning changes when it exists; never block on
  its absence.
- Prefer an end-to-end audit over test-only confidence when changing capture,
  checks, report rendering, CLI orchestration, or loop behavior.
- The release-block hook in `.claude/settings.json` is a safety boundary. Never
  bypass, disable, rename around, or replace it. Ask the owner for an exact
  approved release command instead.
- Preserve a standalone `@AGENTS.md` import and any valid marker-owned guide
  span when guide materialization touches instruction files.

If a task crosses package boundaries, state which layer owns each behavior
before editing. If the proposed behavior belongs on the cut list or needs a new
dependency/schema/public claim, stop at the owner gate defined in `AGENTS.md`.
