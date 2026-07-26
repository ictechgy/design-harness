# Manual-first Midjourney art direction

This workflow turns rights-cleared visual references into explicit,
project-owned decisions for the existing `design-guide.yaml` profile. It is a
manual decision aid, not image-to-token extraction, a design-quality score, or
a Midjourney integration.

## Hard stops

Stop before provider use when any of the following is true:

- the operator cannot establish rights to the prompt or uploaded reference;
- confidentiality cannot tolerate provider processing or public visibility;
- the task asks to imitate a named product, private design system, living
  artist, recognizable creator, or exact layout;
- proceeding would require a script, bot, scraper, browser automation,
  unofficial API, runtime dependency, or committed generated image;
- a cue cannot fit the current guide profile without a new field, alias,
  import, theme, or token group.

Generated and reference images stay under the ignored local asset policy in
[`workflow.md`](./workflow.md). Prompts, provider settings, resource
identifiers, and the decision worksheet also stay local. The tracked guide
contains accepted project decisions only.

## Artifact boundary

| Artifact | Location policy | Purpose |
| --- | --- | --- |
| This workflow and dated official links | Tracked | Stable manual contract |
| Generated/reference images | Local and ignored | Optional visual input |
| Prompt, settings, hashes, identifiers, worksheet | Local and ignored | Session provenance and decisions |
| `design-guide.yaml` | Consuming project choice | Accepted project decisions |
| Compiler-owned guide outputs | Consuming project choice | Existing generation pack and tokens |
| Calibration manifest and fixtures | Unchanged | Separate reference-to-fixture branch |
| Generic dry-run evidence | Ignored local experiment | Compatibility evidence only |

## Provider evidence, checked 2026-07-26

Provider behavior can change. Recheck these official pages before each session:

- [Terms of Service](https://docs.midjourney.com/hc/en-us/articles/32083055291277-Terms-of-Service):
  users remain responsible for necessary rights, automated access is
  restricted, and submitted or displayed content is public and remixable by
  default unless an applicable privacy mode changes that treatment.
- [Stealth Mode](https://docs.midjourney.com/hc/en-us/articles/32019750070669-Stealth-Mode):
  availability depends on the subscription, and creations made in shared
  Discord spaces remain visible there. Treat confidential input as a stop
  condition rather than treating Stealth as an absolute guarantee.
- [Style Reference](https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference):
  influences visual treatment rather than copying objects or people.
- [Moodboards](https://docs.midjourney.com/hc/en-us/articles/39193335040013-Moodboards):
  combine a broader collection of examples into an aesthetic direction.
- [Image Prompts](https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts):
  can influence content, composition, and color, so use them only when those
  influences are intentional.
- [Describe](https://docs.midjourney.com/hc/en-us/articles/32497889043981-Describe):
  returns variable prompt suggestions. Treat them as disposable vocabulary,
  not source analysis or recovered truth.
- [Model versions](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version):
  capabilities and aesthetics vary by version.

Record the exact model/version and selected mechanism locally. Provider UI,
defaults, parameter ranges, and output behavior are dated observations, not
Design Harness contracts. If current official documentation conflicts with
this page, stop and update the workflow before continuing.

## Stage 0 — write the local decision brief

Record locally:

- target project, surface, state, and user outcome;
- existing brand, accessibility, technical, and content constraints;
- what may change and what must remain;
- reference source, ownership, and rights basis;
- confidentiality and visibility decision;
- two or more useful diversity axes;
- prohibited imitation targets.

Output: a rights-cleared brief with a clear provider-use decision. No provider
account is required when the decision is to work from existing local,
rights-cleared references or the generic descriptions in
[`prompt-catalog.md`](./prompt-catalog.md).

## Stage 1 — Explore manually

1. Start from a generic archetype in `prompt-catalog.md`.
2. Choose one influence mechanism per controlled comparison:
   - Style Reference for a specific visual treatment;
   - Moodboard for a broader curated direction;
   - Image Prompt only when content or composition influence is wanted;
   - Describe only for vocabulary ideation.
3. Change one influence family at a time where feasible.
4. Retain contrasting directions and record at least one rejection reason.
5. Record model/version, mechanism, prompt, parameters, ownership, and
   visibility locally. Never copy those values into the guide or tracked docs.
6. Save any downloaded or generated image only under the ignored local asset
   path.

Output: local candidate references plus provenance. This step does not select a
winner automatically and does not authorize a best-of-N feature.

## Stage 2 — Distill observations into decisions

Copy this worksheet into a local record:

| Observed cue | Candidate project choice | Owner decision | Rationale and validation |
| --- | --- | --- | --- |
| Qualitative evidence only | Explicit supported value | Retain, reject, or defer | Project reason and next verification |

Keep each column epistemically separate:

- **Color:** choose 4–6 explicit semantic sRGB values and roles. A reference
  may inspire a candidate; it does not prove that a value was objectively
  extracted, harmonious, accessible, or correct.
- **Font:** record the typographic cue, then separately choose licensed,
  available `heading` and `body` stacks. A raster does not identify a font or
  its license.
- **Spacing and radius:** choose 2–12 deliberate non-negative `px` or `rem`
  values per group. Do not claim exact distances were recovered from pixels.
- **Prohibitions:** select 1–8 existing IDs from
  `datasets/slop-fingerprints.json`; this workflow cannot mint an ID.
- **Signature element:** write one generalized implementation motif, not a
  copied composition, product structure, or brand marker.
- **Optional audit policies:** add only explicit project exceptions or
  requirements. Never derive typography, palette, or density maxima from a
  reference image.

Rejected and deferred cues remain in the local worksheet with reasons. Only
retained project decisions move into the guide.

### Completed generic example

Input: the generic dense operational-dashboard good/bad descriptions already
in `prompt-catalog.md`. No provider session or image is required.

| Observed cue | Candidate project choice | Owner decision | Rationale and validation |
| --- | --- | --- | --- |
| Calm neutral canvas with one restrained action color | Semantic background, surface, text, and accent sRGB values matching the current example guide | Retain | Owner-authored roles; rendered contrast still needs separate implementation testing |
| Neutral sans-serif hierarchy | `heading` and `body` use `Inter`, then `sans-serif` | Retain after license and availability check | Selected separately; not a raster font identification |
| Compact rhythm with restrained rounding | Spacing `4px`, `8px`, `16px`, `32px`; radius `0px`, `8px` | Retain | Project-authored scale; not pixel extraction |
| Equal glossy cards and gradients across every section | Copy the repeated composition | Reject | Overfits the reference and conflicts with content-shaped grouping |
| Repeated decorative gradient and equal-card treatment | `decorative-gradient-without-purpose`, `generic-card-grid` | Retain as catalog prohibitions | Existing project-guidance IDs only |
| Slim outlined status treatment | “Use a compact outlined status rail as the recurring product signature.” | Retain | General implementation motif, not copied structure |
| Dense reference | Infer palette or density maxima | Reject | No explicit project requirement or measured implementation evidence |

The example deliberately adds no audit budget and makes no quality,
accessibility, or real-project usefulness claim.

## Stage 3 — Seed, compile, and check

1. Copy `examples/configs/design-guide.example.yaml` into the target project.
2. Apply only retained choices to the existing closed fields:
   `tokens.color.semantic`, `tokens.font.family`, `tokens.spacing`,
   `tokens.radius`, `prohibitions`, `signatureElement`, and any justified
   existing `audit` subtree.
3. Keep `--guide` and `--target` explicit and local.
4. On a clean target branch, run:

   ```bash
   pnpm design-harness -- guide compile \
     --guide <target>/design-guide.yaml \
     --target <target>

   pnpm design-harness -- guide check \
     --guide <target>/design-guide.yaml \
     --target <target> \
     --max-tokens 2000
   ```

5. Review only the compiler-owned guide blocks in `AGENTS.md`, `CLAUDE.md`,
   and `DESIGN.md`, plus `design.tokens.json`. Reject a misleading pack rather
   than hand-editing generated bytes.
6. Confirm a second `guide check` performs no writes.
7. After separately implementing a representative local surface, run the
   ordinary local audit with the same explicit guide. Interpret results only
   according to their existing criterion and source-strength contracts.

Output: one schema-valid project guide and current compiler-owned artifacts.
Compilation proves neither accessibility nor design quality.

## Stage 4 — real-project proof before any future CLI

Workflow v1 can land without this stage. `guide from-references` remains blocked
until all of the following exist:

1. one owner-selected real project and rights-cleared, non-confidential manual
   session;
2. a complete local experiment record;
3. a schema-valid guide that compiles and checks;
4. one implemented representative surface audited with that guide;
5. retained and rejected decisions plus privacy and false-precision review;
6. an owner usefulness verdict identifying repeated manual friction;
7. a fresh RALPLAN and explicit owner decision reopening the cut-list item.

That evidence does not pre-authorize image input, OCR, a VLM, provider
integration, or a network path.

## Adversarial decisions

| Proposal | Required result |
| --- | --- |
| Upload a private customer screenshot | Stop before upload |
| Imitate a named product, brand, or living artist | Reject |
| Treat Describe wording as recovered truth | Keep as disposable ideation only |
| Identify a font or exact spacing from a raster | Reject and select project values separately |
| Call an inspired palette accessible or harmonious | Reject the claim until appropriate rendered evidence exists |
| Infer an audit maximum from one reference | Reject |
| Add a guide or manifest field for an unrepresentable cue | Stop and replan |
| Commit a generated image or provider resource locator | Reject |
| Start a CLI/VLM after the generic dry-run | Keep the Stage 4 gate closed |

## Review and lapse test

Before committing the documentation branch, apply the art-direction additions
in [`review-checklist.md`](./review-checklist.md), verify that local assets
remain untracked, and run the repository checks in `workflow.md`.

The workflow passes the lapse test only when removing provider access breaks
nothing committed: the guide remains hand-authored, compile/check and audit
remain local, the generic descriptions remain usable, and no CI or runtime
path needs a generated image or provider account.
