# Fixture Catalog

Fixture pages live in `examples/ui-quality-fixtures`.

They are intentionally small, framework-free HTML pages used to calibrate deterministic checks and heuristic risks.

## Fixtures

- `deterministic-failure.html`: blank root content for render failure calibration.
- `deterministic-risk.html`: low contrast and wide content risks.
- `heuristic-needs-review.html`: repeated labels and long reading measure.
- `semantic-a11y-good.html`: good semantic structure and labels.
- `semantic-a11y-bad.html`: missing names, labels, alt text, heading order, landmark, and repeated label risks.
- `responsive-readability-good.html`: responsive layout, readable measure, and adequate targets.
- `responsive-readability-bad.html`: wide content, sticky obstruction, long lines, and small target risks.
- `interaction-state-good.html`: associated errors, live status, native controls, and controlled motion.
- `interaction-state-bad.html`: static signals for interaction-state risks.
- `midjourney-derived/scanability-good.html`: hand-authored dense-dashboard scanability fixture distilled from generic reference observations.
- `midjourney-derived/scanability-bad.html`: hand-authored dense-dashboard scanability stress fixture for responsive/readability risks.
- `korean-line-length-good.html`: Korean long-form text at a comfortable CJK measure (~40 chars/line); calibrates the CJK-aware line-length estimate against false positives.
- `korean-line-length-bad.html`: unconstrained full-width Korean paragraph; expects exactly one desktop `excessive-line-length` finding.
- `korean-status-good.html`: Korean "저장 중..." status with `role="status"`; must stay silent.
- `korean-status-bad.html`: Korean status text without live-region semantics; expects `status-live-region-risk` per viewport.
- `korean/copy-good.html`: synthetic improved Korean copy; expects zero parser-free copy findings under `josaHedgePolicy: allow`; its rendered `을(를)` line is the allow-policy control.
- `korean/copy-bad.html`: one synthetic defect for each parser-free copy criterion; the single-desktop copy smoke expects five findings and score 63.2.
- `page-lang-good.html`: html element declares `lang`; must stay silent.
- `page-lang-bad.html`: html element without a `lang` attribute; expects one `page-lang-missing` deterministic failure per viewport.

## Fixture Policy

- Add at least one good and one bad fixture for each new deterministic check family.
- Keep fixtures plain HTML/CSS unless the check requires framework behavior.
- Prefer obvious, isolated failures over realistic but ambiguous pages.
- Do not copy proprietary product UI.
- Use fixtures to calibrate false positives as much as true positives.

## Reference-Derived Fixtures

Reference-derived fixtures must be hand-authored and reproducible without the reference generator. Generated images are not fixture source files.

See [Midjourney Reference Lab Workflow](midjourney-reference-lab/workflow.md) for the manual reference workflow, manifest policy, local asset policy, and review checklist.

## Calibration Datasets And Licenses (Korean copy work)

Fixture and calibration data for the copy-audit checks is license-tiered. Getting this wrong contaminates the Apache-2.0 repository.

Redistributable — may be committed:

- Synthetic josa gold suites (the batchim rule is phonological, so exhaustive generation is cheap and license-clean).
- IWSLT2023 EN-KO formality test data (CDLA-Sharing-1.0) for politeness-register calibration.
- Hand-authored Korean fixtures (`korean/copy-good.html`, `korean/copy-bad.html`), reviewed by a native speaker.

Internal calibration only — NEVER commit fixtures derived from these:

- NIKL corpora from 모두의 말뭉치 (application-gated; no redistribution; no LLM augmentation).
- 국립국어원 말평 task data (same restrictions).
- Smilegate SmileStyle (CC-BY-NC-4.0).
- K-NCT (repository has no license — ask the authors before any use beyond reading).

When in doubt, generate synthetic Korean data instead. Every copy criterion should carry at least one bad → improved example pair with a reason.

Every committed Korean fixture is listed in `examples/calibration-datasets/korean-copy/manifest.jsonl`. `pnpm validate:korean-copy` verifies required provenance fields, redistribution status, file existence, uniqueness, and complete coverage of the committed Korean fixture set.
