# Design Harness

Evidence for AI-made interfaces.

[![npm](https://img.shields.io/npm/v/%40design-harness%2Fcli?label=%40design-harness%2Fcli)](https://www.npmjs.com/package/@design-harness/cli)
[![CI](https://github.com/ictechgy/design-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/ictechgy/design-harness/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Design Harness is an open-source, model-agnostic UI/UX QA loop for AI coding agents. Point it at a local URL and it captures desktop/mobile screenshots, runs conservative source-backed checks, and writes an agent-friendly report you can hand back to Codex, Claude Code, Gemini CLI, or a human reviewer.

```text
local URL -> screenshots -> audit.json -> report.md -> agent loop
```

It is not a black-box design judge, a hosted LLM product, or a visual regression replacement. The goal is simpler and more useful: make UI feedback repeatable enough that humans and agents can improve the same screen from the same evidence.

## Why

AI coding agents can produce interfaces that look plausible at first glance while still having ordinary, expensive problems:

- mobile overflow,
- clipped text,
- weak contrast,
- unlabeled controls,
- color-only state changes,
- hidden or ambiguous errors,
- unreadable dense layouts,
- CTA and state hierarchy that "feels off" but has no review artifact.

Design Harness turns those observations into structured output. Deterministic issues stay deterministic. Heuristic risks stay labeled as risks. Subjective or emerging design judgments stay as review prompts instead of being dressed up as objective truth.

## Quickstart

Playwright needs a local Chromium binary. Install it once:

```bash
npx playwright install chromium
```

Then run your app locally and audit it — no checkout needed:

```bash
npx @design-harness/cli@latest audit --url http://localhost:3000 --out runs/demo
```

Expected output:

```text
runs/demo/
  metadata.json
  audit.json
  report.md
  report-manifest.json
  screenshots/
    <viewport-name>.png
```

Partial audits still write artifacts but exit with code `2` by default. Use `--allow-partial` when a debugging workflow should treat partial artifacts as success.

The npm package is CLI-focused: it ships the local audit command and explicit guide compile/check commands. The PR comment renderer and scenario audit runner are checkout-local recipes. The MCP manifest and dispatcher are checkout-local compatibility scaffolding, not a shipped package API or server; `audit.json` and `report.md` remain the canonical integration boundary.

### From a checkout (for contributors)

For contributing, or for the checkout-local recipes:

```bash
pnpm install
pnpm build
pnpm design-harness -- audit --url http://localhost:3000 --out runs/demo
```

The current checkout can opt into the five parser-free rendered-copy checks with its committed example contract:

```bash
pnpm design-harness -- audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --copy examples/configs/copy-style.ko-example.yaml
```

The config is validated before Chromium starts. Without `--copy`, Design Harness does not discover a copy config or run copy analysis. The five checks are documented in [Criteria and Checks](docs/criteria-and-checks.md#parser-free-copy-audit). The equivalent explicit `npx` path is available in published versions starting with v0.4.4.

Use `pnpm playwright:install` if Chromium is missing.

### Guide compile/check (v0.6.1)

From inside the project that owns an explicit `design-guide.yaml`:

```bash
npx @design-harness/cli@0.6.1 guide compile \
  --guide ./design-guide.yaml \
  --target .

npx @design-harness/cli@0.6.1 guide check \
  --guide ./design-guide.yaml \
  --target . \
  --max-tokens 2000
```

Compile derives marker-owned `AGENTS.md`/`DESIGN.md` guidance, a non-duplicating `CLAUDE.md` import, and an owned `design.tokens.json`. Check compares the same outputs without writing. Both commands require explicit local guide and target paths; neither discovers config or uses network input. Add `--copy ./copy-style.yaml` when the target also owns a compatible copy contract.

## Agent Loop

The v0.6.1 package adds a bounded command for the exact deterministic-failure gate:

```bash
npx @design-harness/cli@0.6.1 loop \
  --url http://localhost:3000 \
  --out runs/repair-loop \
  --until deterministic-failures==0 \
  --max-iters 3 \
  --agent-cmd '<non-interactive command>'
```

The output root must be new. The only supported stop condition is exactly `deterministic-failures==0`; heuristic risks and `needs-review` findings never gate the loop. `--max-iters N` permits at most N agent commands and N+1 audits because the baseline audit comes first. A partial audit stops before the condition is evaluated or an agent is launched.

Exit `0` means the baseline was already clean for this condition or a re-audit converged, `1` means preflight/audit/agent/timeout/summary error, `2` means partial audit, and `3` means no progress or the iteration budget was exhausted. Each audit is retained under `iterations/`, and `loop-summary.json` records the terminal state without storing the raw agent command, its output, or report contents.

`--agent-cmd` runs arbitrary code with the caller's permissions, working directory, and inherited environment, which may expose credentials. The loop supplies no sandbox or network boundary. See [Agent Loop Recipes](docs/recipes/agent-loop.md) for the fixed evidence environment, timeout behavior, and platform caveats. This narrow condition is not a completeness or overall-quality guarantee.

The manual workflow remains useful when a human should decide which risks to change:

1. Run your app locally.
2. Audit the local URL.
3. Give `runs/<name>/report.md` and the screenshots to your coding agent.
4. Ask it to fix the highest-confidence findings first.
5. Run the harness again.

Example follow-up prompt:

```text
Use this Design Harness report as the source of truth.
Fix deterministic failures first, then medium-confidence risks.
Do not chase subjective polish unless the report marks it as needs-review.
After editing, rerun the same audit command and summarize what changed.
```

This keeps the loop grounded. The agent is not guessing from "make it better"; it is responding to screenshots, evidence references, criteria, and report copy that separate measurement from taste.

## What Gets Checked

Checks are conservative and source-backed:

- **Render and layout**: render failure or blank render, horizontal overflow, likely text clipping, DOM-computed contrast risk.
- **Semantic accessibility**: missing accessible names, form labels, image alternatives, heading issues, landmarks, missing page language declaration.
- **Responsive readability**: wide content, sticky obstruction, excessive line length, target size.
- **Interaction state**: error association, color-only states, disabled controls, live status, dialogs, custom controls, moving content.
- **Reference-derived hierarchy heuristics**: repeated visual weight, saturated color noise, checklist state visibility.

Every finding includes severity, confidence, viewport, category, evidence references, a recommendation, and a `checkName`. Registry-backed findings also carry `criterionId`, `sourceRefs`, `determinism`, `resultKind`, and runtime metadata; selector, region, observed, and expected evidence are present when the producing check supplies them.

A real finding from an audit of the `semantic-a11y-bad` fixture (abridged):

```json
{
  "id": "finding-desktop-missing-form-label-1",
  "category": "accessibility",
  "severity": "medium",
  "confidence": "medium",
  "viewport": "desktop",
  "selector": "#query",
  "problem": "Form control #query may not have a programmatic label.",
  "recommendation": "Associate the control with a visible label, aria-label, or aria-labelledby.",
  "criterionId": "a11y.form-label.present",
  "sourceRefs": ["wcag-2-2", "polaris-accessibility"],
  "determinism": "deterministic",
  "resultKind": "risk",
  "evidenceRefs": ["screenshot-desktop", "measurement-desktop"]
}
```

A complete failing run — the full `report.md`, `audit.json`, and screenshots for a fixture with 14 findings and a blocked advisory score — is committed at [examples/reports/semantic-a11y-bad](examples/reports/semantic-a11y-bad/report.md). Its recorded `harnessVersion` is the version that generated it, not necessarily the latest package version.

See [Criteria And Checks](docs/criteria-and-checks.md), [Output Contract](docs/output-contract.md), and [Fixture Catalog](docs/fixtures.md).

## How Findings Speak

Design Harness tries hard not to overclaim. Findings are graded on two axes — `determinism` (deterministic / heuristic / subjective) and `resultKind` (failure / risk / needs-review) — plus a separate low/medium/high `confidence` field. Reports group them into three reader-facing tiers:

| Tier | Meaning | Example |
| --- | --- | --- |
| Deterministic failures and risks | Measured evidence supports a concrete failure or risk. | Horizontal overflow at 390px. |
| Heuristic risks | The signal is probably useful, but context still matters. | A reading line wider than ~95 characters. |
| Review prompts (`needs-review`) | Visible to a reviewer; the harness does not pretend to prove it automatically. | Visual weight repeated so evenly that priority is unclear. |

That distinction matters for design work. A contrast threshold and a weak visual hierarchy should not be reported with the same certainty.

## Example Fixture

Run the merchant dashboard fixture in one terminal:

```bash
pnpm example:serve
```

Then audit it:

```bash
pnpm design-harness -- audit --url http://localhost:4173 --out runs/merchant-dashboard
```

The fixture gives new contributors a stable target for checking the full local loop.

## Recipes

- [GitHub Actions](docs/recipes/github-actions.md): run the harness in CI, upload artifacts, and optionally comment on pull requests.
- [Pull Request Comment Bot](docs/recipes/pr-comment-bot.md): checkout-local recipe to render a compact PR comment from an audit run.
- [Scenario Audit](docs/recipes/scenario-audit.md): checkout-local recipe to run multiple local URL scenarios and aggregate the results.
- [npm Execution](docs/recipes/npm-execution.md): verify the packed CLI and the `npx` execution path.
- [Agent Loop Recipes](docs/recipes/agent-loop.md): prompts for Codex, Claude Code, Gemini CLI, and human reviewers.
- [Release Checklist](docs/recipes/release-checklist.md): package checks to run before publishing a public version.

## Packages

| Package | What it does |
| --- | --- |
| [`@design-harness/cli`](https://www.npmjs.com/package/@design-harness/cli) | Command-line entry point for the local audit workflow. |
| [`@design-harness/core`](https://www.npmjs.com/package/@design-harness/core) | Schemas, validation, scoring, report rendering, shared types. |
| [`@design-harness/copy-audit`](https://www.npmjs.com/package/@design-harness/copy-audit) | Pure programmatic checks for rendered placeholders, josa hedges, configured glossary terms, and banned phrases. |
| [`@design-harness/visual-audit`](https://www.npmjs.com/package/@design-harness/visual-audit) | Playwright screenshot capture and source-backed DOM, layout, accessibility, and interaction checks. |

## Status

Implemented:

- local CLI audit command, published to npm,
- desktop/mobile screenshot capture,
- schema-valid audit artifacts,
- Markdown report generation,
- source-backed criteria registry,
- parser-free rendered-copy analysis through the programmatic API and explicit `--copy` CLI path,
- explicit guide compile/check and audit-time font-family contract checking,
- contrast measurement that fails closed on unsupported ancestor paint effects,
- criterion-bounded advisory scoring and explicit capped-finding cardinality,
- a bounded `design-harness loop` gated only by deterministic failures,
- example fixtures,
- Midjourney Reference Lab manifest and policy validators.

Checkout-local recipes/scaffolding:

- PR comment renderer,
- scenario audit runner,
- MCP adapter manifest and local dispatcher.

Not on the current roadmap: a package-installed MCP server/surface or Open Design integration. The existing checkout-local MCP scaffolding remains available as documented above.

## Midjourney Reference Lab

The repository also includes a manual, local-only calibration workflow: curated good/bad UI reference observations are distilled into hand-authored fixtures, manifest records, and expected findings. Design Harness does not call or automate Midjourney, does not require a Midjourney account, and never depends on generated assets at runtime. See [Midjourney Reference Lab Workflow](docs/midjourney-reference-lab/workflow.md).

## Contributing

Design Harness is Apache-2.0 licensed. See [CONTRIBUTING.md](CONTRIBUTING.md).

The best first contributions are small and evidence-oriented:

- add a good/bad fixture pair,
- improve a report recommendation,
- map a check to a stronger source-backed criterion,
- add a regression test for a real UI failure mode,
- help turn a `needs-review` calibration signal into a measurable heuristic.
