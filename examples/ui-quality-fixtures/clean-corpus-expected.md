# Clean corpus — expected values

Hand-computed reference for the four `clean-corpus-*` fixtures, written **before** the contrast detector
was run against them. The tool is asserted to reproduce these numbers; where it disagrees, this document
is right until arithmetic says otherwise.

Method is WCAG 2.x as implemented in `relativeLuminance` / `contrastRatio`
(`packages/visual-audit/src/measurement-primitives.ts`): sRGB channel → `c/255` → linearize
(`c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`) → `L = 0.2126R + 0.7152G + 0.0722B` →
`(L_light + 0.05) / (L_dark + 0.05)`.

The threshold is WCAG 2.x's `0.03928`, not the sRGB specification's `0.04045`. The two are equivalent for
8-bit channels — no integer `v` satisfies `0.03928 ≤ v/255 ≤ 0.04045` — so every ratio in this document is
the same under either. They can diverge around the sixth decimal once alpha compositing produces fractional
channels, which is why the shipped constant is stated explicitly here.

Alpha compositing is `out = α·src + (1−α)·dst`, applied from the innermost declared layer outward until an
opaque layer or the document root is reached. The root is opaque in every fixture here, so no fixture
depends on a fallback background.

Thresholds follow SC 1.4.3 as implemented at `browser-measurements.ts`:
`fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5`.

**Three of the four pages contain a large-text row**, so the 3:1 branch is in play and each table below
records the required ratio per element. Headings inherit `font-weight: 700` from the user agent:
`#surface-heading` is an unstyled `h2` computing to 24px, while `#page-title` and `#tokens-heading` are
20px bold — all three take the 3:1 threshold. Every element carrying a *deliberate* violation is 15px
regular body text at 4.5:1.

---

## `clean-corpus-surface.html` — legacy `rgba()`, must stay silent

Layer stack: `html { background: #0b0f19 }` → `.surface { background: rgba(255,255,255,0.06) }`.

**Composited surface colour**

| channel | computation | result |
|---|---|---|
| R | 0.06·255 + 0.94·11 = 15.30 + 10.34 | **25.64** |
| G | 0.06·255 + 0.94·15 = 15.30 + 14.10 | **29.40** |
| B | 0.06·255 + 0.94·25 = 15.30 + 23.50 | **38.80** |

Composited surface = `rgb(25.64, 29.40, 38.80)`, relative luminance **L = 0.01258526**.

Channels are **not** rounded before the luminance step. Rounding to `rgb(26, 29, 39)` first reintroduces up
to 0.5/255 of error per channel and moves these ratios by up to 0.03 — enough to flip a verdict next to the
4.5 threshold. Rounding is presentational only: the `backgroundColor` recorded in evidence is the rounded
`rgb(26, 29, 39)`, while the arithmetic runs on the fractional value.

**Elements under test**

| selector | size/weight | required | declared colour | effective colour | ratio vs surface | expected |
|---|---|---|---|---|---|---|
| `#surface-heading` | 24px 700 | 3:1 | `#e6edf7` | `#e6edf7` (opaque) | **14.2377:1** | silent |
| `#surface-body` | 15px 400 | 4.5:1 | `#e6edf7` | `#e6edf7` (opaque) | **14.2377:1** | silent |
| `#surface-muted` | 15px 400 | 4.5:1 | `rgba(255,255,255,0.72)` | composited over the surface | **9.2017:1** | silent |

`#page-title` (20px 700, 3:1) sits outside `.surface`, so it is scored against the page root `#0b0f19` and
clears comfortably. It is correctly absent from the ledger even on the current build.

The muted label is the load-bearing case: its foreground alpha must be composited over the *composited*
surface, not over the raw `rgba(255,255,255,0.06)` string and not over the page root.

**Why this page fired before the repair.** `findEffectiveBackgroundColor` returned the string
`rgba(255, 255, 255, 0.06)` and `parseRgb` reads it as `(255, 255, 255)`, i.e. opaque white, L = 1.0. Every
row above is then scored against white: `#e6edf7` gives (1.05)/(0.89108) = **1.18:1**, which is below both
the 3:1 and the 4.5:1 branch, so all three rows are reported as violations regardless of threshold. The page
is correct; the measurement is not.

---

## `clean-corpus-surface-defective.html` — one real violation

Identical to the page above plus one element:

| selector | size/weight | required | declared colour | effective colour | ratio vs surface | expected |
|---|---|---|---|---|---|---|
| `#surface-too-faint` | 15px 400 | 4.5:1 | `rgba(255,255,255,0.25)` | composited over the surface | **2.2768:1** | **fires** |

2.2768 < 4.5. This is a genuine SC 1.4.3 failure and must survive every repair. It exercises the foreground
alpha path specifically: a detector that composites the background but not the foreground scores this
element as opaque `#ffffff` on the composited surface = **16.81:1** and lets it pass. That
16.81-vs-2.2768 gap is the entire reason this row exists, and the smoke gate asserts the ratio band so a
partial fix cannot pass by emitting the right count.

---

## `clean-corpus-tokens.html` — `oklch()` / `color-mix()`, must stay silent

Same geometry, colours authored in CSS Color 4. Chromium serialises these in their own space (probe
recorded in `.omx/artifacts/v05c-measurement-repair-20260720.md`), which is why the shipped parser fails
them closed as opaque black.

Layer stack: `html { background: oklch(0.18 0.02 260) }` → `.surface { background: color-mix(in oklab, white 6%, transparent) }`.

Conversion is oklch → oklab → linear sRGB → gamma-encoded sRGB.
`oklch(0.18 0.02 260)` → `rgb(12, 18, 26)`; the `color-mix(in oklab, white 6%, transparent)` surface
composites over it to `rgb(26.943457, 31.987741, 40.200084)`, **L = 0.014191716**.

| selector | size/weight | required | declared colour | converted sRGB | ratio vs surface | expected |
|---|---|---|---|---|---|---|
| `#tokens-heading` | 20px 700 | 3:1 | `oklch(0.95 0.01 260)` | `rgb(235,239,245)` | **14.1389:1** | silent |
| `#tokens-body` | 15px 400 | 4.5:1 | `oklch(0.92 0.01 260)` | `rgb(225,229,235)` | **12.9128:1** | silent |

Converted channel values may differ by ±1 from a given implementation's rounding. The assertion is the
pass/fail verdict and the ratio to one decimal place, not a byte-exact rounding contract.

**Why this page fired before the repair.** `parseRgb` matched only `rgba?(...)`. `oklch(...)` and `oklab(...)` return
the no-match fallback `{red: 0, green: 0, blue: 0, alpha: 1}` — opaque black — which also satisfies the
`alpha > 0` test, halting the ancestor walk at the first such layer. Foreground and background both resolve
to black, ratio ≈ 1.0, and every row is reported as a violation.

---

## `clean-corpus-tokens-defective.html` — one real violation

| selector | size/weight | required | declared colour | converted sRGB | ratio vs surface | expected |
|---|---|---|---|---|---|---|
| `#tokens-too-faint` | 15px 400 | 4.5:1 | `oklch(0.45 0.01 260)` | `rgb(82,85,91)` | **2.1991:1** | **fires** |

Below 4.5:1 once the conversion is correct. A detector that skips unparseable colours rather than
converting them reports nothing here — which is why the tokens pair is a *pair*: silence on the good page
is only meaningful if the defective page still speaks.

---

## Wrapper rows — expected to disappear, not to be re-scored

The detector selects `body *` with non-empty `innerText`, so ancestors that contain text but render none of
their own would be evaluated as if they did. The *renders its own direct text* guard removes them:

| page | wrapper row | why it appears |
|---|---|---|
| `clean-corpus-surface*` | `main > section` | inherits `#e6edf7`, reports the same text as its children |
| `clean-corpus-tokens*` | `main` | inherits the body colour, reports its section's text |

These are **not** additional colour pairs to verify — they are the same text counted more than once. The
*renders its own direct text* guard removes them, because neither element has a non-whitespace direct text
node. They are listed here so the ledger reconciles exactly: an entry not in the tables above and not in
this one is a genuine surprise.

`clean-corpus-tokens` shows one further wrapper effect worth naming: `main` is scored against the page root
`oklch(0.18 0.02 260)` rather than the surface, because `main` is not inside `.surface`. Once conversion
lands, `main` renders no direct text and drops out regardless.

## Out of scope for these fixtures

No page here carries a `tap-target-risk`, `status-live-region-risk`, `color-only-state-risk`,
`disabled-without-explanation`, or repeated-weight trigger. All interactive targets are ≥24px and spaced
well beyond 24px centre-to-centre. See the scope rule in `README.md`.
