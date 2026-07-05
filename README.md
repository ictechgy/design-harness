# Design Harness

Evidence for AI-made interfaces.

Design Harness is an open-source, model-agnostic UI/UX QA loop for AI coding agents. Point it at a local URL and it captures desktop/mobile screenshots, runs conservative source-backed checks, and writes an agent-friendly report you can hand back to Codex, Claude Code, Gemini CLI, or a human reviewer.

```text
local URL -> screenshots -> audit.json -> report.md -> PR comment / agent loop / scenario summary
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

From a checkout:

```bash
pnpm install
pnpm build
pnpm design-harness -- audit --url http://localhost:3000 --out runs/demo
```

If Chromium is not installed for Playwright:

```bash
pnpm playwright:install
```

Expected output:

```text
runs/demo/
  metadata.json
  audit.json
  report.md
  report-manifest.json
  screenshots/
    desktop.png
    mobile.png
```

Partial audits still write artifacts but exit with code `2` by default. Use `--allow-partial` when a debugging workflow should treat partial artifacts as success.

The package entry point is prepared as `@design-harness/cli`, which exposes the `design-harness` binary. Until the first npm publish, use the checkout workflow above. After publish, the intended one-off shape is:

```bash
npx @design-harness/cli@latest audit --url http://localhost:3000 --out runs/demo
```

For npm-installed usage, install the Playwright browser once if Chromium is missing:

```bash
npx playwright install chromium
```

## Agent Loop

The core workflow is meant to be boring in the best way:

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

- render failure or blank render,
- horizontal overflow,
- likely text clipping,
- DOM-computed contrast risk,
- semantic accessibility risks: missing names, form labels, image alternatives, heading issues, landmarks,
- responsive readability risks: wide content, sticky obstruction, excessive line length, target size,
- interaction state risks: error association, color-only states, disabled controls, live status, dialogs, custom controls, moving content.

Every finding includes severity, confidence, viewport, category, evidence references, and a recommendation. v0.3 findings may also include `criterionId`, `sourceRefs`, `determinism`, `resultKind`, runtime type, observed evidence, and expected behavior.

See [Criteria And Checks](docs/criteria-and-checks.md), [Output Contract](docs/output-contract.md), and [Fixture Catalog](docs/fixtures.md).

## Recipes

- [GitHub Actions](docs/recipes/github-actions.md): run the harness in CI, upload artifacts, and optionally comment on pull requests.
- [Pull Request Comment Bot](docs/recipes/pr-comment-bot.md): render a compact PR comment from an audit run.
- [Scenario Audit](docs/recipes/scenario-audit.md): run multiple local URL scenarios and aggregate the results.
- [npm Execution](docs/recipes/npm-execution.md): verify the packed CLI and understand the post-publish `npx` path.
- [Agent Loop Recipes](docs/recipes/agent-loop.md): prompts for Codex, Claude Code, Gemini CLI, and human reviewers.
- [Release Checklist](docs/recipes/release-checklist.md): package checks to run before publishing a public version.

## How Findings Speak

Design Harness tries hard not to overclaim.

- `deterministic`: measured evidence supports a concrete failure or risk, such as horizontal overflow.
- `heuristic`: the signal is probably useful, but context still matters.
- `needs-review`: the issue is visible to a reviewer, but the harness should not pretend it can prove it automatically.

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

## Midjourney Reference Lab

The repository also includes a manual calibration workflow for UI quality references:

- prompts and manifest records,
- good/bad labels,
- expected findings,
- "should not flag" notes,
- hand-authored fixtures derived from general observations.

Generated Midjourney images are local-only by default and are not required to run the project. Design Harness does not call Midjourney, automate Midjourney, require a Midjourney account, or depend on generated assets at runtime.

See [Midjourney Reference Lab Workflow](docs/midjourney-reference-lab/workflow.md).

## Packages

- `@design-harness/core`: schemas, validation, scoring, report rendering, shared types.
- `@design-harness/visual-audit`: Playwright screenshot capture and source-backed DOM, layout, accessibility, and interaction checks.
- `@design-harness/cli`: command-line entry point for the local audit workflow.

## Status

Implemented:

- local CLI audit loop,
- desktop/mobile screenshot capture,
- schema-valid audit artifacts,
- Markdown report generation,
- source-backed criteria registry,
- example fixtures,
- Midjourney Reference Lab manifest and policy validators.
- PR comment renderer, scenario audit runner, and MCP adapter manifest.

In progress or planned:

- first npm publish,
- more fixture coverage,
- deeper hosted/action adapters,
- Open Design integrations beyond the current specs.

## Contributing

Design Harness is Apache-2.0 licensed. See [CONTRIBUTING.md](CONTRIBUTING.md).

The best first contributions are small and evidence-oriented:

- add a good/bad fixture pair,
- improve a report recommendation,
- map a check to a stronger source-backed criterion,
- add a regression test for a real UI failure mode,
- help turn a `needs-review` calibration signal into a measurable heuristic.
