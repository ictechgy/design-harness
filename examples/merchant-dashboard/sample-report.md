# Design Harness Audit Report

## Run Summary

- Run ID: `2026-07-04-132149694Z`
- Target: http://127.0.0.1:4174/
- Status: `success`
- Started: 2026-07-04T13:21:49.694Z
- Duration: 2181ms
- Viewports: desktop (1440x900), mobile (390x844)

## Advisory Score

**100/100** (strong)

Verdict: No blocking deterministic findings.

Note: Advisory score starts at 100 and subtracts finding deductions by severity, confidence, and evidence-tier weight. Needs-review findings are score-exempt. It is not an objective design-quality grade.

## Deterministic Findings

No blocking deterministic findings were detected.

## Evidence Links

- `screenshot-desktop` (screenshot, desktop): screenshots/desktop.png
- `measurement-desktop` (measurement, desktop): {"viewport":"desktop","viewportWidth":1440,"viewportHeight":900,"documentScrollWidth":1440,"bodyScrollWidth":1440,"textLength":755,"meaningfulElementCount":71,"clippedText":[],"contrastRisks":[]}
- `screenshot-mobile` (screenshot, mobile): screenshots/mobile.png
- `measurement-mobile` (measurement, mobile): {"viewport":"mobile","viewportWidth":390,"viewportHeight":844,"documentScrollWidth":390,"bodyScrollWidth":390,"textLength":723,"meaningfulElementCount":66,"clippedText":[],"contrastRisks":[]}

## Recommendations

- Keep the current structure and continue with human visual review.

## Iteration Prompt Scaffold

```text
You are improving a UI using Design Harness evidence.
Target URL: http://127.0.0.1:4174/
Run ID: 2026-07-04-132149694Z
Use the deterministic findings below as evidence, then make one focused revision pass.
- No blocking deterministic findings were detected. Improve polish while preserving the current layout stability.
After revising, rerun the audit and compare the new report against this one.
```

## Optional Subjective Critique

No subjective critique was supplied. This report only contains deterministic audit findings.
