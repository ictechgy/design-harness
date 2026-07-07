# Visual Metrics — Evidence Table

Evidence base for the computational-aesthetics check candidates (ROADMAP v0.5 slice and backlog), and the negative evidence behind the do-not-build entries on the cut list. Compiled 2026-07-07 from a multi-source research pass; every claim below is sourced to measured, peer-reviewed work unless marked otherwise.

## The variance ceiling (registry policy)

The best validated metric sets explain only **~30–50% of variance** in human aesthetic ratings:

- Reinecke et al., CHI 2013 (450 websites, 548 raters): computed complexity + colorfulness models explain adj R² = .48 of first-impression appeal; complexity dominates; high complexity is the largest appeal penalty. <https://kgajos.seas.harvard.edu/papers/reinecke13aesthetics.pdf>
- Miniukovich & De Angeli, CHI 2015: eight automatic GUI metrics explain up to 49% (webpages) / 32% (mobile apps) of aesthetics variance; 42% on an independent dataset. <https://dl.acm.org/doi/10.1145/2702123.2702575>

**Policy consequences** (also stated in `docs/criteria-and-checks.md`): computation determinism never upgrades criterion strength — these checks are deterministically computable but their criteria are research-grade, so they land as sourceStrength `research-emerging`/`industry-heuristic`, determinism `heuristic`, resultKind `risk`/`needs-review`; and the advisory score must never imply objective design quality.

## Positive evidence per candidate check

| Candidate | Evidence | Status |
|---|---|---|
| `color.palette.count-discipline` — distinct colors + chromatic hue-family count (flag > ~3–4 families) | Ivory, Sinha & Hearst, CHI 2001 (1,898 Webby pages): color count among 6 metrics significantly separating good/bad pages (65% accuracy; 80% within category). O'Donovan et al., SIGGRAPH 2011: people prefer ~2–3 distinct hues; lightness structure most predictive. <https://flamenco.berkeley.edu/papers/chi2001.pdf> · <https://www.dgp.toronto.edu/~donovan/color/colorcomp.pdf> | v0.5 slice |
| `typography.variant-count.budget` — distinct face+size+weight+style combinations | Ivory/Sinha/Hearst CHI 2001 operationalized font count exactly this way; significant good/bad separator. Modular-scale ratio enforcement has NO academic validation — at most a needs-review prompt for near-duplicate sizes. | v0.5 slice |
| `layout.density.complexity-budget` — visible-element + text-cluster counts (DOM tier); edge density/quadtree (pixel tier, future) | Reinecke 2013: complexity dominates first impressions. Miniukovich & Marchese, CHI 2020: relationship is inverse-linear once broken/archaic pages are controlled — penalize HIGH complexity only, never low. <https://dl.acm.org/doi/10.1145/3313831.3376602> | v0.5 slice |
| `layout.whitespace.ratio-band` — fraction of viewport not covered by content boxes, ~25–50% band | Coursaris & Kripintris 2012 (e-commerce experiment): usability degrades past 50% whitespace — a measured threshold, but single-study/single-context. Miniukovich 2015 whitespace metric correlated with ratings. | Backlog (single-study threshold) |
| `layout.alignment.grid-quality` — distinct left/right edge x-coordinates of sibling blocks; near-miss lines (1–8px) as risk | Miniukovich 2015: grid quality correlated with aesthetics. Threshold values are designer-derived, not validated. | Backlog |
| `readability.line-length` calibration — 50–75 cpl band, 55 optimum (Latin); ~40–45 (CJK, fixture-calibrated) | Dyson & Haselgrove 2001: ~55 cpl best comprehension; ~95 cpl faster but at comprehension cost. <https://www.sciencedirect.com/science/article/abs/pii/S1071581901904586> | v0.3.2 (lands with CJK fix) |

## Negative evidence — do not build

- **Hue-template color-harmony scoring**: O'Donovan 2011 found classic hue templates have no predictive power for theme ratings (template-matching themes scored slightly *lower*); inter-rater agreement on theme quality is only 52% — color harmony is substantially idiosyncratic. The evidence-backed alternative signal is **lightness-contrast structure** (convergent: O'Donovan 2011; Ou & Luo 2006; Schloss & Palmer 2011).
- **Mirror-symmetry / center-of-mass balance scoring for real UIs**: strong only on abstract stimuli (deviation-of-center-of-mass r = −0.82 to −0.92, Hübner & Fillinger 2016); Silvia & Barona 2009 found no substantial correlation on other stimuli. Fails to generalize to real interfaces.
- **Scored Korean readability**: KRIT (KAIST) reaches 0.746 accuracy on long-form textbook grade classification and its authors state no public datasets or baselines exist; nothing is validated for short UI strings. Raw informational metrics at most, unscored.

## 2026 LLM-UI evaluation additions (prior-art registry)

WebCoderBench (arXiv 2601.02430 — human-preference-aligned metric weighting, candidate technique for score aggregation) · 1D-Bench (2602.18548 — iterative editing beats post-training) · WebGen-R1 (2604.20398 — independent convergence on deterministic-gates-before-aesthetics) · ProductWebGen (2606.01022) · UI-UX mobile benchmark (2606.13192) · UI-Bench (2508.20410) · DesignBench (2506.06251) · FrontendBench (2506.13832) · Code Aesthetics with Agentic Reward Feedback (2510.23272) · Aalto Interface Metrics (UIST 2018 — reuse for any pixel-tier metric instead of reimplementing; per-metric provenance seeds sourceRefs) · OmniScore (2604.05083 — small learned scorers as a possible future middle tier) · Caption (UIST 2025 — next-screen context improves label accuracy; recorded as the only evidence for narrowly reopening interaction-simulation).
