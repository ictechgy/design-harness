# Dataset instructions

Applies to `datasets/`. Root `AGENTS.md` remains authoritative.

This tree is local/private working evidence unless a tracked public mirror and
policy explicitly say otherwise.

- Never force-add ignored owner labels, provider outputs, prompts, identifiers,
  secrets, model assets, or generated Midjourney images.
- Midjourney `local-assets/` bytes stay untracked. Only rights-cleared,
  non-reconstructive distilled tokens or an explicitly approved public manifest
  may leave the private tree.
- Do not create fixtures from NIKL 모두의 말뭉치/말평, SmileStyle, K-NCT, or any
  corpus whose redistribution/LLM terms are gated, non-commercial, or unclear.
  Prefer synthetic Korean data. IWSLT-derived evidence follows its committed
  CDLA attribution and aggregate-only contract.
- Private evidence must use canonical hashes, bounded counts/bytes, explicit
  provenance, and restrictive permissions where the workflow requires them.
- Preserve failed, rejected, or exploratory evidence; do not relabel it as a
  formal run or delete it to improve metrics.
- Owner judgments remain owner-authored. Agents may validate completeness and
  contract balance but must not fill, flip, qualify, or commit labels on the
  owner's behalf.

Before promoting anything from this tree, run the matching dataset validator,
policy check, `pnpm check:tracked-hygiene`, and a clean `git status --short` audit
showing no private path was added.
