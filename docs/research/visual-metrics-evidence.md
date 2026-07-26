# Visual Metrics — Evidence Table

Evidence basis and epistemic boundary for the three visual-metric policies completed on 2026-07-26 but not released. The studies motivate bounded project-specific review; they do not establish universal budgets, Design Harness's engineering constants, or an objective visual-quality score.

## Variance ceiling and registry policy

The strongest broad metric sets cited here explain only part of the variance in human ratings:

- Reinecke et al., CHI 2013 (450 websites, 548 raters): the reported complexity and colorfulness models explain adjusted R² = .48 of first-impression appeal. <https://kgajos.seas.harvard.edu/papers/reinecke13aesthetics.pdf>
- Miniukovich & De Angeli, CHI 2015: eight automatic GUI metrics explain up to 49% of variance for webpages and 32% for mobile apps, with 42% reported on an independent dataset. <https://dl.acm.org/doi/10.1145/2702123.2702575>

Consequently, exact computation never upgrades the underlying claim. All three implemented criteria are `research-emerging`, `heuristic`, low-severity, low-confidence `risk`. They compare a measurement only with a maximum explicitly authored by the project. There are no defaults, rewards for low values, pass claims, or general design-quality claims.

## Implemented directional signals

| Criterion and frozen method | Evidence boundary | Implementation status |
|---|---|---|
| `typography.variant-count.budget` — `rendered-typography-variants-v1` counts normalized computed family-stack + size + weight + style tuples | Ivory, Sinha & Hearst, CHI 2001 operationalized font count using these computed dimensions and found it among the metrics that separated its study sets. That result does not validate a universal variant count, modular scale, font pairing rule, or glyph-resolved face inference. <https://flamenco.berkeley.edu/papers/chi2001.pdf> | Complete, opt-in, not released |
| `color.palette.count-discipline` — `rendered-rgba8-oklch-cover30-v1` counts distinct nontransparent RGBA8 paint values and a minimum closed 30-degree cover over chromatic OKLab hues | Ivory et al. included color count; O'Donovan et al., SIGGRAPH 2011 measured preferences over its color-theme stimuli. Neither paper validates a universal interface-palette maximum, the 0.030 chroma cutoff, the 30-degree cover, hue harmony, or lightness scoring. <https://flamenco.berkeley.edu/papers/chi2001.pdf> · <https://www.dgp.toronto.edu/~donovan/color/colorcomp.pdf> | Complete, opt-in, not released |
| `layout.density.complexity-budget` — `viewport-dom-density-v1`, with `visible-content-elements-v1` and `text-flow-connectivity-v1`, counts visible owners and text-flow components at the current viewport position | Reinecke et al. found complexity strongly related to first impressions in its dataset. Miniukovich & Marchese, CHI 2020 reported a high-side inverse-linear relationship after controlling broken/archaic pages. This supports review of project-configured high-side overages only, not a universal DOM threshold, low-density penalty/reward, below-fold sweep, or pixel-density claim. <https://doi.org/10.1145/3313831.3376602> | Complete, opt-in, not released |

The versioned chroma cutoff, hue span, candidate caps, clipping topology, and text-fragment adjacency coefficients are reproducibility and safety constants. The six atomic fixtures and merchant case require complete evidence, while a three-repeat, exact-hash gate covers 48 unrelated recursive HTML fixtures and pins one reviewed lower-bound color-space notice. This calibration proves implementation stability; it neither claims complete evidence for every corpus page nor validates the constants as taste boundaries.

## Research notes that remain non-goals

- Whitespace-ratio bands come from limited contexts and do not establish a project-independent UI threshold.
- Alignment/grid metrics correlate with ratings in some studies, but proposed near-miss thresholds are designer-derived. No alignment or grid-quality check or guide rule is implemented or scheduled by this slice.
- Lightness measurements appear in color-preference literature, but no lightness score, threshold, or generated instruction is implemented.
- Pixel segmentation, edge density, color enumeration, and below-fold sweep are distinct capture methods and are not implied by the DOM/computed-style methods above.

## Negative evidence — do not build

- **Hue-template color-harmony scoring**: O'Donovan 2011 found classic hue templates did not predict theme ratings; reported inter-rater agreement was only 52%. This argues against hue-harmony scoring and does not license a replacement lightness score.
- **Mirror-symmetry / center-of-mass balance scoring for real UIs**: results reported for abstract stimuli do not establish generalization to real interfaces.
- **Scored Korean readability**: KRIT reports 0.746 accuracy on long-form textbook grade classification and states that public datasets or baselines were unavailable; nothing cited here validates scoring short UI strings.

## 2026 LLM-UI evaluation additions (prior-art registry)

WebCoderBench (arXiv 2601.02430 — human-preference-aligned metric weighting, candidate technique for score aggregation) · 1D-Bench (2602.18548 — iterative editing beats post-training) · WebGen-R1 (2604.20398 — independent convergence on deterministic-gates-before-aesthetics) · ProductWebGen (2606.01022) · UI-UX mobile benchmark (2606.13192) · UI-Bench (2508.20410) · DesignBench (2506.06251) · FrontendBench (2506.13832) · Code Aesthetics with Agentic Reward Feedback (2510.23272) · Aalto Interface Metrics (UIST 2018 — reuse for any pixel-tier metric instead of reimplementing; per-metric provenance seeds sourceRefs) · OmniScore (2604.05083 — small learned scorers as a possible future middle tier) · Caption (UIST 2025 — next-screen context improves label accuracy; recorded as the only evidence for narrowly reopening interaction-simulation).
