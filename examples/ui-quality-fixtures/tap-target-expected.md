# Tap-target — expected geometry

Hand-computed reference for `tap-target-good.html` / `tap-target-bad.html`, written before the detector was
run against them. WCAG 2.2 SC 2.5.8 Spacing exception, conjunctive reading as implemented in
`packages/visual-audit/src/measurement-primitives.ts` (`tapTargetSpacingExempt`).

An undersized target (either dimension < 24px) is exempt when its 24px-diameter circle (radius 12, centred
on its bounding box) intersects **neither**:
- the bounding box of any other target (**rect test**, distance from this centre to that box ≥ 12), **nor**
- the 24px circle of any other *undersized* target (**circle test**, centre distance ≥ 24).

Intersection is strict: tangency (exactly 12, or exactly 24) is exempt. All coordinates are absolute, so
the geometry is identical at both viewports.

## `tap-target-bad.html` — three genuine violations

| id | box | centre | binding neighbour | test | result |
|---|---|---|---|---|---|
| `#cramp-a` | 16×16 @ (20,20) | (28,28) | `#cramp-b` circle | centre dist **20** < 24 | **flag** |
| `#cramp-b` | 16×16 @ (40,20) | (48,28) | `#cramp-a` circle | centre dist **20** < 24 | **flag** |
| `#disc` | 16×16 @ (88,120) | (96,128) | `#wide` box | centre→box **4** < 12 | **flag** |
| `#wide` | 60×16 @ (100,120) | (130,128) | nearest ≥ 12 / ≥ 24 | — | exempt |
| `#lonely` | 16×16 @ (300,300) | (308,308) | none within reach | — | exempt |
| `#big` | 44×44 @ (300,20) | — | not undersized | — | neighbour only |

**`#disc` is the discriminator.** Its circle reaches into `#wide`'s box (centre-to-box 4 < 12), so the
**rect test fires**. But their centres are 34px apart, so the **circle test alone would exempt it**. The
conjunctive reading — which this codebase implements — flags `#disc`; the asymmetric misreading (circle
test only against undersized neighbours) exempts it. A gate that pins `#disc` therefore rejects the wrong
predicate. `#wide` is itself undersized (16px tall) but clears every other target, so it does not fire.

Expected: **3 findings per viewport** — `#cramp-a`, `#cramp-b`, `#disc`.

## `tap-target-good.html` — silent

| id | box | centre | nearest neighbour | clearance | result |
|---|---|---|---|---|---|
| `#icon-a` | 16×16 @ (20,20) | (28,28) | `#icon-b` circle | centre dist **40** ≥ 24 | exempt |
| `#icon-b` | 16×16 @ (20,60) | (28,68) | `#icon-a` circle | centre dist **40** ≥ 24 | exempt |
| `#wide` | 60×16 @ (20,100) | (50,108) | `#small` box | ≥ 12 | exempt |
| `#small` | 16×16 @ (120,100) | (128,108) | `#wide` box | centre→box **44** ≥ 12 | exempt |
| `#ua-check` | 13×13 @ (20,200) | (26.5,206.5) | none within reach | — | exempt |

`#ua-check` is a 13×13 user-agent-default-sized checkbox. It is exempt **under Spacing**, with no
user-agent-control detection — which is the demonstration that the undecidable UA exception is unnecessary,
not merely asserted. Expected: **0 findings**.

## Why no user-agent-control exception

The UA-control exception ("size determined by the user agent and not modified by the author") is not
implemented, because it is undecidable from the DOM. Cloning tag+type into the same parent and measuring
reports an author-set `width: 13px` as "unmodified" when it coincides with the UA's 13px, and reports an
empty button's content-derived 16×6 as UA-default. And it is moot: the Spacing exception already exempts
every adequately spaced UA-sized control, as `#ua-check` shows.
