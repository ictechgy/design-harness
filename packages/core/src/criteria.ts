import type { Criterion, CriterionSource, Finding } from "./types.js";

export const CRITERION_SOURCES: CriterionSource[] = [
  {
    id: "wcag-2-2",
    title: "Web Content Accessibility Guidelines 2.2",
    url: "https://www.w3.org/TR/WCAG22/",
    strength: "official-testable",
    note: "Use only for scoped checks that Design Harness actually implements."
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
    id: "readability.line-length.reasonable",
    category: "visual-polish",
    title: "Reading line length remains reasonable",
    description: "Long-form text should avoid line lengths that are difficult to scan or read.",
    sourceRefs: ["govuk-layout"],
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
