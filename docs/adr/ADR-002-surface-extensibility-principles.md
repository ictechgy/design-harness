# ADR-002: Surface Extensibility Principles — Capture-Agnostic Core, Evidence Layers, Demand-Gated Surfaces

- Status: Accepted
- Date: 2026-07-08
- Deciders: owner (directed 2026-07-08: lay groundwork so the harness can later audit apps and other design surfaces); evidence base: `docs/research/2026-07-surface-extensibility-evidence.md`

## Context

The owner wants Design Harness to remain extensible beyond web UIs — to mobile apps and, further, other design surfaces — without building any capture layer now. The evidence sweep found a uniform survival pattern across accessibility vendors (Deque, Evinced, Google ATF), visual-testing vendors (Applitools, Percy, Chromatic), and lint ecosystems (ESLint, textlint, Stylelint): one core that owns criteria/judgment/reporting, thin per-surface adapters that only extract and serialize evidence, a versioned data schema as the adapter contract, and surfaces added one at a time after demand is proven. Tools coupled to a capture engine died with it (PhantomCSS/PhantomJS; web-eval-agent archived 2026-06-27). Our core is already dependency-free and web-import-free; this ADR locks that in and states the rules that keep future surfaces possible at zero cost today.

## Decision

### 1. `@design-harness/core` is the surface-agnostic contract; capture engines are adapters

Criteria registry, policy matrix, schemas, scoring, report rendering, and the `audit.json`/`report.md` file contract never couple to a capture technology. `@design-harness/visual-audit` (Playwright) is the first capture adapter, not part of the core contract. Core never imports or depends on capture modules. *Enforced: `check:core-purity` in `pnpm validate`.* Adapters depend on core, version independently, and are replaceable behind the file contract (Appium 2.0 unbundling; axe family: separate engines per surface sharing one criteria layer).

### 2. Evidence-layer model: checks declare what they need; missing layers skip, never garbage

Evidence divides into four layers, and every capture path studied maps onto a subset of them:

1. **Rendered pixels** (screenshots)
2. **Semantic tree** — roles, names, states, bounds, rendered text; tree-generic, NOT DOM-anchored (web ariaSnapshot, Android `AccessibilityNodeInfo`, iOS XCUIElement, Flutter Semantics, Windows UIA all share this shape)
3. **Computed styles** (web DOM only, today)
4. **Declared design data** (design-guide.yaml / copy-style.yaml tokens; design-artifact styles)

Rules: (a) a check that cannot get a required **capture-produced** layer (1–3) **skips** (recorded as partial evidence, exit-code-2 semantics) instead of emitting garbage — the Flutter-web canvas case is the forcing example (all computed-style checks are garbage there); layer 4 is project-declared opt-in configuration, so its absence just means those checks are inactive, not that the audit is partial; (b) **evidence provenance can downgrade a finding's tier, never upgrade it** — the same contrast check is deterministic from declared colors but heuristic from sampled pixels (Google ATF encodes exactly this split with dedicated heuristic result IDs); this extends ADR-001's "computation determinism never upgrades criterion strength"; (c) capture integrity is schema-visible — truncated trees (iOS `snapshotMaxDepth` 60) and disabled semantics must surface as incomplete evidence, not silent passes.

Near-term hook (v0.4a item 3, current milestone): design the text-inventory and ariaSnapshot evidence assets tree-generic so they are the layer-2 reference shape.

### 3. A criterion is invariant intent plus per-surface bindings

The check family transfers across surfaces; thresholds, units, and source strengths do not (target size: 24 CSS px WCAG 2.2 official-testable on web vs 44pt/48dp vendor-HIG on native — `official-pattern`-tier platform guidance with a risk ceiling, never official-testable; a project may additionally pin them in its own design-guide.yaml, which is the `project-contract` path; visual metrics lose a third of their explanatory power web→mobile, CHI 2015; judge reliability has never been measured across surfaces). When a surface binding is added later, it names (threshold, unit system, source, mapping document + version) per surface — WCAG2ICT's per-SC triage is the template. Until a surface binding exists, running a check on an unvalidated surface gets Stylelint's honesty treatment: explicitly downgraded guarantees, never implied parity.

### 4. Surfaces expand demand-gated, one at a time, capture never owned

Gates before ANY new surface adapter (all required): (α) a real consumer of the file contract asks for that surface; (β) the v0.5 reins loop is proven on web; (γ) the evidence-layer contract (decision 2) is shipped; (δ) that surface's open questions in the evidence doc are resolved by hands-on probe. Precedents: Chromatic stayed single-surface ~7 years; ESLint shipped the plugin API first, then one language at a time. For native mobile, the target is a documented **evidence-bundle ingest format** that external Appium/adb/XCUITest/Maestro scripts produce — Design Harness never owns a device loop.

### 5. What does not change

Local-only input policy (hard rule 8) — widening `AuditTarget.kind` beyond local HTTP(S) (CDP endpoints, file input, any networked artifact API) requires its own ADR and owner approval per widening. Model neutrality and the no-hosted-dependency rule (Evinced's API-key-gated SDKs are the counterexample we differentiate against). Korean copy as the cross-surface asset: rendered text inventory survives every rendered-surface bridge studied, so the copy-audit investment compounds across surfaces.

## Consequences

- `check:core-purity` guards the boundary from today; zero capture code is added by this ADR.
- ROADMAP gains a "Surface horizons" section (ladder + gates + evidence-against list) that is explicitly not a milestone list.
- v0.4a item 3 inherits the tree-generic evidence-shape requirement — the only change to current-milestone work.
- Schema work implied by decisions 2–3 (evidence-layer declarations, per-surface bindings, provenance-tier plumbing) is NOT scheduled; it becomes concrete only when a horizon's gates pass, via its own ADR.

## References

- `docs/research/2026-07-surface-extensibility-evidence.md` (evidence + open questions)
- `docs/adr/ADR-001-copy-audit-foundations.md` (policy matrix this ADR extends with provenance downgrades)
- `docs/ROADMAP.md` Surface horizons section (the operational ladder)
