import type { Criterion, CriterionSource, Finding } from "./types.js";

export const CRITERION_SOURCES: CriterionSource[] = [
  {
    id: "wcag-2-2",
    title: "Web Content Accessibility Guidelines 2.2",
    url: "https://www.w3.org/TR/WCAG22/",
    strength: "official-testable",
    note: "Use only for scoped checks that Design Harness actually implements.",
    // WCAG 2.2 success-criterion ids per criterion (ADR-001). KWCAG 2.2 clause
    // mapping lands as its own source entry with the v0.6 Korean market slice.
    clausesByCriterion: {
      "responsive.horizontal-overflow.none": ["1.4.10"],
      "a11y.text-contrast.minimum": ["1.4.3"],
      "a11y.name-role-value.present": ["4.1.2"],
      "a11y.form-label.present": ["1.3.1", "3.3.2", "4.1.2"],
      "a11y.image-alt.informative": ["1.1.1"],
      "hierarchy.heading-structure.sane": ["1.3.1", "2.4.6"],
      "hierarchy.landmarks.present": ["1.3.1", "2.4.1"],
      "a11y.language.page-lang": ["3.1.1"],
      "responsive.fixed-width.risk": ["1.4.10"],
      "a11y.target-size.minimum": ["2.5.8"],
      "a11y.form-error.associated": ["1.3.1", "3.3.1"],
      "a11y.color-only-state.risk": ["1.4.1"],
      "interaction.status.feedback": ["4.1.3"],
      "interaction.modal-focus.contained": ["2.1.2", "4.1.2"],
      "a11y.moving-content.controls": ["2.2.2"]
    }
  },
  {
    id: "iso-9241-210",
    title: "ISO 9241-210 Human-centred design for interactive systems",
    url: "https://www.iso.org/standard/77520.html",
    strength: "official-pattern"
  },
  {
    id: "nng-usability-heuristics",
    title: "Nielsen Norman Group Ten Usability Heuristics",
    url: "https://www.nngroup.com/articles/ten-usability-heuristics/",
    strength: "industry-heuristic"
  },
  {
    id: "govuk-layout",
    title: "GOV.UK Design System layout guidance",
    url: "https://design-system.service.gov.uk/styles/layout/",
    strength: "official-pattern"
  },
  {
    id: "carbon-accessibility",
    title: "IBM Carbon accessibility overview",
    url: "https://carbondesignsystem.com/guidelines/accessibility/overview/",
    strength: "industry-heuristic"
  },
  {
    id: "polaris-accessibility",
    title: "Shopify Polaris accessibility guidance",
    url: "https://polaris.shopify.com/foundations/accessibility",
    strength: "industry-heuristic"
  },
  {
    id: "agent-ui-arxiv-2605-02729",
    title: "Augmenting Interface Usability Heuristics for Reliable Computer-Use Agents",
    url: "https://arxiv.org/abs/2605.02729",
    strength: "research-emerging",
    note: "Exploratory, non-normative source. Do not use for pass/fail language."
  },
  {
    id: "vitsoe-good-design",
    title: "Vitsoe: Dieter Rams, Good Design",
    url: "https://www.vitsoe.com/us/about/good-design",
    strength: "philosophical",
    note: "Use for optional critique language only."
  },
  {
    id: "design-harness-output-contract",
    title: "Design Harness output contract",
    url: "docs/output-contract.md",
    strength: "official-testable",
    note: "Project-local contract for operational audit behavior."
  },
  {
    id: "unicode-icu-messageformat",
    title: "Unicode ICU MessageFormat",
    url: "https://unicode-org.github.io/icu/userguide/format_parse/messages/",
    strength: "official-testable",
    note: "Used for the narrowly detected ICU complex-argument syntax family."
  },
  {
    id: "mustache-spec",
    title: "Mustache specification",
    url: "https://github.com/mustache/spec",
    strength: "official-testable",
    note: "Used for language-agnostic double-brace variable syntax."
  },
  {
    id: "copy-style-contract",
    title: "Design Harness copy style contract",
    url: "packages/core/schemas/copy-style.schema.json",
    strength: "project-contract",
    note: "Project-declared copy rules are deterministic only against this configured contract."
  },
  {
    id: "design-guide-contract",
    title: "Design Harness design guide contract",
    url: "packages/core/schemas/design-guide.schema.json",
    strength: "project-contract",
    note: "Project-declared design tokens are deterministic only against this configured contract."
  },
  {
    id: "dyson-haselgrove-2001",
    title: "Dyson & Haselgrove: The influence of reading speed and line length on the effectiveness of reading from screen",
    url: "https://doi.org/10.1006/ijhc.2001.0458",
    strength: "research-emerging",
    note: "Measured Latin reading bands: ~55 characters per line reads best; ~95 reads faster at a comprehension cost. CJK comfortable measure is shorter (~40-45 characters)."
  }
];

export const CRITERIA: Criterion[] = [
  {
    id: "render.meaningful-content.present",
    category: "layout",
    title: "Meaningful content renders",
    description: "The captured page should render meaningful visible content before UI quality is evaluated.",
    sourceRefs: ["design-harness-output-contract"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "failure",
    confidenceDefault: "high",
    runtime: "static-dom",
    checkNames: ["blank-render", "render-failure"],
    remediationHint: "Fix render, navigation, loading, or root layout failures before evaluating UI quality."
  },
  {
    id: "responsive.horizontal-overflow.none",
    category: "responsiveness",
    title: "No unintended horizontal overflow",
    description: "The captured document should not exceed the viewport width in a way that forces horizontal scrolling.",
    sourceRefs: ["wcag-2-2", "govuk-layout"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "viewport-sweep",
    checkNames: ["horizontal-overflow"],
    remediationHint: "Constrain wide containers, media, tables, and fixed-width elements so content reflows within the viewport."
  },
  {
    id: "visual.text-clipping.none",
    category: "visual-polish",
    title: "Visible text is not clipped",
    description: "Visible text should not be cut off by fixed dimensions or overflow clipping.",
    sourceRefs: ["govuk-layout", "nng-usability-heuristics"],
    sourceStrength: "industry-heuristic",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "computed-style",
    checkNames: ["text-clipping"],
    remediationHint: "Allow the container to grow, wrap text, shorten copy, or adjust overflow styling."
  },
  {
    id: "visual.font-family.project-contract",
    category: "visual-polish",
    title: "Computed font families follow the configured guide",
    description: "Visible text computed font-family lists should contain only family names declared by the project design guide.",
    sourceRefs: ["design-guide-contract"],
    sourceStrength: "project-contract",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "high",
    runtime: "computed-style",
    checkNames: ["unapproved-font-family"],
    remediationHint: "Use the declared font-family tokens, update the project guide, or add a deliberate third-party selector exception."
  },
  {
    id: "a11y.text-contrast.minimum",
    category: "accessibility",
    title: "Text contrast meets configured threshold",
    description: "DOM-computed text and background colors should meet the configured WCAG-derived contrast threshold.",
    sourceRefs: ["wcag-2-2"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "computed-style",
    checkNames: ["dom-contrast-risk"],
    remediationHint: "Increase foreground/background contrast or adjust text size and weight for readability."
  },
  {
    id: "a11y.name-role-value.present",
    category: "accessibility",
    title: "Interactive controls expose names and roles",
    description: "Buttons, links, inputs, and custom controls should expose names and roles that humans and assistive technologies can use.",
    sourceRefs: ["wcag-2-2", "carbon-accessibility", "polaris-accessibility", "agent-ui-arxiv-2605-02729"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["missing-accessible-name", "custom-control-semantics-risk"],
    remediationHint: "Use native controls where possible, or provide programmatic names and roles for custom controls."
  },
  {
    id: "a11y.form-label.present",
    category: "accessibility",
    title: "Form controls have programmatic labels",
    description: "Form controls should have labels or equivalent accessible naming relationships.",
    sourceRefs: ["wcag-2-2", "polaris-accessibility"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["missing-form-label"],
    remediationHint: "Add a visible label, aria-label, aria-labelledby, or another programmatic label relationship."
  },
  {
    id: "a11y.image-alt.informative",
    category: "accessibility",
    title: "Informative images provide text alternatives",
    description: "Images that appear informative should provide an alt attribute or be intentionally marked decorative.",
    sourceRefs: ["wcag-2-2"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["missing-image-alt"],
    remediationHint: "Add meaningful alt text for informative images or mark decorative images with an empty alt attribute."
  },
  {
    id: "hierarchy.heading-structure.sane",
    category: "hierarchy",
    title: "Heading structure is understandable",
    description: "Pages should expose a clear heading structure without empty headings, severe skipped levels, or duplicate top-level ambiguity.",
    sourceRefs: ["wcag-2-2", "govuk-layout", "nng-usability-heuristics"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["empty-heading", "heading-level-skip", "duplicate-h1"],
    remediationHint: "Use headings to describe page and section structure in order."
  },
  {
    id: "hierarchy.landmarks.present",
    category: "hierarchy",
    title: "Core landmarks are present",
    description: "A page should expose landmark structure that identifies the main content and common navigation regions.",
    sourceRefs: ["wcag-2-2", "carbon-accessibility"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["missing-main-landmark"],
    remediationHint: "Use semantic landmarks such as main, nav, header, footer, or equivalent roles."
  },
  {
    id: "a11y.language.page-lang",
    category: "accessibility",
    title: "Page declares its language",
    description:
      "The document declares a non-empty lang attribute on the html element so assistive technology can select the correct speech engine and rendering rules.",
    sourceRefs: ["wcag-2-2"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "failure",
    confidenceDefault: "high",
    runtime: "static-dom",
    checkNames: ["page-lang-missing"],
    remediationHint: "Add a valid lang attribute to the html element, for example <html lang=\"ko\"> or <html lang=\"en\">."
  },
  {
    id: "content.labels.specific",
    category: "task-fit",
    title: "Task-critical labels are specific",
    description: "Repeated labels for interactive elements should be specific enough to distinguish actions.",
    sourceRefs: ["nng-usability-heuristics", "polaris-accessibility", "agent-ui-arxiv-2605-02729"],
    sourceStrength: "industry-heuristic",
    determinism: "heuristic",
    resultKind: "needs-review",
    confidenceDefault: "low",
    runtime: "static-dom",
    checkNames: ["ambiguous-repeated-label"],
    remediationHint: "Make repeated labels specific with visible text or accessible-name context."
  },
  {
    id: "hierarchy.visual-weight.priority-risk",
    category: "hierarchy",
    title: "Repeated modules preserve a scan path",
    description: "Repeated content modules should not flatten priority by giving many unrelated panels the same visual weight.",
    sourceRefs: ["iso-9241-210", "nng-usability-heuristics"],
    sourceStrength: "industry-heuristic",
    determinism: "heuristic",
    resultKind: "needs-review",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["repeated-visual-weight-risk"],
    remediationHint: "Create a clearer primary/secondary scan path with grouping, size contrast, sectioning, or reduced equal-weight repetition."
  },
  {
    id: "color.hierarchy.saturation-discipline",
    category: "hierarchy",
    title: "Saturated color preserves priority meaning",
    description: "Highly saturated colors should not appear across many unrelated regions in a way that makes every area compete for attention.",
    sourceRefs: ["iso-9241-210", "nng-usability-heuristics"],
    sourceStrength: "industry-heuristic",
    determinism: "heuristic",
    resultKind: "needs-review",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["saturated-color-noise-risk"],
    remediationHint: "Reserve saturated color for stable status, brand, grouping, or primary-action meaning instead of broad decoration."
  },
  {
    id: "state.checklist.activation-visibility",
    category: "interaction",
    title: "Checklist state is visible and consistent",
    description: "Checklist completed, active, and inactive states should be visually distinct while using consistent state treatment.",
    sourceRefs: ["nng-usability-heuristics", "polaris-accessibility"],
    sourceStrength: "industry-heuristic",
    determinism: "heuristic",
    resultKind: "needs-review",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["checklist-state-visibility-risk"],
    remediationHint: "Use stable color, icon, text, and row treatment so users can quickly identify completed, active, and inactive checklist items."
  },
  {
    id: "readability.line-length.reasonable",
    category: "visual-polish",
    title: "Reading line length remains reasonable",
    description:
      "Long-form text should avoid line lengths that are difficult to scan or read. Comfortable measure is roughly 50-75 Latin characters (55 optimum) or 40-45 CJK characters per line.",
    sourceRefs: ["govuk-layout", "dyson-haselgrove-2001"],
    sourceStrength: "official-pattern",
    determinism: "heuristic",
    resultKind: "risk",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["excessive-line-length"],
    remediationHint: "Constrain reading content width or use layout columns that preserve readable measure."
  },
  {
    id: "responsive.fixed-width.risk",
    category: "responsiveness",
    title: "Wide content does not block small viewports",
    description: "Large elements should not force small viewport overflow or brittle layout behavior.",
    sourceRefs: ["wcag-2-2", "govuk-layout"],
    sourceStrength: "official-pattern",
    determinism: "heuristic",
    resultKind: "risk",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["fixed-width-risk"],
    remediationHint: "Replace brittle wide sizing with responsive max-width, minmax, flex, grid, or container-relative sizing."
  },
  {
    id: "responsive.sticky-obstruction.risk",
    category: "responsiveness",
    title: "Sticky and fixed elements do not obscure content",
    description: "Sticky or fixed UI should not occupy enough viewport area to obscure primary content.",
    sourceRefs: ["nng-usability-heuristics", "govuk-layout"],
    sourceStrength: "industry-heuristic",
    determinism: "heuristic",
    resultKind: "risk",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["sticky-obstruction-risk"],
    remediationHint: "Reduce sticky/fixed element height, reserve layout space, or avoid covering primary content."
  },
  {
    id: "a11y.target-size.minimum",
    category: "accessibility",
    title: "Interactive targets meet minimum geometry",
    description: "Interactive controls should provide sufficient target size for pointer and touch interaction.",
    sourceRefs: ["wcag-2-2", "carbon-accessibility", "polaris-accessibility"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "computed-style",
    checkNames: ["tap-target-risk"],
    remediationHint: "Increase the control hit area or spacing so pointer and touch targets are easier to activate."
  },
  {
    id: "a11y.form-error.associated",
    category: "accessibility",
    title: "Form errors are programmatically associated",
    description: "Invalid form controls should expose error text or descriptions that users and assistive technologies can perceive.",
    sourceRefs: ["wcag-2-2", "polaris-accessibility"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["form-error-association-risk"],
    remediationHint: "Associate invalid controls with visible error text using aria-describedby, aria-errormessage, or equivalent relationships."
  },
  {
    id: "a11y.color-only-state.risk",
    category: "accessibility",
    title: "State is not communicated by color alone",
    description: "Error, warning, and success states should not rely only on color or decoration.",
    sourceRefs: ["wcag-2-2", "carbon-accessibility"],
    sourceStrength: "official-testable",
    determinism: "heuristic",
    resultKind: "risk",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["color-only-state-risk"],
    remediationHint: "Add visible text, icons with accessible names, or programmatic state so color is not the only cue."
  },
  {
    id: "interaction.disabled-state.explained",
    category: "interaction",
    title: "Disabled controls explain blocked actions",
    description: "Disabled or aria-disabled controls should provide enough nearby context to understand why the action is unavailable.",
    sourceRefs: ["nng-usability-heuristics", "polaris-accessibility"],
    sourceStrength: "industry-heuristic",
    determinism: "heuristic",
    resultKind: "needs-review",
    confidenceDefault: "low",
    runtime: "static-dom",
    checkNames: ["disabled-without-explanation"],
    remediationHint: "Provide nearby explanatory text, tooltip content, or validation guidance for disabled task-critical controls."
  },
  {
    id: "interaction.status.feedback",
    category: "interaction",
    title: "Dynamic status feedback is perceivable",
    description: "Loading, saving, success, and error states should be visibly and programmatically perceivable where dynamic workflows exist.",
    sourceRefs: ["wcag-2-2", "nng-usability-heuristics", "carbon-accessibility"],
    sourceStrength: "official-testable",
    determinism: "heuristic",
    resultKind: "risk",
    confidenceDefault: "low",
    runtime: "static-dom",
    checkNames: ["status-live-region-risk"],
    remediationHint: "Use visible status text and appropriate role/status, role/alert, progressbar, or aria-live patterns for dynamic updates."
  },
  {
    id: "interaction.modal-focus.contained",
    category: "interaction",
    title: "Modal dialogs expose modal and focus structure",
    description: "Visible dialogs should identify modal behavior and include focusable controls that support dismissal or action.",
    sourceRefs: ["wcag-2-2", "polaris-accessibility"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["modal-focus-risk"],
    remediationHint: "Use native dialog semantics where possible, set aria-modal for modal dialogs, and include focusable close/action controls."
  },
  {
    id: "a11y.moving-content.controls",
    category: "accessibility",
    title: "Moving or autoplaying content exposes controls",
    description: "Moving, animated, or autoplaying content should provide a visible way to pause, stop, hide, or control it.",
    sourceRefs: ["wcag-2-2"],
    sourceStrength: "official-testable",
    determinism: "heuristic",
    resultKind: "risk",
    confidenceDefault: "low",
    runtime: "computed-style",
    checkNames: ["moving-content-control-risk"],
    remediationHint: "Provide pause/stop/hide controls for moving or autoplaying content, or avoid non-essential motion."
  },
  {
    id: "content.placeholder.unrendered",
    category: "content",
    title: "Rendered copy does not expose supported placeholder markers",
    description:
      "Rendered UI copy should not expose supported Mustache variables, ICU complex arguments, or project-defined TODO and Lorem ipsum markers.",
    sourceRefs: ["unicode-icu-messageformat", "mustache-spec", "design-harness-output-contract"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "failure",
    confidenceDefault: "high",
    runtime: "static-dom",
    checkNames: ["placeholder-leak"],
    remediationHint: "Render the intended value or replace the operational marker before presenting the copy."
  },
  {
    id: "content.josa-hedge.policy",
    category: "content",
    title: "Rendered josa hedges follow the configured policy",
    description: "Rendered copy should not contain the configured 을(를) or 이(가) hedge forms when the project policy is flag.",
    sourceRefs: ["copy-style-contract"],
    sourceStrength: "project-contract",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "high",
    runtime: "static-dom",
    checkNames: ["josa-hedge"],
    remediationHint: "Resolve the rendered particle for the final noun, or set the project policy to allow deliberate hedge forms."
  },
  {
    id: "content.glossary.banned-term",
    category: "content",
    title: "Rendered copy avoids configured banned glossary terms",
    description: "Rendered copy should not contain a literal glossary term configured with the banned tier on an applicable surface.",
    sourceRefs: ["copy-style-contract"],
    sourceStrength: "project-contract",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "high",
    runtime: "static-dom",
    checkNames: ["glossary-banned-term"],
    remediationHint: "Replace the banned term with the configured preferred term or project-approved wording."
  },
  {
    id: "content.glossary.use-carefully-term",
    category: "content",
    title: "Rendered copy reviews configured use-carefully terms",
    description:
      "Rendered copy containing a literal glossary term configured with the use-carefully tier should be reviewed on an applicable surface.",
    sourceRefs: ["copy-style-contract"],
    sourceStrength: "project-contract",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "high",
    runtime: "static-dom",
    checkNames: ["glossary-use-carefully-term"],
    remediationHint: "Confirm the term fits this context or use the configured preferred term."
  },
  {
    id: "content.banned-phrase.policy",
    category: "content",
    title: "Rendered copy avoids configured banned phrases",
    description: "Rendered copy should not contain a literal phrase banned by the project on an applicable surface.",
    sourceRefs: ["copy-style-contract"],
    sourceStrength: "project-contract",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "high",
    runtime: "static-dom",
    checkNames: ["banned-phrase"],
    remediationHint: "Use the configured replacement or revise the phrase according to the recorded project rationale."
  }
];

const criteriaById = new Map(CRITERIA.map((criterion) => [criterion.id, criterion]));
const criteriaByCheckName = new Map(
  CRITERIA.flatMap((criterion) => criterion.checkNames.map((checkName) => [checkName, criterion] as const))
);

export function getCriterion(id: string): Criterion | undefined {
  return criteriaById.get(id);
}

export function getCriterionForCheck(checkName: string): Criterion | undefined {
  return criteriaByCheckName.get(checkName);
}

export function getSource(id: string): CriterionSource | undefined {
  return CRITERION_SOURCES.find((source) => source.id === id);
}

export function findingMetadataForCheck(checkName: string): Pick<
  Finding,
  "criterionId" | "sourceRefs" | "determinism" | "resultKind" | "runtime" | "confidence" | "humanReviewRecommended"
> | undefined {
  const criterion = getCriterionForCheck(checkName);
  if (!criterion) {
    return undefined;
  }

  return {
    criterionId: criterion.id,
    sourceRefs: criterion.sourceRefs,
    determinism: criterion.determinism,
    resultKind: criterion.resultKind,
    runtime: criterion.runtime,
    confidence: criterion.confidenceDefault,
    humanReviewRecommended: criterion.determinism !== "deterministic" || criterion.resultKind === "needs-review"
  };
}
