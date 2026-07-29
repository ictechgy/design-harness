# Evidence-backed visual metrics contract

Status: approved frozen contract; implementation completed 2026-07-26, not released

Contract version: 2026-07-26

Applies to: typography variant count, palette count discipline, and viewport
density complexity

This document freezes the operational semantics for the visual-metrics bundle
before browser/runtime integration. It is an implementation contract, not a
claim that the measurements determine design quality.

The cited research supports directional relationships between some measurable
properties and human ratings. It does not establish universal budgets, the
engineering constants below, or a complete model of visual quality. Exact
computation therefore does not upgrade any of these criteria: every finding is
`research-emerging`, `heuristic`, low-severity, low-confidence `risk`.

## 1. Bundle boundary

The three metrics and their three matching generation-guide rules form one
atomic bundle:

| Metric | Config section | Criterion ID | Check name |
| --- | --- | --- | --- |
| Typography variants | `audit.typographyVariants` | `typography.variant-count.budget` | `typography-variant-count-budget` |
| Palette discipline | `audit.paletteDiscipline` | `color.palette.count-discipline` | `palette-count-discipline` |
| Density complexity | `audit.densityComplexity` | `layout.density.complexity-budget` | `density-complexity-budget` |

There are no default budgets. An absent section causes no metric-specific
guide rule, source-hash input, browser traversal, summary, notice, failed-check
entry, finding, or score effect. Existing always-on `layoutMetrics`, token
adherence, saturated-color noise, copy, accessibility, and report behavior
remain unchanged.

Low values never create findings, rewards, or positive quality claims.
Equality to a budget does not create a finding; only an observed count greater
than the configured budget does.

## 2. Public configuration and normalized policies

The optional closed sections under `DesignGuideAudit` are:

```yaml
audit:
  typographyVariants:
    maxDistinctVariants: 8
    ignoreSelectors:
      - ".third-party-widget"
  paletteDiscipline:
    maxDistinctColors: 24
    maxChromaticHueFamilies: 4
    ignoreSelectors:
      - ".embedded-chart"
  densityComplexity:
    maxVisibleElements: 120
    maxTextClusters: 48
    ignoreSelectors:
      - ".vendor-panel"
```

The numbers above demonstrate syntax only. They are not recommended values.

Exact keys and safety bounds:

| Section | Required budget keys | Optional keys | Safety range |
| --- | --- | --- | --- |
| `typographyVariants` | `maxDistinctVariants` | `ignoreSelectors` | integer `1..2000` |
| `paletteDiscipline` | at least one of `maxDistinctColors`, `maxChromaticHueFamilies` | the other budget, `ignoreSelectors` | colors integer `1..5000`; hue families integer `1..12` |
| `densityComplexity` | at least one of `maxVisibleElements`, `maxTextClusters` | the other budget, `ignoreSelectors` | visible elements integer `1..10000`; text clusters integer `1..20000` |

A present section must contain at least one budget. `ignoreSelectors` alone is
invalid. The integer maxima are collection and memory-safety ceilings, not
aesthetic recommendations.

### Choosing a budget value

Derive every budget from a measured run, never from intuition. Each metric
counts something narrower than its name suggests, so an estimate is typically
wrong by close to an order of magnitude:

- `maxVisibleElements` counts `visible-content-elements-v1` visible **owners**,
  not every visible DOM node. Measured 2026-07-27 on one real page: 47 owners
  where a plain DOM visibility sweep counted 420 elements.
- `maxDistinctVariants` counts normalized family-stack + size + weight + style
  tuples on direct-text candidates, not the number of styles a designer would
  name. The same page measured 14.
- `maxDistinctColors` counts distinct nontransparent computed RGBA8 paint
  values across evaluated slots, not palette entries. The same page measured 13.

The supported procedure is:

1. configure the section once with a deliberately generous maximum;
2. run the audit and read the reported counts for each viewport;
3. set the budget from those counts plus whatever headroom the project wants.

Because the budgets are per-viewport comparisons, check the mobile counts too —
they are frequently lower than desktop, so a single desktop-derived number can
silently never apply on mobile.

This procedure produces a project decision. It does not make the resulting
number correct, transferable to another project, or evidence of quality.

When present, `ignoreSelectors` contains 1–32 exact-unique, trim-stable strings
of 1–256 safe Unicode scalar values. The Core validator rejects unpaired
surrogates, control characters, and bidi controls using the existing selector
policy. The browser validates every selector with
`document.documentElement.matches(selector)` before traversal. A selector
syntax or evaluation error discards only that metric summary and records a
detector-scoped failed check/partial result.

Selectors are metric-owned. An element is ignored when it or an ancestor
matches one of that metric's selectors. A typography selector never changes
palette or density, and the new selectors never change existing
`audit.fontFamily`, `audit.color`, or `audit.spacing` checks.

### 2.1 Frozen identifiers

| Metric | Policy ID | Method ID |
| --- | --- | --- |
| Typography | `typography-variant-budget-v1` | `rendered-typography-variants-v1` |
| Palette | `palette-discipline-budget-v1` | `rendered-rgba8-oklch-cover30-v1` |
| Density | `density-complexity-budget-v1` | `viewport-dom-density-v1` |

Density additionally records:

- `visibleElementMethodId: "visible-content-elements-v1"`
- `textClusterMethodId: "text-flow-connectivity-v1"`

Core exposes a runtime projection containing configured budgets, selectors,
and the frozen IDs, and a generation projection containing the same budgets
and IDs but no selectors. Both audit and bounded-loop execution consume the
runtime projection. Guide rules and the guide source hash consume the
generation projection.

Changing a budget or any method/policy ID changes guide rules and the source
hash. Changing only `ignoreSelectors` changes runtime behavior but not guide
rules or the source hash. Existing selector-only audit overlays remain excluded
from generation.

## 3. Common viewport and accounting rules

All metrics are measured once per configured viewport at the page's current
scroll position against the layout viewport:

```text
[0, window.innerWidth) × [0, window.innerHeight)
```

The collectors do not scroll and do not inspect below-fold pixels. Fixed and
sticky content counts when it intersects the current viewport. Rectangles that
only touch a viewport edge do not intersect:

```text
rect.right > 0
and rect.bottom > 0
and rect.left < window.innerWidth
and rect.top < window.innerHeight
```

The browser work remains inside the existing single `page.evaluate` closure.
Node-side pure functions perform parsing, normalization, clustering, summary
validation, and finding materialization.

Every metric records exact whole-set counts before bounding evidence samples.
Every summary carries its policy and method IDs. Optional summaries live only
under `ViewportMeasurements` and the existing open
`measurement-${viewport}.data` evidence asset. No top-level `AuditResult`
field, schema-version bump, enum, runtime kind, source-strength kind, or
dependency is added.

A safety-cap breach, invalid selector, unexpected collection exception, or
failed accounting invariant discards that metric's summary and creates a
detector-scoped partial result. It never becomes a truncated count, zero, pass,
or clean result.

Expected unsupported evidence may produce a lower-bound component when the
component's count is provably monotone under omitted candidates. This applies
to typography distinct variants, palette distinct colors, palette hue
families, density visible elements, and the distinct represented flow-root
count used only for partial text evidence. Such a lower bound may create a
sound risk when it already exceeds the configured budget. A non-exceeding
lower bound creates no finding and must not be described as a pass or clean
result. The supported-only text connected-component count remains explicitly
excluded because omitted fragments may bridge observed components.

At most one finding per metric per viewport is emitted. When a two-budget
metric exceeds both budgets, one finding records both overages. Evidence
contains every configured value, every observed uncapped total, coverage,
bounded samples, and omitted-sample counts.

## 4. Typography variant count

### 4.1 Candidates and visibility

Enumerate `document.body` followed by `document.body.querySelectorAll("*")` in
DOM order. Only `HTMLElement` candidates with at least one direct,
non-whitespace `Text` child qualify. Descendant text alone does not qualify an
ancestor.

A candidate is visible only when:

1. computed `display` is not `none`;
2. computed `visibility` is exactly `visible`;
3. its bounding rectangle has positive width and height;
4. its rectangle strictly intersects the current viewport; and
5. no HTML ancestor, including itself, has finite computed opacity exactly
   zero.

Metric selector exclusions are applied after candidate visibility and before
tuple evaluation. The candidate safety cap is 2,000, including ignored
candidates. Candidate 2,001 discards the typography summary.

### 4.2 Exact tuple

For every evaluated candidate, collect computed `font-family`, `font-size`,
`font-weight`, and `font-style`. A `font-family` value longer than 1,024 Unicode
scalars, an unparseable component, or a non-finite/out-of-range value is an
explicit skipped candidate and makes the summary a lower bound.

Normalize the tuple as follows:

1. Parse the computed family serialization with the existing CSS family-list
   parser.
2. Preserve member order, duplicates, and `named` versus `generic` kind.
3. Decode CSS escapes; apply ASCII case folding to each decoded family value.
   Do not apply Unicode normalization.
4. Represent each member as `kind + U+0000 + foldedValue`.
5. Parse the finite positive computed size in CSS pixels and store
   `round(sizePx × 1000)` as integer millipixels.
6. Normalize `normal` weight to 400 and `bold` to 700. Otherwise parse a finite
   numeric weight in `1..1000`, then store `round(weight × 1000)` as an integer
   milliweight. The keyword values are also stored in milliweight units.
7. Normalize style to `normal`, `italic`, or
   `oblique:<integerMicrodegrees>`. Bare `oblique` means 14 degrees. A finite
   explicit `deg` angle is stored as `round(angle × 1_000_000)`.

The identity is the canonical JSON serialization of:

```text
{
  families: ordered family identities,
  sizeMilliPx,
  weightMilli,
  style
}
```

This counts computed family stacks. It must never be described as a
glyph-resolved font face or proof of which downloaded font rendered a glyph.
No modular-scale, font-pairing, near-duplicate-size, or quality judgment is
part of this method.

Coverage invariant:

```text
candidateElementCount =
  evaluatedElementCount + ignoredElementCount + skippedElementCount
distinctVariantCount <= evaluatedElementCount
```

Retain at most five variant examples and five
selector/region locations per example. Sort examples by affected element count
descending, then canonical tuple identity in Unicode code-point order. Counts
remain exact when evidence is truncated.

Boundary examples:

- A parent with only descendant text contributes no tuple.
- In `<p>x <strong>y</strong></p>`, both elements contribute when both have
  direct text.
- Family case changes alone do not split a tuple; family order does.
- `normal` and numeric `400` are the same weight.
- Bare `oblique` and `oblique 14deg` are the same style.
- Size values that quantize to the same millipixel are the same size.

## 5. Palette count discipline

### 5.1 Paint candidates

Enumerate, in order:

1. `document.documentElement`;
2. `document.body`; and
3. every descendant of `body`.

Only `HTMLElement` values qualify. Visibility is the typography visibility
rule above.

Potential paint slots are:

- `color` when the element has a direct non-whitespace text child, using
  computed `-webkit-text-fill-color` and falling back to computed `color`;
- one `background-color` when computed `background-image` is `none`; and
- each border-side color independently when its width parses greater than
  zero, its style is neither `none` nor `hidden`, and
  `border-image-source` is `none`.

The 5,000-slot safety cap counts every potential slot, including ignored
slots, before parsing. Potential slot 5,001 discards the palette summary.

This is a computed CSS paint-slot metric, not a pixel or compositing metric.
Gradients, images, pseudo-elements, SVG paint, shadows, replaced-element
pixels, and occlusion are out of scope. Their absence from the candidate set
must be named in documentation; it is not evidence that the rendered pixels
contain no additional colors.

### 5.2 RGBA8 identity

Use the existing computed-color parser for:

- `rgb()` and `rgba()`;
- `oklab()` and `oklch()`, converted to clipped sRGB; and
- `color(srgb ...)`.

Unsupported color spaces and unparseable values are skipped as
`unsupported-color`. Computed color text longer than 256 Unicode scalars is
skipped as `computed-color-too-long`.

Clamp and quantize a parsed color:

```text
R8 = round(clamp(red,   0, 255))
G8 = round(clamp(green, 0, 255))
B8 = round(clamp(blue,  0, 255))
A8 = round(clamp(alpha, 0, 1) × 255)
identity = "R8,G8,B8,A8"
```

`A8 == 0` is ignored before distinct-color and hue-family counting. Distinct
color count is the cardinality of identities across all evaluated
properties/elements. Property, selector, frequency, and position do not split
an identity; different alpha bytes do.

Coverage invariant:

```text
candidateSlotCount =
  evaluatedSlotCount + ignoredSlotCount + skippedSlotCount
distinctColorCount <= evaluatedSlotCount
```

Retain at most five distinct-color examples and five
selector/property/region locations per example. Sort examples by occurrence
count descending, then numeric `(R8,G8,B8,A8)`, then selector/property by
Unicode code-point order. Exact totals and omitted counts remain in evidence.

### 5.3 Chromatic hue families

Hue uses each distinct nontransparent RGB byte triple once. Alpha variants can
increase `distinctColorCount` but collapse to the same hue input.

Decode each sRGB byte using binary64 arithmetic:

```text
u = byte / 255
linear(u) = u / 12.92                         when u <= 0.04045
          = ((u + 0.055) / 1.055) ** 2.4      otherwise
```

Convert linear `r`, `g`, and `b` to OKLab:

```text
l = cbrt(0.4122214708r + 0.5363325363g + 0.0514459929b)
m = cbrt(0.2119034982r + 0.6806995451g + 0.1073969566b)
s = cbrt(0.0883024619r + 0.2817188376g + 0.6299787005b)

a = 1.9779984951l - 2.4285922050m + 0.4505937099s
b = 0.0259040371l + 0.7827717662m - 0.8086757660s
Cq = round(hypot(a, b) × 1_000_000)
```

A color is achromatic when `Cq < 30_000`; equality is chromatic. Achromatic
colors never enter hue clustering.

For chromatic colors:

```text
TURN = 360_000_000
SPAN = 30_000_000
hq = mod(
  round(mod(atan2(b, a) × 180 / PI, 360) × 1_000_000),
  TURN
)
H = sorted unique hq values
```

The hue-family count is the minimum number of closed clockwise arcs of width
`SPAN` that cover `H`:

```text
if H is empty: return {count: 0, starts: []}
best = none
for each rotation i in 0..H.length-1:
  U[j] = H[(i+j) mod H.length], adding TURN after wrap
  starts = []
  j = 0
  while j < H.length:
    start = U[j]
    starts.push(start mod TURN)
    consume every U[j] <= start + SPAN
  candidate = starts sorted numerically
  select candidate when it has fewer starts
  on equal length, select the lexicographically smaller candidate
return {count: best.length, starts: best}
```

The method is invariant to input order and duplicates, handles circular wrap,
and is monotone: adding a chromatic hue cannot reduce the family count. It is a
fixed-span cover, not fixed bins, single-link clustering, or a hue-harmony
template.

Adversarial vectors:

- `{359°, 1°}` → one family.
- `{0°, 30°}` → one family.
- `{0°, 30.000001°}` → two families.
- `{0°, 25°, 50°}` → two families; bridge chaining must not collapse it to
  one.
- `Cq == 29_999` is achromatic; `Cq == 30_000` is chromatic.
- Opaque red plus half-alpha red → two distinct RGBA colors, one hue family.
- Permutation, duplicates, or added achromatic grays do not change the cover.

The `0.030` OKLCH chroma cutoff and 30-degree span are versioned operational
constants. They are not research-validated taste boundaries. The upper
configuration bound of 12 hue families follows only from twelve 30-degree arcs
covering a circle.

### 5.4 Coexistence

Palette discipline remains independent of:

- `off-palette-color`, which checks exact rendered membership against explicit
  project tokens; and
- `saturated-color-noise-risk`, which retains its existing background-only,
  area, saturation, lightness, and count gates.

The checks answer different questions and may coexist. No cross-check
deduplication or epistemic upgrade is allowed.

## 6. Density complexity

Density is a conservative DOM-tier proxy for viewport content structure. It
does not reproduce screenshot segmentation, resolve visual occlusion, or
measure pixel edge density.

### 6.1 Frozen constants

```text
MAX_DOM_ELEMENTS = 10_000
MAX_TEXT_NODES = 20_000
MAX_TEXT_FRAGMENTS = 20_000
MAX_EDGE_TESTS = 1_000_000
MAX_EVIDENCE_SAMPLES = 10

MIN_VERTICAL_OVERLAP = 0.50
MAX_INLINE_GAP_HEIGHTS = 1.00
MIN_NEXT_LINE_X_OVERLAP = 0.25
MAX_NEXT_LINE_GAP_HEIGHTS = 1.00
MAX_LEFT_EDGE_DELTA_HEIGHTS = 1.00
```

The geometry coefficients define reproducible topology. They are not quality
thresholds.

### 6.2 Excluded subtrees and visibility

Before eligibility, exclude:

- `script`, `style`, `noscript`, and `template` subtrees;
- a subtree under an ancestor with `hidden` or `inert`;
- a subtree under an ancestor whose ASCII-lowercased `aria-hidden` value is
  exactly `true`; and
- descendants of `svg`, `canvas`, `iframe`, `object`, or `embed`. The render
  surface itself may count once.

A box is visible when:

1. computed `display` is not `none`;
2. computed `visibility` is exactly `visible`;
3. no ancestor, including itself, has finite computed opacity exactly zero;
4. at least one `getClientRects()` rectangle has positive size and strict
   viewport intersection; and
5. that rectangle retains positive area after intersection with every
   ancestor clipping box on an axis whose computed overflow is `hidden`,
   `clip`, `auto`, or `scroll`.

An element or ancestor with legacy `clip` other than `auto`, `clip-path` other
than `none`, or a non-`none` mask is unsupported. Omit the affected candidate
and record `unsupported-clip-or-mask`. This makes the visible-element component
a lower bound. For text, it replaces the unsafe supported-only connected-
component count with the distinct represented flow-root lower bound described
below. Occlusion by overlapping siblings is deliberately unresolved.

### 6.3 Visible-content elements

Count the union of the following owner elements, once each:

1. **Atomic UI/media owner.** The outermost eligible element matching:
   - `a[href]`, `button`, `input:not([type=hidden])`, `select`, `textarea`,
     `summary`;
   - `[contenteditable]:not([contenteditable=false])`;
   - `[tabindex]:not([tabindex="-1"])`;
   - roles `button`, `link`, `checkbox`, `radio`, `switch`, `tab`, `menuitem`,
     `menuitemcheckbox`, `menuitemradio`, `option`, `slider`, `spinbutton`,
     `searchbox`, `textbox`, `combobox`, `listbox`, or `treeitem`; or
   - `img`, `svg`, `canvas`, `video`, `audio[controls]`, `iframe`, `object`,
     `embed`, `meter`, or `progress`.
2. **Direct-text owner.** Outside an atomic owner, an element with a direct
   non-whitespace `Text` child that produces at least one eligible visible text
   fragment under the minimal fragment test below.

An atomic owner's descendant atomic/media and direct-text owners collapse into
the outer owner for `visibleElementCount`. Structural wrappers do not count
solely because they have geometry, background, border, or shadow. Decorative
render surfaces still count because this is visual density, not accessible-name
validation.

This method must not reuse `meaningfulElementCount`, whose current scope and
ancestor behavior differ.

The visible-element collector always performs this minimal fragment test when
`maxVisibleElements` is configured, whether or not `maxTextClusters` is
configured:

1. For each direct non-whitespace text node of a non-atomic candidate, create a
   `Range` selecting that text node.
2. Apply the visibility, viewport, overflow clipping, and unsupported
   clip/mask rules from section 6.2 to its `Range.getClientRects()`.
3. Qualify the owner as soon as one positive clipped fragment is found.
4. If no fragment qualifies and at least one direct-text fragment was
   unsupported, classify the owner as skipped and make the visible-element
   component a lower bound. Otherwise classify it as ineligible.

This test does not build flow roots, retain cluster fragments, or run pairwise
edges. The full text-cluster traversal remains conditional on
`maxTextClusters`.

### 6.4 Text-flow clusters

The text traversal runs only when `maxTextClusters` is configured. Use a
`TreeWalker(document.body, NodeFilter.SHOW_TEXT)` and a `Range` selecting each
whole text node. Abort the density collector if the DOM, text-node, fragment,
or edge-test cap is exceeded.

Classify every text node exactly once:

- ignored by the metric selector;
- ineligible because of an excluded subtree, whitespace-only content,
  render-surface internals, invisible style, zero rectangles, viewport
  exclusion, or clipping;
- skipped because clip/mask semantics are unsupported; or
- evaluated.

For each evaluated text node:

1. Find its nearest ancestor, inclusive, whose computed `display` is neither
   `inline` nor `contents` and does not begin with `ruby`. Fall back to `body`.
   This is its flow root.
2. Read every `Range.getClientRects()` rectangle.
3. Clip each rectangle to the viewport and overflow-clipping ancestors.
4. Retain every positive clipped rectangle as a fragment with its flow-root
   identity and unrounded binary64 coordinates.

Group fragments by flow-root identity. Build an undirected graph within each
group. For every unordered fragment pair:

```text
increment edgeTests; abort if edgeTests > MAX_EDGE_TESTS

gapX = max(0, max(leftA,leftB) - min(rightA,rightB))
gapY = max(0, max(topA,topB) - min(bottomA,bottomB))
overlapX = max(0, min(rightA,rightB) - max(leftA,leftB))
overlapY = max(0, min(bottomA,bottomB) - max(topA,topB))
H = max(heightA,heightB)
h = min(heightA,heightB)
w = min(widthA,widthB)

adjacent =
  (gapX == 0 and gapY == 0)
  or (overlapY >= MIN_VERTICAL_OVERLAP × h
      and gapX <= MAX_INLINE_GAP_HEIGHTS × H)
  or (gapY <= MAX_NEXT_LINE_GAP_HEIGHTS × H
      and (overlapX >= MIN_NEXT_LINE_X_OVERLAP × w
           or abs(leftA-leftB) <= MAX_LEFT_EDGE_DELTA_HEIGHTS × H))
```

Union adjacent pairs. `textClusterCount` is the number of union-find connected
components across all flow roots. Union-find makes the count independent of
pair iteration and sort stability. Sorting is for evidence only, by
`(top,left,bottom,right,selector)` with Unicode code-point selector order.

Coverage invariants:

```text
elementUniverseCount =
  ignoredElementCount + ineligibleElementCount
  + skippedElementCount + visibleElementCount

textNodeUniverseCount =
  ignoredTextNodeCount + ineligibleTextNodeCount
  + skippedTextNodeCount + evaluatedTextNodeCount

0 <= textClusterCount <= textFragmentCount
omittedElementSamples = visibleElementCount - emittedElementSamples
omittedClusterSamples = textClusterCount - emittedClusterSamples
```

Retain at most ten visible-element and ten cluster samples. Exact totals,
edge-test count, skipped-by-reason maps, and omitted counts remain in evidence.

Coverage is component-specific:

- `visibleElementCoverage` is `complete` when there are no skipped element
  candidates and `lower-bound` otherwise. A lower-bound visible-element count
  may emit a risk when it already exceeds `maxVisibleElements`.
- `textClusterCoverage` is `complete` when no text candidate or fragment was
  skipped and all invariants hold. Complete evidence uses
  `text-flow-connectivity-v1`.
- When text evidence is skipped, report `coverage: lower-bound` and
  `lowerBoundMethodId: supported-flow-root-count-v1`. Its `textClusterCount` is
  the number of distinct `rootId` values represented by supported fragments.
  Set `edgeTestCount` to `null`, emit no samples, and set
  `omittedSampleCount` to that lower-bound count.
- The partial bound may create a text-cluster overage only when it already
  exceeds `maxTextClusters`. Equality or a lower value creates no finding and
  is never a pass. Record `density-text-clusters-incomplete` as a notice while
  keeping expected unsupported evidence out of `failedChecks`.

This split is load-bearing: adding an omitted fragment can connect two
supported components within one root and reduce the true full-fragment cluster
count, so the observed supported-only component count is not a lower bound.
Fragments from different flow roots never connect, so every represented root
still guarantees at least one full-evidence cluster.

Adversarial vectors:

- `<p>Hello <strong>world</strong></p>` → two visible-content owners and one
  text cluster.
- `<button><span>Save</span><svg/></button>` → one visible-content owner and
  one text cluster; SVG internals do not count.
- Two close paragraphs remain separate because they have different flow roots.
- A multiline paragraph forms one cluster when line fragments connect.
- CSS columns with no geometric bridge form separate clusters.
- Overlapping labels in separate block roots remain separate.
- Two supported fragments separated by one skipped fragment may appear as two
  components even when the skipped fragment would bridge them into one.
  Therefore the supported-only component count is discarded. If both supported
  fragments share one root, the partial lower bound is one; if they occupy two
  roots, the lower bound is two.
- An ignored card removes its full subtree from both counts.
- A rectangle that touches only a viewport edge is excluded; any positive
  subpixel intersection qualifies.
- A full-screen modal does not suppress intersecting background DOM unless the
  background is explicitly hidden/inert/ignored. This is a named limitation.

## 7. Criteria, findings, and score honesty

Register these sources:

- `ivory-sinha-hearst-2001`
- `odonovan-et-al-2011`
- `reinecke-et-al-2013`
- `miniukovich-marchese-2020`

Each criterion uses:

```text
sourceStrength: research-emerging
determinism: heuristic
resultKind: risk
runtime: computed-style
confidenceDefault: low
finding severity: low
```

One finding may be emitted for each configured metric and viewport. The
existing criterion-bounded scoring model counts a criterion once across
viewports. No new metric weight, reward, cross-viewport average, or overall
visual-quality claim is introduced.

Finding observations include:

- policy and method IDs;
- configured budgets;
- observed exact totals;
- every component overage;
- coverage status for compared components (`complete` or `lower-bound`), plus
  the partial text lower-bound method when present;
- skipped-by-reason counts;
- bounded samples and omitted counts.

A discarded summary cannot create a finding. An approved monotone lower-bound
component creates a finding only when it already exceeds its budget. Partial
text evidence uses only the represented-flow-root lower bound; its
supported-only connected-component count never creates an overage.

## 8. Generation projection and guide profile migration

Set:

```text
DESIGN_GUIDE_PROFILE_ID = "design-guide-v0.5a-2"
```

The compiler hashes the canonical shape:

```text
{
  profile,
  catalogVersion,
  guide,
  visualMetrics,
  copy,
  fingerprints
}
```

`visualMetrics` is the selector-free generation projection. It contains only
configured budgets and every frozen policy/method ID. Each configured section
adds one concise guide rule whose ID is its criterion ID, whose subject
contains the canonical projection, and whose rendered description or examples
name the measurement method. The rules say to stay within the project's
declared budget; they do not call the budget universally correct.

The maximum-config guide plus the maximum supported copy configuration must
remain within `GUIDE_TOKEN_HARD_CEILING`; add an exact ceiling regression test.

### 8.1 Recognized prior ownership

A profile bump must not turn Design Harness's immediately prior generated
tokens into foreign content. Recognize exactly this prior owned tuple:

```text
profile = "design-guide-v0.5a-1"
catalogVersion = "2026-07-18"
sourceHash = 64 lowercase hexadecimal characters
```

Migration behavior:

- Newly generated token JSON uses only the current profile.
- Existing `design.tokens.json` is replaceable only when ownership is current
  or matches the exact recognized-prior tuple.
- `guide check` treats recognized-prior content as stale and writes nothing.
- `guide compile` replaces recognized-prior content through the existing
  transaction and rollback path.
- Any other profile/catalog tuple remains an ownership error.

Tests must cover stale zero-write check, successful compile migration, unknown
ownership rejection, rollback, concurrency behavior, and the ordinary guide
smoke path. No historical audit producer versions are mechanically changed.

## 9. Calibration and CI gate

The bundle cannot merge on unit determinism alone.

Commit:

- three synthetic atomic good/bad fixture pairs, one pair per metric;
- `examples/ui-quality-fixtures/visual-metrics-calibration.json`; and
- a browserless exact-key/provenance/coverage validator.

The static validator is `check:visual-metrics-calibration` and runs under
`pnpm validate`, so `release:check` remains browserless. Live Playwright
calibration is `smoke:visual-metrics` and runs locally on demand and in the
browser-equipped CI `example-smoke` job. CI uploads `runs/visual-metrics`.

The committed manifest records fixture hashes, policy/method IDs, expected
counts and findings, the three closed pairs, and a merchant-dashboard
non-regression case. The six atomic cases and merchant case retain their full
exact measurement projections. The unrelated corpus uses the explicit
`visual-metrics-corpus-portable-v1` committed-hash profile: it omits only
`density.textClusters.textFragmentCount` and `density.textClusters.edgeTestCount`
because font-environment line wrapping changes those non-budget diagnostics.
Full audit evidence is still written, and the full projection including both
diagnostics must remain byte-repeatable across all three runs within the same
environment. Budget-bearing counts, coverage, findings, notices, status, and
failed checks remain in the gate. Any unexplained visual-metric risk on
existing unrelated fixtures, or any need for target-specific exceptions,
stops the entire bundle.

CI workflow artifact validation must know about the new smoke action and
artifact, and must explicitly reject adding the browser smoke to
`release:check`.

## 10. Non-goals and epistemic ceiling

This contract does not add or imply:

- universal typography, palette, or density defaults;
- typography pairing or modular-scale quality;
- color harmony, hue templates, lightness scoring, pixel color enumeration, or
  contrast replacement;
- low-density penalties or rewards;
- whitespace ratio, alignment/grid quality, symmetry, balance, below-fold
  sweep, interaction simulation, or pixel-tier density;
- a generic metric registry, capture adapter, hosted model, dependency, schema
  version, enum, release, or public positioning claim.

The strongest objection remains construct validity: identical pixels can have
different DOM structure, and identical DOM can paint differently through
occlusion, generated content, images, and unsupported effects. The cited
metric sets explain only part of human-rating variance, and none validates the
engineering constants in this contract as taste thresholds. Versioning makes
the measurements reproducible, not objectively correct. Closed calibration
and low/low heuristic-risk treatment are therefore release gates, not optional
polish.
