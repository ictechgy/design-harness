import type {
  AuditNotice,
  CopyStyleSurfaceRule,
  LayoutMetrics
} from "@design-harness/core";
import type { FindingCoverage, FindingCoverageEntry, ViewportMeasurements } from "./checks.js";
import type {
  ColorAdherenceCandidate,
  ColorAdherenceCollectionCounts,
  ColorAdherenceSkipReason,
  ColorPaintProperty
} from "./color-adherence.js";
import type {
  SpacingAdherenceCandidate,
  SpacingAdherenceCollectionCounts,
  SpacingAdherenceSkipReason,
  SpacingProperty
} from "./spacing-adherence.js";
import {
  computeContrastRisks,
  computeTapTargetRisks,
  type ContrastCandidate,
  type ContrastSkipReason,
  type TapTargetCandidate
} from "./measurement-primitives.js";

export interface ViewportCollectionResult {
  measurements: ViewportMeasurements;
  notices: AuditNotice[];
  layoutMetrics?: LayoutMetrics;
  findingCoverage?: FindingCoverage;
  fontFamilyCollection?: FontFamilyCollectionCounts;
  fontFamilyError?: FontFamilyMeasurementError;
  colorAdherenceCandidates?: ColorAdherenceCandidate[];
  colorAdherenceCollection?: ColorAdherenceCollectionCounts;
  colorAdherenceError?: ColorAdherenceMeasurementError;
  spacingAdherenceCandidates?: SpacingAdherenceCandidate[];
  spacingAdherenceCollection?: SpacingAdherenceCollectionCounts;
  spacingAdherenceRootFontSizePx?: number;
  spacingAdherenceError?: SpacingAdherenceMeasurementError;
  typographyVariantCandidates?: TypographyVariantCandidate[];
  typographyVariantCollection?: TypographyVariantCollectionCounts;
  typographyVariantError?: TypographyVariantMeasurementError;
  paletteDisciplineCandidates?: PaletteDisciplineCandidate[];
  paletteDisciplineCollection?: PaletteDisciplineCollectionCounts;
  paletteDisciplineError?: PaletteDisciplineMeasurementError;
  densityComplexityCollection?: DensityComplexityCollection;
  densityComplexityError?: DensityComplexityMeasurementError;
}

/**
 * What the page hands back: measurements with contrast left unscored.
 *
 * The closure is serialised to source text and evaluated in the page, so it cannot call imported helpers.
 * It therefore collects raw colour/style/geometry evidence and
 * `collectViewportMeasurements` scores or forwards it in Node, where the arithmetic is unit-testable.
 */
interface RawViewportCollectionResult extends ViewportCollectionResult {
  contrastCandidates: ContrastCandidate[];
  tapTargetCandidates: TapTargetCandidate[];
}

export interface ViewportMeasurementConfig {
  surfaceMapping?: CopyStyleSurfaceRule[];
  fontFamily?: {
    ignoreSelectors: string[];
  };
  color?: {
    ignoreSelectors: string[];
  };
  spacing?: {
    ignoreSelectors: string[];
  };
  typographyVariants?: {
    ignoreSelectors: string[];
  };
  paletteDiscipline?: {
    ignoreSelectors: string[];
  };
  densityComplexity?: {
    ignoreSelectors: string[];
    collectVisibleElements: boolean;
    collectTextClusters: boolean;
  };
}

export interface FontFamilyCollectionCounts {
  evaluatedElementCount: number;
  ignoredElementCount: number;
}

export interface FontFamilyMeasurementError {
  code: "invalid-selector" | "selector-evaluation" | "candidate-limit" | "computed-family";
  selectorIndex?: number;
  elementIndex?: number;
  candidateCount?: number;
  valueLength?: number;
  limit?: number;
}

export interface ColorAdherenceMeasurementError {
  code: "invalid-selector" | "selector-evaluation" | "candidate-limit" | "computed-color";
  selectorIndex?: number;
  elementIndex?: number;
  candidateCount?: number;
  limit?: number;
}

export interface SpacingAdherenceMeasurementError {
  code:
    | "invalid-selector"
    | "selector-evaluation"
    | "candidate-limit"
    | "computed-spacing"
    | "root-font-size";
  selectorIndex?: number;
  elementIndex?: number;
  candidateCount?: number;
  limit?: number;
}

export interface VisualMetricRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TypographyVariantCandidate {
  selector: string;
  region: VisualMetricRegion;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
}

export type TypographyVariantSkipReason = "font-family-too-long";

export interface TypographyVariantCollectionCounts {
  candidateElementCount: number;
  collectedElementCount: number;
  ignoredElementCount: number;
  skippedElementCount: number;
  skippedByReason: Partial<Record<TypographyVariantSkipReason, number>>;
}

export interface TypographyVariantMeasurementError {
  code:
    | "invalid-selector"
    | "selector-evaluation"
    | "candidate-limit"
    | "computed-style"
    | "accounting-invariant"
    | "collection-exception";
  selectorIndex?: number;
  elementIndex?: number;
  candidateCount?: number;
  limit?: number;
}

export interface PaletteDisciplineCandidate {
  selector: string;
  region: VisualMetricRegion;
  property: ColorPaintProperty;
  value: string;
}

export type PaletteDisciplineSkipReason = "computed-color-too-long";

export interface PaletteDisciplineCollectionCounts {
  candidateSlotCount: number;
  collectedSlotCount: number;
  ignoredSlotCount: number;
  skippedSlotCount: number;
  skippedByReason: Partial<Record<PaletteDisciplineSkipReason, number>>;
}

export interface PaletteDisciplineMeasurementError {
  code:
    | "invalid-selector"
    | "selector-evaluation"
    | "candidate-limit"
    | "computed-color"
    | "accounting-invariant"
    | "collection-exception";
  selectorIndex?: number;
  elementIndex?: number;
  candidateCount?: number;
  limit?: number;
}

export type DensityComplexitySkipReason = "unsupported-clip-or-mask";

export interface DensityVisibleElementSample {
  selector: string;
  region: VisualMetricRegion;
}

export interface DensityVisibleElementCollection {
  elementUniverseCount: number;
  visibleElementCount: number;
  ignoredElementCount: number;
  ineligibleElementCount: number;
  skippedElementCount: number;
  skippedByReason: Partial<Record<DensityComplexitySkipReason, number>>;
  samples: DensityVisibleElementSample[];
  omittedSampleCount: number;
}

export interface DensityTextFragment {
  rootId: string;
  selector: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DensityTextClusterCollection {
  textNodeUniverseCount: number;
  ignoredTextNodeCount: number;
  ineligibleTextNodeCount: number;
  skippedTextNodeCount: number;
  evaluatedTextNodeCount: number;
  skippedByReason: Partial<Record<DensityComplexitySkipReason, number>>;
  textFragmentCount: number;
  fragments: DensityTextFragment[];
}

export interface DensityComplexityCollection {
  visibleElements?: DensityVisibleElementCollection;
  textClusters?: DensityTextClusterCollection;
}

export interface DensityComplexityMeasurementError {
  code:
    | "invalid-selector"
    | "selector-evaluation"
    | "dom-limit"
    | "text-node-limit"
    | "fragment-limit"
    | "accounting-invariant"
    | "collection-exception";
  selectorIndex?: number;
  elementIndex?: number;
  textNodeIndex?: number;
  candidateCount?: number;
  limit?: number;
}

interface DensityClippedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type DensityVisibilityAssessment =
  | { kind: "visible"; rects: DensityClippedRect[] }
  | { kind: "ineligible" }
  | {
      kind: "skipped";
      reason: DensityComplexitySkipReason;
    };

export async function collectViewportMeasurements(page: {
  evaluate: <T>(pageFunction: ((arg?: unknown) => T | Promise<T>), arg?: unknown) => Promise<T>;
}, config?: ViewportMeasurementConfig): Promise<ViewportCollectionResult> {
  const raw = await page.evaluate((rawConfig): RawViewportCollectionResult => {
    const MAX_TEXT_INVENTORY_TEXT_LENGTH = 2_000;
    const MAX_FONT_FAMILY_CANDIDATES = 2_000;
    const MAX_COMPUTED_FONT_FAMILY_LENGTH = 1_024;
    const MAX_COLOR_ADHERENCE_SLOTS = 5_000;
    const MAX_COMPUTED_COLOR_LENGTH = 256;
    const MAX_SPACING_ADHERENCE_SLOTS = 25_000;
    const MAX_COMPUTED_SPACING_LENGTH = 256;
    const MAX_TYPOGRAPHY_VARIANT_CANDIDATES = 2_000;
    const MAX_COMPUTED_TYPOGRAPHY_FAMILY_LENGTH = 1_024;
    const MAX_PALETTE_DISCIPLINE_SLOTS = 5_000;
    const MAX_COMPUTED_PALETTE_COLOR_LENGTH = 256;
    const MAX_DENSITY_DOM_ELEMENTS = 10_000;
    const MAX_DENSITY_TEXT_NODES = 20_000;
    const MAX_DENSITY_TEXT_FRAGMENTS = 20_000;
    const MAX_DENSITY_EVIDENCE_SAMPLES = 10;
    const MAX_BROWSER_FINDING_SAMPLES = 10;
    const FINDING_MATERIALIZATION_LIMIT = 5;
    const measurementConfig = rawConfig && typeof rawConfig === "object"
      ? rawConfig as ViewportMeasurementConfig
      : undefined;
    const surfaceRules = Array.isArray(measurementConfig?.surfaceMapping)
      ? measurementConfig.surfaceMapping
      : [];
    const fontFamilyEnabled = measurementConfig?.fontFamily !== undefined;
    const fontFamilyIgnoreSelectors = Array.isArray(measurementConfig?.fontFamily?.ignoreSelectors)
      ? measurementConfig.fontFamily.ignoreSelectors
      : [];
    const colorAdherenceEnabled = measurementConfig?.color !== undefined;
    const colorAdherenceIgnoreSelectors = Array.isArray(measurementConfig?.color?.ignoreSelectors)
      ? measurementConfig.color.ignoreSelectors
      : [];
    const spacingAdherenceEnabled = measurementConfig?.spacing !== undefined;
    const spacingAdherenceIgnoreSelectors = Array.isArray(
      measurementConfig?.spacing?.ignoreSelectors
    )
      ? measurementConfig.spacing.ignoreSelectors
      : [];
    const typographyVariantsEnabled = measurementConfig?.typographyVariants !== undefined;
    const typographyVariantIgnoreSelectors = Array.isArray(
      measurementConfig?.typographyVariants?.ignoreSelectors
    )
      ? measurementConfig.typographyVariants.ignoreSelectors
      : [];
    const paletteDisciplineEnabled = measurementConfig?.paletteDiscipline !== undefined;
    const paletteDisciplineIgnoreSelectors = Array.isArray(
      measurementConfig?.paletteDiscipline?.ignoreSelectors
    )
      ? measurementConfig.paletteDiscipline.ignoreSelectors
      : [];
    const densityCollectVisibleElements =
      measurementConfig?.densityComplexity?.collectVisibleElements === true;
    const densityCollectTextClusters =
      measurementConfig?.densityComplexity?.collectTextClusters === true;
    const densityComplexityEnabled =
      densityCollectVisibleElements || densityCollectTextClusters;
    const densityComplexityIgnoreSelectors = Array.isArray(
      measurementConfig?.densityComplexity?.ignoreSelectors
    )
      ? measurementConfig.densityComplexity.ignoreSelectors
      : [];
    const notices: AuditNotice[] = [];
    const unusableMatcherKeys = new Set<string>();
    const noticeKeys = new Set<string>();
    const concreteAriaRoles = new Set([
      "alert",
      "alertdialog",
      "application",
      "article",
      "banner",
      "blockquote",
      "button",
      "caption",
      "cell",
      "checkbox",
      "code",
      "columnheader",
      "combobox",
      "complementary",
      "contentinfo",
      "definition",
      "deletion",
      "dialog",
      "directory",
      "document",
      "emphasis",
      "feed",
      "figure",
      "form",
      "generic",
      "grid",
      "gridcell",
      "group",
      "heading",
      "img",
      "insertion",
      "link",
      "list",
      "listbox",
      "listitem",
      "log",
      "main",
      "marquee",
      "math",
      "menu",
      "menubar",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "meter",
      "navigation",
      "none",
      "note",
      "option",
      "paragraph",
      "presentation",
      "progressbar",
      "radio",
      "radiogroup",
      "region",
      "row",
      "rowgroup",
      "rowheader",
      "scrollbar",
      "search",
      "searchbox",
      "separator",
      "slider",
      "spinbutton",
      "status",
      "strong",
      "subscript",
      "superscript",
      "switch",
      "tab",
      "table",
      "tablist",
      "tabpanel",
      "term",
      "textbox",
      "time",
      "timer",
      "toolbar",
      "tooltip",
      "tree",
      "treegrid",
      "treeitem"
    ]);
    const viewportName = document.documentElement.dataset.designHarnessViewport || "unknown";
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    let fontFamilyError: FontFamilyMeasurementError | undefined;
    let evaluatedFontFamilyElementCount = 0;
    let ignoredFontFamilyElementCount = 0;
    let colorAdherenceError: ColorAdherenceMeasurementError | undefined;
    let spacingAdherenceError: SpacingAdherenceMeasurementError | undefined;
    let typographyVariantError: TypographyVariantMeasurementError | undefined;
    let paletteDisciplineError: PaletteDisciplineMeasurementError | undefined;
    let densityComplexityError: DensityComplexityMeasurementError | undefined;

    prepareSurfaceMatchers();
    prepareFontFamilySelectors();
    prepareColorAdherenceSelectors();
    prepareSpacingAdherenceSelectors();
    prepareTypographyVariantSelectors();
    preparePaletteDisciplineSelectors();
    prepareDensityComplexitySelectors();

    const textElements = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return Boolean(element.innerText?.trim()) && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });

    const clippedTextMatches = textElements.filter((element) => {
      const style = window.getComputedStyle(element);
      const clipsOverflow = ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflowY);
      return clipsOverflow && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
    });
    const clippedTextDetectedCount = clippedTextMatches.length;
    const clippedText = clippedTextMatches
      .slice(0, MAX_BROWSER_FINDING_SAMPLES)
      .map((element) => sampleElement(element));

    // Collection only — parsing, ratio, and threshold happen in Node. See measurement-primitives.ts for
    // why this boundary exists: an imported helper would throw ReferenceError inside this serialised
    // closure, and audit-url.ts would swallow it as a failed check.
    //
    // `.filter(rendersOwnText)` is applied here and NOWHERE else. It must never touch `textElements`,
    // which clippedText, excessiveLineLength, and meaningfulElementCount also read.
    const canvasColor = measureCanvasColor();
    const contrastCandidates = textElements
      .filter(rendersOwnText)
      .map((element) => {
        const style = window.getComputedStyle(element);
        const paintEffectSkipReason = collectPaintEffectSkipReason(element);
        const backdrop = collectBackdrop(element);
        const sample = sampleElement(element);
        return {
          ...sample,
          text: directTextOf(element) || sample.text,
          // -webkit-text-fill-color paints the glyphs when set and defaults to `color` otherwise.
          color: style.webkitTextFillColor || style.color,
          backgroundLayers: backdrop.layers,
          canvasColor,
          fontSizePx: Number.parseFloat(style.fontSize || "16"),
          fontWeight: Number.parseInt(style.fontWeight || "400", 10),
          ...(backdrop.skipReason || paintEffectSkipReason
            ? { skipReason: backdrop.skipReason ?? paintEffectSkipReason }
            : {})
        };
      });

    const interactiveElements = Array.from(document.body.querySelectorAll<HTMLElement>([
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
      "[role='menuitem']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(","))).filter(isElementVisible);

    const missingAccessibleNameMatches = interactiveElements
      .filter((element) => !requiresProgrammaticFormLabel(element))
      .filter((element) => !accessibleNameFor(element));
    const missingAccessibleNameDetectedCount = missingAccessibleNameMatches.length;
    const missingAccessibleNames = missingAccessibleNameMatches
      .slice(0, MAX_BROWSER_FINDING_SAMPLES)
      .map((element) => sampleElement(element));

    const formControls = Array.from(document.body.querySelectorAll<HTMLElement>([
      "input:not([type='hidden']):not([type='button']):not([type='submit']):not([type='reset'])",
      "select",
      "textarea"
    ].join(","))).filter(isElementVisible);

    const missingFormLabelMatches = formControls.filter((element) => !accessibleNameFor(element));
    const missingFormLabelDetectedCount = missingFormLabelMatches.length;
    const missingFormLabels = missingFormLabelMatches
      .slice(0, MAX_BROWSER_FINDING_SAMPLES)
      .map((element) => sampleElement(element));

    const missingImageAltMatches = Array.from(document.body.querySelectorAll<HTMLImageElement>("img"))
      .filter(isElementVisible)
      .filter((element) => element.getAttribute("role") !== "presentation" && element.getAttribute("aria-hidden") !== "true")
      .filter((element) => !element.hasAttribute("alt"));
    const missingImageAltDetectedCount = missingImageAltMatches.length;
    const missingImageAlt = missingImageAltMatches
      .slice(0, MAX_BROWSER_FINDING_SAMPLES)
      .map((element) => sampleElement(element));

    const headingIssueCollection = collectHeadingIssues();
    const headingIssues = headingIssueCollection.samples;
    const missingMainLandmark = document.body.querySelector("main,[role='main']") === null;
    const pageLangMissing = (document.documentElement.getAttribute("lang") || "").trim() === "";
    const repeatedLabelCollection = collectRepeatedLabels(interactiveElements);
    const repeatedLabels = repeatedLabelCollection.samples;
    const repeatedVisualWeightRisks = collectRepeatedVisualWeightRisks();
    const saturatedColorNoiseRisks = collectSaturatedColorNoiseRisks();
    const checklistStateVisibilityRisks = collectChecklistStateVisibilityRisks();
    const fixedWidthRiskCollection = collectFixedWidthRisks();
    const fixedWidthRisks = fixedWidthRiskCollection.samples;
    const stickyObstructionRiskCollection = collectStickyObstructionRisks();
    const stickyObstructionRisks = stickyObstructionRiskCollection.samples;
    const excessiveLineLengthCollection = collectExcessiveLineLength(textElements);
    const excessiveLineLength = excessiveLineLengthCollection.samples;
    const tapTargetCandidates = collectTapTargetCandidates(interactiveElements);
    const formErrorAssociationRiskCollection = collectFormErrorAssociationRisks(formControls);
    const formErrorAssociationRisks = formErrorAssociationRiskCollection.samples;
    const colorOnlyStateRiskCollection = collectColorOnlyStateRisks();
    const colorOnlyStateRisks = colorOnlyStateRiskCollection.samples;
    const disabledWithoutExplanationCollection = collectDisabledWithoutExplanation();
    const disabledWithoutExplanation = disabledWithoutExplanationCollection.samples;
    const statusLiveRegionRiskCollection = collectStatusLiveRegionRisks();
    const statusLiveRegionRisks = statusLiveRegionRiskCollection.samples;
    const modalFocusRiskCollection = collectModalFocusRisks();
    const modalFocusRisks = modalFocusRiskCollection.samples;
    const customControlSemanticsRiskCollection = collectCustomControlSemanticsRisks();
    const customControlSemanticsRisks = customControlSemanticsRiskCollection.samples;
    const movingContentControlRiskCollection = collectMovingContentControlRisks();
    const movingContentControlRisks = movingContentControlRiskCollection.samples;
    const textInventory = collectTextInventory();
    const colorAdherenceCollectionResult = collectColorAdherenceCandidates();
    const spacingAdherenceCollectionResult = collectSpacingAdherenceCandidates();
    const typographyVariantCollectionResult = typographyVariantsEnabled
      && typographyVariantError === undefined
      ? collectTypographyVariantCandidates()
      : undefined;
    const paletteDisciplineCollectionResult = paletteDisciplineEnabled
      && paletteDisciplineError === undefined
      ? collectPaletteDisciplineCandidates()
      : undefined;
    const densityComplexityCollectionResult = densityComplexityEnabled
      && densityComplexityError === undefined
      ? collectDensityComplexity()
      : undefined;
    const textLength = document.body.innerText.trim().length;
    const likelyBlank = textLength === 0 && textElements.length === 0;
    const emittedHeadingIssues = likelyBlank
      ? []
      : headingIssues.slice(0, FINDING_MATERIALIZATION_LIMIT);

    const findingCoverageEntries: FindingCoverageEntry[] = [
      findingCoverageEntry("text-clipping", clippedTextDetectedCount, materializedSampleCount(clippedText)),
      findingCoverageEntry(
        "missing-accessible-name",
        missingAccessibleNameDetectedCount,
        materializedSampleCount(missingAccessibleNames)
      ),
      findingCoverageEntry(
        "missing-form-label",
        missingFormLabelDetectedCount,
        materializedSampleCount(missingFormLabels)
      ),
      findingCoverageEntry(
        "missing-image-alt",
        missingImageAltDetectedCount,
        materializedSampleCount(missingImageAlt)
      ),
      findingCoverageEntry(
        "empty-heading",
        headingIssueCollection.detectedByIssue["empty-heading"],
        emittedHeadingIssues.filter((sample) => sample.issue === "empty-heading").length,
        "headingIssues"
      ),
      findingCoverageEntry(
        "heading-level-skip",
        headingIssueCollection.detectedByIssue["heading-level-skip"],
        emittedHeadingIssues.filter((sample) => sample.issue === "heading-level-skip").length,
        "headingIssues"
      ),
      findingCoverageEntry(
        "duplicate-h1",
        headingIssueCollection.detectedByIssue["duplicate-h1"],
        emittedHeadingIssues.filter((sample) => sample.issue === "duplicate-h1").length,
        "headingIssues"
      ),
      findingCoverageEntry(
        "ambiguous-repeated-label",
        repeatedLabelCollection.detectedCount,
        materializedSampleCount(repeatedLabels)
      ),
      findingCoverageEntry(
        "fixed-width-risk",
        fixedWidthRiskCollection.detectedCount,
        materializedSampleCount(fixedWidthRisks)
      ),
      findingCoverageEntry(
        "sticky-obstruction-risk",
        stickyObstructionRiskCollection.detectedCount,
        materializedSampleCount(stickyObstructionRisks)
      ),
      findingCoverageEntry(
        "excessive-line-length",
        excessiveLineLengthCollection.detectedCount,
        materializedSampleCount(excessiveLineLength)
      ),
      findingCoverageEntry(
        "form-error-association-risk",
        formErrorAssociationRiskCollection.detectedCount,
        materializedSampleCount(formErrorAssociationRisks)
      ),
      findingCoverageEntry(
        "color-only-state-risk",
        colorOnlyStateRiskCollection.detectedCount,
        materializedSampleCount(colorOnlyStateRisks)
      ),
      findingCoverageEntry(
        "disabled-without-explanation",
        disabledWithoutExplanationCollection.detectedCount,
        materializedSampleCount(disabledWithoutExplanation)
      ),
      findingCoverageEntry(
        "status-live-region-risk",
        statusLiveRegionRiskCollection.detectedCount,
        materializedSampleCount(statusLiveRegionRisks)
      ),
      findingCoverageEntry(
        "modal-focus-risk",
        modalFocusRiskCollection.detectedCount,
        materializedSampleCount(modalFocusRisks)
      ),
      findingCoverageEntry(
        "custom-control-semantics-risk",
        customControlSemanticsRiskCollection.detectedCount,
        materializedSampleCount(customControlSemanticsRisks)
      ),
      findingCoverageEntry(
        "moving-content-control-risk",
        movingContentControlRiskCollection.detectedCount,
        materializedSampleCount(movingContentControlRisks)
      )
    ];

    const measurements: ViewportMeasurements = {
      viewport: viewportName,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      textLength,
      meaningfulElementCount: textElements.length,
      clippedText,
      contrastRisks: [],
      contrastCoverage: { evaluatedElementCount: 0, skippedElementCount: 0, skippedByReason: {} },
      missingAccessibleNames,
      missingFormLabels,
      missingImageAlt,
      headingIssues,
      pageLangMissing,
      missingMainLandmark,
      repeatedLabels,
      repeatedVisualWeightRisks,
      saturatedColorNoiseRisks,
      checklistStateVisibilityRisks,
      fixedWidthRisks,
      stickyObstructionRisks,
      excessiveLineLength,
      tapTargetRisks: [],
      formErrorAssociationRisks,
      colorOnlyStateRisks,
      disabledWithoutExplanation,
      statusLiveRegionRisks,
      modalFocusRisks,
      customControlSemanticsRisks,
      movingContentControlRisks,
      textInventory
    };

    const layoutMetrics = collectLayoutMetrics();

    return {
      measurements,
      contrastCandidates,
      tapTargetCandidates,
      findingCoverage: {
        viewport: viewportName,
        entries: findingCoverageEntries
      },
      layoutMetrics,
      notices,
      ...(fontFamilyEnabled && fontFamilyError === undefined ? {
        fontFamilyCollection: {
          evaluatedElementCount: evaluatedFontFamilyElementCount,
          ignoredElementCount: ignoredFontFamilyElementCount
        }
      } : {}),
      ...(fontFamilyError ? { fontFamilyError } : {}),
      ...(colorAdherenceEnabled && colorAdherenceError === undefined ? {
        colorAdherenceCandidates: colorAdherenceCollectionResult.candidates,
        colorAdherenceCollection: colorAdherenceCollectionResult.counts
      } : {}),
      ...(colorAdherenceError ? { colorAdherenceError } : {}),
      ...(spacingAdherenceEnabled && spacingAdherenceError === undefined ? {
        spacingAdherenceCandidates: spacingAdherenceCollectionResult.candidates,
        spacingAdherenceCollection: spacingAdherenceCollectionResult.counts,
        spacingAdherenceRootFontSizePx: spacingAdherenceCollectionResult.rootFontSizePx
      } : {}),
      ...(spacingAdherenceError ? { spacingAdherenceError } : {}),
      ...(typographyVariantsEnabled
        && typographyVariantError === undefined
        && typographyVariantCollectionResult
        ? {
            typographyVariantCandidates: typographyVariantCollectionResult.candidates,
            typographyVariantCollection: typographyVariantCollectionResult.counts
          }
        : {}),
      ...(typographyVariantError ? { typographyVariantError } : {}),
      ...(paletteDisciplineEnabled
        && paletteDisciplineError === undefined
        && paletteDisciplineCollectionResult
        ? {
            paletteDisciplineCandidates: paletteDisciplineCollectionResult.candidates,
            paletteDisciplineCollection: paletteDisciplineCollectionResult.counts
          }
        : {}),
      ...(paletteDisciplineError ? { paletteDisciplineError } : {}),
      ...(densityComplexityEnabled
        && densityComplexityError === undefined
        && densityComplexityCollectionResult
        ? { densityComplexityCollection: densityComplexityCollectionResult }
        : {}),
      ...(densityComplexityError ? { densityComplexityError } : {})
    };

    function materializedSampleCount(samples: unknown[]): number {
      return likelyBlank ? 0 : Math.min(samples.length, FINDING_MATERIALIZATION_LIMIT);
    }

    function findingCoverageEntry(
      checkName: string,
      detectedCount: number,
      emittedCount: number,
      capGroup?: string
    ): FindingCoverageEntry {
      return {
        checkName,
        ...(capGroup ? { capGroup } : {}),
        detectedCount,
        emittedCount,
        omittedCount: detectedCount - emittedCount,
        limit: FINDING_MATERIALIZATION_LIMIT
      };
    }

    // Raw layout-value distributions. Measurement only — no criterion, no finding, no threshold. Collects
    // the values a page actually uses for each property group so a future consistency check can be
    // calibrated against real distributions. 0px/normal are included deliberately: filtering would be a
    // judgement, and this is measurement.
    function collectLayoutMetrics(): LayoutMetrics {
      const MAX_LAYOUT_METRIC_ELEMENTS = 5_000;
      const MAX_LAYOUT_METRIC_VALUES = 20;
      const groups: Array<{ property: string; sources: string[] }> = [
        { property: "margin", sources: ["marginTop", "marginRight", "marginBottom", "marginLeft"] },
        { property: "padding", sources: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] },
        { property: "gap", sources: ["rowGap", "columnGap"] },
        { property: "border-radius", sources: ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"] },
        { property: "line-height", sources: ["lineHeight"] },
        { property: "letter-spacing", sources: ["letterSpacing"] }
      ];
      const counts = groups.map(() => ({ frequency: new Map<string, number>(), sampledElements: 0 }));
      const elements = Array.from(document.body.querySelectorAll<HTMLElement>("*")).slice(0, MAX_LAYOUT_METRIC_ELEMENTS);
      for (const element of elements) {
        const style = window.getComputedStyle(element);
        groups.forEach((group, index) => {
          let contributed = false;
          for (const source of group.sources) {
            const value = (style as unknown as Record<string, string>)[source];
            if (typeof value !== "string" || value === "") {
              continue;
            }
            counts[index].frequency.set(value, (counts[index].frequency.get(value) ?? 0) + 1);
            contributed = true;
          }
          if (contributed) {
            counts[index].sampledElements += 1;
          }
        });
      }
      return {
        viewport: viewportName,
        properties: groups.map((group, index) => {
          const entries = Array.from(counts[index].frequency.entries())
            .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
          const values = entries.slice(0, MAX_LAYOUT_METRIC_VALUES).map(([value, count]) => ({ value, count }));
          return {
            property: group.property,
            sampledElementCount: counts[index].sampledElements,
            distinctValueCount: entries.length,
            values,
            truncatedValueCount: entries.length - values.length
          };
        })
      };
    }

    function sampleElement(element: HTMLElement) {
      const rect = element.getBoundingClientRect();
      return {
        selector: selectorFor(element),
        text: element.innerText.trim().slice(0, 120),
        region: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    }

    function visualMetricLocationFor(element: Element) {
      const rect = element.getBoundingClientRect();
      return {
        selector: selectorFor(element),
        region: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      };
    }

    function collectTextInventory() {
      const candidates = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
        .filter(isTextInventoryCandidate)
        .map((element) => ({
          element,
          text: textForInventory(element)
        }))
        .filter(({ text }) => text.length > 0);

      if (
        fontFamilyEnabled
        && fontFamilyError === undefined
        && candidates.length > MAX_FONT_FAMILY_CANDIDATES
      ) {
        fontFamilyError = {
          code: "candidate-limit",
          candidateCount: candidates.length,
          limit: MAX_FONT_FAMILY_CANDIDATES
        };
      }

      const items = candidates.map(({ element, text }, elementIndex) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const textValue = truncateTextForInventory(text);
        const accessibleName = truncateTextForInventory(accessibleNameFor(element));
        const role = roleFor(element);
        const copySurface = resolveCopySurface(element);
        let fontFamily: string | undefined;
        if (fontFamilyEnabled && fontFamilyError === undefined) {
          try {
            const ignored = fontFamilyIgnoreSelectors.some((selector) => element.closest(selector) !== null);
            if (ignored) {
              ignoredFontFamilyElementCount += 1;
            } else {
              const fontFamilyLength = [...style.fontFamily].length;
              if (style.fontFamily.trim().length === 0) {
                fontFamilyError = { code: "computed-family", elementIndex };
              } else if (fontFamilyLength > MAX_COMPUTED_FONT_FAMILY_LENGTH) {
                fontFamilyError = {
                  code: "computed-family",
                  elementIndex,
                  valueLength: fontFamilyLength,
                  limit: MAX_COMPUTED_FONT_FAMILY_LENGTH
                };
              } else {
                evaluatedFontFamilyElementCount += 1;
                fontFamily = style.fontFamily;
              }
            }
          } catch {
            fontFamilyError = { code: "selector-evaluation", elementIndex };
          }
        }
        return {
          selector: selectorFor(element),
          text: textValue.text,
          ...(textValue.truncated || accessibleName.truncated ? { truncated: true as const } : {}),
          region: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          fontSize: Number.parseFloat(style.fontSize || "16"),
          fontWeight: style.fontWeight || "400",
          nearestLang: nearestLangFor(element),
          tag: element.tagName.toLowerCase(),
          role,
          accessibleName: accessibleName.text,
          ...(copySurface ? { copySurface } : {}),
          ...(fontFamily === undefined ? {} : { fontFamily })
        };
      });

      if (fontFamilyError === undefined) {
        return items;
      }
      return items.map(({ fontFamily: _fontFamily, ...item }) => item);
    }

    function collectColorAdherenceCandidates(): {
      candidates: ColorAdherenceCandidate[];
      counts: ColorAdherenceCollectionCounts;
    } {
      const candidates: ColorAdherenceCandidate[] = [];
      let candidateSlotCount = 0;
      let ignoredSlotCount = 0;
      let skippedSlotCount = 0;
      const skippedByReason: Partial<Record<ColorAdherenceSkipReason, number>> = {};
      if (!colorAdherenceEnabled || colorAdherenceError) {
        return {
          candidates,
          counts: {
            candidateSlotCount,
            ignoredSlotCount,
            skippedSlotCount,
            skippedByReason
          }
        };
      }

      const elements = [
        document.documentElement,
        document.body,
        ...Array.from(document.body.querySelectorAll("*"))
      ];
      for (const [elementIndex, element] of elements.entries()) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        let visibleInViewport = false;
        try {
          visibleInViewport = isAdherenceElementVisibleInViewport(element);
        } catch {
          colorAdherenceError = { code: "computed-color", elementIndex };
          break;
        }
        if (!visibleInViewport) {
          continue;
        }

        let ignored = false;
        try {
          ignored = colorAdherenceIgnoreSelectors.some(
            (selector) => element.closest(selector) !== null
          );
        } catch {
          colorAdherenceError = { code: "selector-evaluation", elementIndex };
          break;
        }

        let sample: ReturnType<typeof sampleElement>;
        let slots: Array<{ property: ColorPaintProperty; value: string }>;
        try {
          const style = window.getComputedStyle(element);
          sample = sampleElement(element);
          slots = [];
          if (rendersOwnText(element)) {
            slots.push({
              property: "color",
              value: style.webkitTextFillColor || style.color
            });
          }
          if (style.backgroundImage === "none") {
            slots.push({ property: "background-color", value: style.backgroundColor });
          }
          if (style.borderImageSource === "none") {
            for (const border of [
              ["border-top-color", style.borderTopColor, style.borderTopWidth, style.borderTopStyle],
              ["border-right-color", style.borderRightColor, style.borderRightWidth, style.borderRightStyle],
              ["border-bottom-color", style.borderBottomColor, style.borderBottomWidth, style.borderBottomStyle],
              ["border-left-color", style.borderLeftColor, style.borderLeftWidth, style.borderLeftStyle]
            ] as const) {
              if (
                Number.parseFloat(border[2]) > 0
                && border[3] !== "none"
                && border[3] !== "hidden"
              ) {
                slots.push({ property: border[0], value: border[1] });
              }
            }
          }
        } catch {
          colorAdherenceError = { code: "computed-color", elementIndex };
          break;
        }

        if (candidateSlotCount + slots.length > MAX_COLOR_ADHERENCE_SLOTS) {
          colorAdherenceError = {
            code: "candidate-limit",
            candidateCount: candidateSlotCount + slots.length,
            limit: MAX_COLOR_ADHERENCE_SLOTS
          };
          break;
        }
        candidateSlotCount += slots.length;
        if (ignored) {
          ignoredSlotCount += slots.length;
          continue;
        }

        for (const slot of slots) {
          const valueLength = [...slot.value].length;
          if (valueLength > MAX_COMPUTED_COLOR_LENGTH) {
            skippedSlotCount += 1;
            skippedByReason["computed-color-too-long"] =
              (skippedByReason["computed-color-too-long"] ?? 0) + 1;
            continue;
          }
          candidates.push({
            selector: sample.selector,
            region: sample.region,
            property: slot.property,
            value: slot.value
          });
        }
      }

      return {
        candidates,
        counts: {
          candidateSlotCount,
          ignoredSlotCount,
          skippedSlotCount,
          skippedByReason
        }
      };
    }

    function collectTypographyVariantCandidates(): {
      candidates: TypographyVariantCandidate[];
      counts: TypographyVariantCollectionCounts;
    } {
      const candidates: TypographyVariantCandidate[] = [];
      let candidateElementCount = 0;
      let ignoredElementCount = 0;
      let skippedElementCount = 0;
      const skippedByReason: Partial<Record<TypographyVariantSkipReason, number>> = {};
      const emptyResult = () => ({
        candidates: [] as TypographyVariantCandidate[],
        counts: {
          candidateElementCount: 0,
          collectedElementCount: 0,
          ignoredElementCount: 0,
          skippedElementCount: 0,
          skippedByReason: {} as Partial<Record<TypographyVariantSkipReason, number>>
        }
      });

      try {
        const elements = [
          document.body,
          ...Array.from(document.body.querySelectorAll("*"))
        ];
        for (const [elementIndex, element] of elements.entries()) {
          if (!(element instanceof HTMLElement) || !rendersOwnText(element)) {
            continue;
          }

          let visibleInViewport = false;
          try {
            visibleInViewport = isAdherenceElementVisibleInViewport(element);
          } catch {
            typographyVariantError = { code: "computed-style", elementIndex };
            return emptyResult();
          }
          if (!visibleInViewport) {
            continue;
          }

          candidateElementCount += 1;
          if (candidateElementCount > MAX_TYPOGRAPHY_VARIANT_CANDIDATES) {
            typographyVariantError = {
              code: "candidate-limit",
              candidateCount: candidateElementCount,
              limit: MAX_TYPOGRAPHY_VARIANT_CANDIDATES
            };
            return emptyResult();
          }

          let ignored = false;
          try {
            ignored = typographyVariantIgnoreSelectors.some(
              (selector) => element.closest(selector) !== null
            );
          } catch {
            typographyVariantError = { code: "selector-evaluation", elementIndex };
            return emptyResult();
          }
          if (ignored) {
            ignoredElementCount += 1;
            continue;
          }

          let style: CSSStyleDeclaration;
          let location: ReturnType<typeof visualMetricLocationFor>;
          try {
            style = window.getComputedStyle(element);
            location = visualMetricLocationFor(element);
          } catch {
            typographyVariantError = { code: "computed-style", elementIndex };
            return emptyResult();
          }

          if ([...style.fontFamily].length > MAX_COMPUTED_TYPOGRAPHY_FAMILY_LENGTH) {
            skippedElementCount += 1;
            skippedByReason["font-family-too-long"] =
              (skippedByReason["font-family-too-long"] ?? 0) + 1;
            continue;
          }

          candidates.push({
            selector: location.selector,
            region: location.region,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle
          });
        }
      } catch {
        typographyVariantError ??= { code: "collection-exception" };
        return emptyResult();
      }

      if (
        candidateElementCount
        !== candidates.length + ignoredElementCount + skippedElementCount
        || sumOptionalCounts(skippedByReason) !== skippedElementCount
      ) {
        typographyVariantError = { code: "accounting-invariant" };
        return emptyResult();
      }

      return {
        candidates,
        counts: {
          candidateElementCount,
          collectedElementCount: candidates.length,
          ignoredElementCount,
          skippedElementCount,
          skippedByReason
        }
      };
    }

    function collectPaletteDisciplineCandidates(): {
      candidates: PaletteDisciplineCandidate[];
      counts: PaletteDisciplineCollectionCounts;
    } {
      const candidates: PaletteDisciplineCandidate[] = [];
      let candidateSlotCount = 0;
      let ignoredSlotCount = 0;
      let skippedSlotCount = 0;
      const skippedByReason: Partial<Record<PaletteDisciplineSkipReason, number>> = {};
      const emptyResult = () => ({
        candidates: [] as PaletteDisciplineCandidate[],
        counts: {
          candidateSlotCount: 0,
          collectedSlotCount: 0,
          ignoredSlotCount: 0,
          skippedSlotCount: 0,
          skippedByReason: {} as Partial<Record<PaletteDisciplineSkipReason, number>>
        }
      });

      try {
        const elements = [
          document.documentElement,
          document.body,
          ...Array.from(document.body.querySelectorAll("*"))
        ];
        for (const [elementIndex, element] of elements.entries()) {
          if (!(element instanceof HTMLElement)) {
            continue;
          }

          let visibleInViewport = false;
          try {
            visibleInViewport = isAdherenceElementVisibleInViewport(element);
          } catch {
            paletteDisciplineError = { code: "computed-color", elementIndex };
            return emptyResult();
          }
          if (!visibleInViewport) {
            continue;
          }

          let ignored = false;
          try {
            ignored = paletteDisciplineIgnoreSelectors.some(
              (selector) => element.closest(selector) !== null
            );
          } catch {
            paletteDisciplineError = { code: "selector-evaluation", elementIndex };
            return emptyResult();
          }

          let location: ReturnType<typeof visualMetricLocationFor>;
          let slots: Array<{ property: ColorPaintProperty; value: string }>;
          try {
            const style = window.getComputedStyle(element);
            location = visualMetricLocationFor(element);
            slots = [];
            if (rendersOwnText(element)) {
              slots.push({
                property: "color",
                value: style.webkitTextFillColor || style.color
              });
            }
            if (style.backgroundImage === "none") {
              slots.push({ property: "background-color", value: style.backgroundColor });
            }
            if (style.borderImageSource === "none") {
              for (const border of [
                ["border-top-color", style.borderTopColor, style.borderTopWidth, style.borderTopStyle],
                ["border-right-color", style.borderRightColor, style.borderRightWidth, style.borderRightStyle],
                ["border-bottom-color", style.borderBottomColor, style.borderBottomWidth, style.borderBottomStyle],
                ["border-left-color", style.borderLeftColor, style.borderLeftWidth, style.borderLeftStyle]
              ] as const) {
                if (
                  Number.parseFloat(border[2]) > 0
                  && border[3] !== "none"
                  && border[3] !== "hidden"
                ) {
                  slots.push({ property: border[0], value: border[1] });
                }
              }
            }
          } catch {
            paletteDisciplineError = { code: "computed-color", elementIndex };
            return emptyResult();
          }

          if (candidateSlotCount + slots.length > MAX_PALETTE_DISCIPLINE_SLOTS) {
            paletteDisciplineError = {
              code: "candidate-limit",
              candidateCount: candidateSlotCount + slots.length,
              limit: MAX_PALETTE_DISCIPLINE_SLOTS
            };
            return emptyResult();
          }
          candidateSlotCount += slots.length;
          if (ignored) {
            ignoredSlotCount += slots.length;
            continue;
          }

          for (const slot of slots) {
            if ([...slot.value].length > MAX_COMPUTED_PALETTE_COLOR_LENGTH) {
              skippedSlotCount += 1;
              skippedByReason["computed-color-too-long"] =
                (skippedByReason["computed-color-too-long"] ?? 0) + 1;
              continue;
            }
            candidates.push({
              selector: location.selector,
              region: location.region,
              property: slot.property,
              value: slot.value
            });
          }
        }
      } catch {
        paletteDisciplineError ??= { code: "collection-exception" };
        return emptyResult();
      }

      if (
        candidateSlotCount
        !== candidates.length + ignoredSlotCount + skippedSlotCount
        || sumOptionalCounts(skippedByReason) !== skippedSlotCount
      ) {
        paletteDisciplineError = { code: "accounting-invariant" };
        return emptyResult();
      }

      return {
        candidates,
        counts: {
          candidateSlotCount,
          collectedSlotCount: candidates.length,
          ignoredSlotCount,
          skippedSlotCount,
          skippedByReason
        }
      };
    }

    function collectSpacingAdherenceCandidates(): {
      candidates: SpacingAdherenceCandidate[];
      counts: SpacingAdherenceCollectionCounts;
      rootFontSizePx?: number;
    } {
      const candidates: SpacingAdherenceCandidate[] = [];
      let candidateSlotCount = 0;
      let ignoredSlotCount = 0;
      let skippedSlotCount = 0;
      const skippedByReason: Partial<Record<SpacingAdherenceSkipReason, number>> = {};
      const emptyResult = () => ({
        candidates,
        counts: {
          candidateSlotCount,
          ignoredSlotCount,
          skippedSlotCount,
          skippedByReason
        }
      });

      if (!spacingAdherenceEnabled || spacingAdherenceError) {
        return emptyResult();
      }

      let rootFontSizePx: number;
      try {
        const rootFontSize = window.getComputedStyle(document.documentElement).fontSize;
        rootFontSizePx = parseComputedCssPixelValue(rootFontSize);
        if (!Number.isFinite(rootFontSizePx) || rootFontSizePx <= 0) {
          spacingAdherenceError = { code: "root-font-size" };
          return emptyResult();
        }
      } catch {
        spacingAdherenceError = { code: "root-font-size" };
        return emptyResult();
      }

      const slots = [
        ["margin-top", "marginTop", "margin"],
        ["margin-right", "marginRight", "margin"],
        ["margin-bottom", "marginBottom", "margin"],
        ["margin-left", "marginLeft", "margin"],
        ["padding-top", "paddingTop", "padding"],
        ["padding-right", "paddingRight", "padding"],
        ["padding-bottom", "paddingBottom", "padding"],
        ["padding-left", "paddingLeft", "padding"],
        ["row-gap", "rowGap", "gap"],
        ["column-gap", "columnGap", "gap"]
      ] as const satisfies ReadonlyArray<
        readonly [
          SpacingProperty,
          | "marginTop"
          | "marginRight"
          | "marginBottom"
          | "marginLeft"
          | "paddingTop"
          | "paddingRight"
          | "paddingBottom"
          | "paddingLeft"
          | "rowGap"
          | "columnGap",
          "margin" | "padding" | "gap"
        ]
      >;
      const elements = [
        document.documentElement,
        document.body,
        ...Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      ];

      for (const [elementIndex, element] of elements.entries()) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        let visibleInViewport = false;
        try {
          visibleInViewport = isAdherenceElementVisibleInViewport(element);
        } catch {
          spacingAdherenceError = { code: "computed-spacing", elementIndex };
          break;
        }
        if (!visibleInViewport) {
          continue;
        }

        let ignored = false;
        try {
          ignored = spacingAdherenceIgnoreSelectors.some(
            (selector) => element.closest(selector) !== null
          );
        } catch {
          spacingAdherenceError = { code: "selector-evaluation", elementIndex };
          break;
        }

        if (candidateSlotCount + slots.length > MAX_SPACING_ADHERENCE_SLOTS) {
          spacingAdherenceError = {
            code: "candidate-limit",
            candidateCount: candidateSlotCount + slots.length,
            limit: MAX_SPACING_ADHERENCE_SLOTS
          };
          break;
        }
        candidateSlotCount += slots.length;
        if (ignored) {
          ignoredSlotCount += slots.length;
          continue;
        }

        let style: CSSStyleDeclaration;
        let sample: ReturnType<typeof sampleElement>;
        try {
          style = window.getComputedStyle(element);
          sample = sampleElement(element);
        } catch {
          spacingAdherenceError = { code: "computed-spacing", elementIndex };
          break;
        }

        let typedMap:
          | { get: (property: string) => unknown }
          | undefined;
        let typedMapFailure: "typed-om-unavailable" | "typed-om-error" | undefined;
        let computedStyleMap:
          | (() => { get: (property: string) => unknown })
          | undefined;
        try {
          computedStyleMap = (
            element as HTMLElement & {
              computedStyleMap?: () => { get: (property: string) => unknown };
            }
          ).computedStyleMap;
        } catch {
          typedMapFailure = "typed-om-error";
        }
        if (typeof computedStyleMap !== "function") {
          typedMapFailure ??= "typed-om-unavailable";
        } else {
          try {
            typedMap = computedStyleMap.call(element);
            if (!typedMap || typeof typedMap.get !== "function") {
              typedMapFailure = "typed-om-unavailable";
            }
          } catch {
            typedMapFailure = "typed-om-error";
          }
        }

        for (const [property, styleProperty, propertyKind] of slots) {
          if (propertyKind !== "padding") {
            if (typedMapFailure) {
              recordSpacingSkip(typedMapFailure);
              continue;
            }

            let typedValue: unknown;
            try {
              typedValue = typedMap?.get(property);
            } catch {
              recordSpacingSkip("typed-om-error");
              continue;
            }
            const typedEvidence = classifyTypedSpacingEvidence(typedValue, propertyKind);
            if (typedEvidence !== "numeric") {
              recordSpacingSkip(typedEvidence);
              continue;
            }
          }

          const value = style[styleProperty];
          if ([...value].length > MAX_COMPUTED_SPACING_LENGTH) {
            recordSpacingSkip("computed-spacing-too-long");
            continue;
          }

          const valuePx = parseComputedCssPixelValue(value);
          if (!Number.isFinite(valuePx)) {
            recordSpacingSkip("nonfinite-computed-value");
            continue;
          }
          if (valuePx < 0 && propertyKind !== "margin") {
            recordSpacingSkip("invalid-negative");
            continue;
          }
          candidates.push({
            selector: sample.selector,
            region: sample.region,
            property,
            valuePx: Object.is(valuePx, -0) ? 0 : valuePx
          });
        }
      }

      return {
        candidates,
        counts: {
          candidateSlotCount,
          ignoredSlotCount,
          skippedSlotCount,
          skippedByReason
        },
        rootFontSizePx
      };

      function recordSpacingSkip(reason: SpacingAdherenceSkipReason): void {
        skippedSlotCount += 1;
        skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
      }
    }

    function collectDensityComplexity(): DensityComplexityCollection {
      const emptyResult = (): DensityComplexityCollection => ({});

      try {
        const elements = collectDensityDomElements();
        if (densityComplexityError) {
          return emptyResult();
        }

        const observedTextNodes = new WeakSet<Node>();
        let observedTextNodeCount = 0;
        const observeTextNode = (
          node: Node,
          location: { elementIndex?: number; textNodeIndex?: number }
        ): boolean => {
          if (observedTextNodes.has(node)) {
            return true;
          }
          observedTextNodes.add(node);
          observedTextNodeCount += 1;
          if (observedTextNodeCount <= MAX_DENSITY_TEXT_NODES) {
            return true;
          }
          densityComplexityError = {
            code: "text-node-limit",
            ...location,
            candidateCount: observedTextNodeCount,
            limit: MAX_DENSITY_TEXT_NODES
          };
          return false;
        };

        const visibleElements = densityCollectVisibleElements
          ? collectDensityVisibleElements(elements, observeTextNode)
          : undefined;
        if (densityComplexityError) {
          return emptyResult();
        }

        const textClusters = densityCollectTextClusters
          ? collectDensityTextFragments(observeTextNode)
          : undefined;
        if (densityComplexityError) {
          return emptyResult();
        }

        return {
          ...(visibleElements ? { visibleElements } : {}),
          ...(textClusters ? { textClusters } : {})
        };
      } catch {
        densityComplexityError ??= { code: "collection-exception" };
        return emptyResult();
      }
    }

    function collectDensityDomElements(): Element[] {
      const elements: Element[] = [];
      const walker = document.createTreeWalker(document.body, 1);
      let current: Node | null = document.body;
      while (current) {
        if (current.nodeType === 1) {
          elements.push(current as Element);
          if (elements.length > MAX_DENSITY_DOM_ELEMENTS) {
            densityComplexityError = {
              code: "dom-limit",
              candidateCount: elements.length,
              limit: MAX_DENSITY_DOM_ELEMENTS
            };
            return [];
          }
        }
        current = walker.nextNode();
      }
      return elements;
    }

    function collectDensityVisibleElements(
      elements: Element[],
      observeTextNode: (
        node: Node,
        location: { elementIndex?: number; textNodeIndex?: number }
      ) => boolean
    ): DensityVisibleElementCollection {
      let elementUniverseCount = 0;
      let visibleElementCount = 0;
      let ignoredElementCount = 0;
      let ineligibleElementCount = 0;
      let skippedElementCount = 0;
      let retainedFragmentCount = 0;
      const skippedByReason:
        Partial<Record<DensityComplexitySkipReason, number>> = {};
      const samples: DensityVisibleElementSample[] = [];
      const insideEligibleAtomicOwner = new WeakSet<Element>();

      for (const [elementIndex, element] of elements.entries()) {
        const parent = element.parentElement;
        if (parent && insideEligibleAtomicOwner.has(parent)) {
          insideEligibleAtomicOwner.add(element);
          continue;
        }

        const atomicOwner = isDensityAtomicElement(element);
        const directTextOwner = !atomicOwner && densityHasDirectTextNode(element);
        if (!atomicOwner && !directTextOwner) {
          continue;
        }

        elementUniverseCount += 1;
        let ignored = false;
        try {
          ignored = densityComplexityIgnoreSelectors.some(
            (selector) => element.closest(selector) !== null
          );
        } catch {
          densityComplexityError = { code: "selector-evaluation", elementIndex };
          return emptyDensityVisibleElementCollection();
        }
        if (ignored) {
          ignoredElementCount += 1;
          continue;
        }
        if (densityElementIsInExcludedSubtree(element)) {
          ineligibleElementCount += 1;
          continue;
        }

        let assessment: DensityVisibilityAssessment;
        if (atomicOwner) {
          assessment = assessDensityElementVisibility(element);
        } else {
          assessment = { kind: "ineligible" };
          let sawUnsupportedFragment = false;
          for (const textNode of element.childNodes) {
            if (
              textNode.nodeType !== 3
              || (textNode.textContent ?? "").trim() === ""
            ) {
              continue;
            }
            if (!observeTextNode(textNode, { elementIndex })) {
              return emptyDensityVisibleElementCollection();
            }
            const fragmentAssessment = assessDensityTextVisibility(textNode);
            if (fragmentAssessment.kind === "visible") {
              retainedFragmentCount += fragmentAssessment.rects.length;
            }
            if (retainedFragmentCount > MAX_DENSITY_TEXT_FRAGMENTS) {
              densityComplexityError = {
                code: "fragment-limit",
                elementIndex,
                candidateCount: retainedFragmentCount,
                limit: MAX_DENSITY_TEXT_FRAGMENTS
              };
              return emptyDensityVisibleElementCollection();
            }
            if (fragmentAssessment.kind === "visible") {
              assessment = fragmentAssessment;
              break;
            }
            if (fragmentAssessment.kind === "skipped") {
              sawUnsupportedFragment = true;
            }
          }
          if (assessment.kind !== "visible" && sawUnsupportedFragment) {
            assessment = {
              kind: "skipped",
              reason: "unsupported-clip-or-mask"
            };
          }
        }

        if (assessment.kind === "ineligible") {
          ineligibleElementCount += 1;
          continue;
        }
        if (assessment.kind === "skipped") {
          skippedElementCount += 1;
          incrementDensitySkip(skippedByReason, assessment.reason);
          continue;
        }

        visibleElementCount += 1;
        if (atomicOwner) {
          // Collapse descendants only after the outer atomic candidate itself proved eligible in the
          // current viewport. A matching display:contents, zero-box, clipped, or off-viewport ancestor
          // does not suppress a visible inner control.
          insideEligibleAtomicOwner.add(element);
        }
        if (samples.length < MAX_DENSITY_EVIDENCE_SAMPLES) {
          samples.push({
            selector: selectorFor(element),
            region: densityRegionFromRect(assessment.rects[0])
          });
        }
      }

      if (
        elementUniverseCount
        !== ignoredElementCount
          + ineligibleElementCount
          + skippedElementCount
          + visibleElementCount
        || sumOptionalCounts(skippedByReason) !== skippedElementCount
      ) {
        densityComplexityError = { code: "accounting-invariant" };
        return emptyDensityVisibleElementCollection();
      }

      return {
        elementUniverseCount,
        visibleElementCount,
        ignoredElementCount,
        ineligibleElementCount,
        skippedElementCount,
        skippedByReason,
        samples,
        omittedSampleCount: visibleElementCount - samples.length
      };
    }

    function emptyDensityVisibleElementCollection(): DensityVisibleElementCollection {
      return {
        elementUniverseCount: 0,
        visibleElementCount: 0,
        ignoredElementCount: 0,
        ineligibleElementCount: 0,
        skippedElementCount: 0,
        skippedByReason: {},
        samples: [],
        omittedSampleCount: 0
      };
    }

    function collectDensityTextFragments(
      observeTextNode: (
        node: Node,
        location: { elementIndex?: number; textNodeIndex?: number }
      ) => boolean
    ): DensityTextClusterCollection {
      let textNodeUniverseCount = 0;
      let ignoredTextNodeCount = 0;
      let ineligibleTextNodeCount = 0;
      let skippedTextNodeCount = 0;
      let evaluatedTextNodeCount = 0;
      const skippedByReason:
        Partial<Record<DensityComplexitySkipReason, number>> = {};
      const fragments: DensityTextFragment[] = [];
      const flowRootIds = new Map<Element, string>();
      const walker = document.createTreeWalker(document.body, 4);
      let current = walker.nextNode();

      while (current) {
        const textNodeIndex = textNodeUniverseCount;
        textNodeUniverseCount += 1;
        if (!observeTextNode(current, { textNodeIndex })) {
          return emptyDensityTextClusterCollection();
        }

        const parent = current.parentElement;
        if (!parent) {
          ineligibleTextNodeCount += 1;
          current = walker.nextNode();
          continue;
        }

        let ignored = false;
        try {
          ignored = densityComplexityIgnoreSelectors.some(
            (selector) => parent.closest(selector) !== null
          );
        } catch {
          densityComplexityError = { code: "selector-evaluation", textNodeIndex };
          return emptyDensityTextClusterCollection();
        }
        if (ignored) {
          ignoredTextNodeCount += 1;
          current = walker.nextNode();
          continue;
        }
        if (
          (current.textContent ?? "").trim() === ""
          || densityTextIsInExcludedSubtree(parent)
        ) {
          ineligibleTextNodeCount += 1;
          current = walker.nextNode();
          continue;
        }

        const assessment = assessDensityTextVisibility(current);
        if (assessment.kind === "ineligible") {
          ineligibleTextNodeCount += 1;
          current = walker.nextNode();
          continue;
        }
        if (assessment.kind === "skipped") {
          skippedTextNodeCount += 1;
          incrementDensitySkip(skippedByReason, assessment.reason);
          current = walker.nextNode();
          continue;
        }

        const flowRoot = densityFlowRootFor(parent);
        let rootId = flowRootIds.get(flowRoot);
        if (!rootId) {
          rootId = `root-${flowRootIds.size + 1}`;
          flowRootIds.set(flowRoot, rootId);
        }
        const selector = selectorFor(parent);
        for (const rect of assessment.rects) {
          if (fragments.length >= MAX_DENSITY_TEXT_FRAGMENTS) {
            densityComplexityError = {
              code: "fragment-limit",
              textNodeIndex,
              candidateCount: fragments.length + 1,
              limit: MAX_DENSITY_TEXT_FRAGMENTS
            };
            return emptyDensityTextClusterCollection();
          }
          fragments.push({
            rootId,
            selector,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom
          });
        }
        evaluatedTextNodeCount += 1;
        current = walker.nextNode();
      }

      if (
        textNodeUniverseCount
        !== ignoredTextNodeCount
          + ineligibleTextNodeCount
          + skippedTextNodeCount
          + evaluatedTextNodeCount
        || fragments.length < evaluatedTextNodeCount
        || sumOptionalCounts(skippedByReason) !== skippedTextNodeCount
      ) {
        densityComplexityError = { code: "accounting-invariant" };
        return emptyDensityTextClusterCollection();
      }

      return {
        textNodeUniverseCount,
        ignoredTextNodeCount,
        ineligibleTextNodeCount,
        skippedTextNodeCount,
        evaluatedTextNodeCount,
        skippedByReason,
        textFragmentCount: fragments.length,
        fragments
      };
    }

    function emptyDensityTextClusterCollection(): DensityTextClusterCollection {
      return {
        textNodeUniverseCount: 0,
        ignoredTextNodeCount: 0,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 0,
        evaluatedTextNodeCount: 0,
        skippedByReason: {},
        textFragmentCount: 0,
        fragments: []
      };
    }

    function densityHasDirectTextNode(element: Element): boolean {
      for (const node of element.childNodes) {
        if (node.nodeType === 3 && (node.textContent ?? "").trim() !== "") {
          return true;
        }
      }
      return false;
    }

    function isDensityAtomicElement(element: Element): boolean {
      const tag = element.tagName.toLowerCase();
      if (
        (tag === "a" && element.hasAttribute("href"))
        || tag === "button"
        || (
          tag === "input"
          && asciiLower(element.getAttribute("type") ?? "") !== "hidden"
        )
        || tag === "select"
        || tag === "textarea"
        || tag === "summary"
        || (
          element.hasAttribute("contenteditable")
          && asciiLower(element.getAttribute("contenteditable") ?? "") !== "false"
        )
        || (
          element.hasAttribute("tabindex")
          && element.getAttribute("tabindex") !== "-1"
        )
      ) {
        return true;
      }

      const role = asciiLower(element.getAttribute("role") ?? "").trim();
      switch (role) {
        case "button":
        case "link":
        case "checkbox":
        case "radio":
        case "switch":
        case "tab":
        case "menuitem":
        case "menuitemcheckbox":
        case "menuitemradio":
        case "option":
        case "slider":
        case "spinbutton":
        case "searchbox":
        case "textbox":
        case "combobox":
        case "listbox":
        case "treeitem":
          return true;
      }

      return tag === "img"
        || tag === "svg"
        || tag === "canvas"
        || tag === "video"
        || (tag === "audio" && element.hasAttribute("controls"))
        || tag === "iframe"
        || tag === "object"
        || tag === "embed"
        || tag === "meter"
        || tag === "progress";
    }

    function densityElementIsInExcludedSubtree(element: Element): boolean {
      let current: Element | null = element;
      while (current) {
        const tag = current.tagName.toLowerCase();
        if (
          tag === "script"
          || tag === "style"
          || tag === "noscript"
          || tag === "template"
          || current.hasAttribute("hidden")
          || current.hasAttribute("inert")
          || asciiLower(current.getAttribute("aria-hidden") ?? "") === "true"
          || (
            current !== element
            && (
              tag === "svg"
              || tag === "canvas"
              || tag === "iframe"
              || tag === "object"
              || tag === "embed"
            )
          )
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    function densityTextIsInExcludedSubtree(parent: Element): boolean {
      let current: Element | null = parent;
      while (current) {
        const tag = current.tagName.toLowerCase();
        if (
          tag === "script"
          || tag === "style"
          || tag === "noscript"
          || tag === "template"
          || tag === "svg"
          || tag === "canvas"
          || tag === "iframe"
          || tag === "object"
          || tag === "embed"
          || current.hasAttribute("hidden")
          || current.hasAttribute("inert")
          || asciiLower(current.getAttribute("aria-hidden") ?? "") === "true"
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    function assessDensityElementVisibility(element: Element): DensityVisibilityAssessment {
      if (!densityStyleIsVisible(element)) {
        return { kind: "ineligible" };
      }
      const rects = Array.from(element.getClientRects());
      return clipDensityRects(rects, element, element.parentElement);
    }

    function assessDensityTextVisibility(textNode: Node): DensityVisibilityAssessment {
      const parent = textNode.parentElement;
      if (!parent || !densityStyleIsVisible(parent)) {
        return { kind: "ineligible" };
      }
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = Array.from(range.getClientRects());
      return clipDensityRects(rects, parent, parent);
    }

    function densityStyleIsVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility !== "visible") {
        return false;
      }
      let current: Element | null = element;
      while (current) {
        const computedOpacity = window.getComputedStyle(current).opacity.trim();
        const opacity = Number(computedOpacity);
        if (computedOpacity !== "" && Number.isFinite(opacity) && opacity === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    }

    function clipDensityRects(
      rects: ArrayLike<DOMRect>,
      unsupportedStart: Element,
      clippingStart: Element | null
    ): DensityVisibilityAssessment {
      let hasViewportRect = false;
      for (const rect of Array.from(rects)) {
        if (
          rect.width > 0
          && rect.height > 0
          && rect.right > 0
          && rect.bottom > 0
          && rect.left < window.innerWidth
          && rect.top < window.innerHeight
        ) {
          hasViewportRect = true;
          break;
        }
      }
      if (!hasViewportRect) {
        return { kind: "ineligible" };
      }
      if (densityHasUnsupportedClipOrMask(unsupportedStart)) {
        return {
          kind: "skipped",
          reason: "unsupported-clip-or-mask"
        };
      }

      const clippedRects: DensityClippedRect[] = [];
      for (const rect of Array.from(rects)) {
        let clipped: DensityClippedRect = {
          left: Math.max(0, rect.left),
          top: Math.max(0, rect.top),
          right: Math.min(window.innerWidth, rect.right),
          bottom: Math.min(window.innerHeight, rect.bottom)
        };
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) {
          continue;
        }

        let ancestor = clippingStart;
        while (ancestor) {
          const style = window.getComputedStyle(ancestor);
          const clipsX = densityOverflowClips(style.overflowX);
          const clipsY = densityOverflowClips(style.overflowY);
          if (clipsX || clipsY) {
            const clipBox = ancestor.getBoundingClientRect();
            if (clipsX) {
              clipped.left = Math.max(clipped.left, clipBox.left);
              clipped.right = Math.min(clipped.right, clipBox.right);
            }
            if (clipsY) {
              clipped.top = Math.max(clipped.top, clipBox.top);
              clipped.bottom = Math.min(clipped.bottom, clipBox.bottom);
            }
            if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) {
              break;
            }
          }
          ancestor = ancestor.parentElement;
        }
        if (clipped.right > clipped.left && clipped.bottom > clipped.top) {
          clippedRects.push(clipped);
        }
      }

      return clippedRects.length > 0
        ? { kind: "visible", rects: clippedRects }
        : { kind: "ineligible" };
    }

    function densityHasUnsupportedClipOrMask(element: Element): boolean {
      let current: Element | null = element;
      while (current) {
        const style = window.getComputedStyle(current);
        const values = style as unknown as Record<string, string | undefined>;
        const clip = (values.clip ?? "auto").trim().toLowerCase();
        const clipPath = (
          values.clipPath
          || values.webkitClipPath
          || "none"
        ).trim().toLowerCase();
        if (
          (clip !== "" && clip !== "auto")
          || (clipPath !== "" && clipPath !== "none")
          || cssListContainsNonNone(values.maskImage)
          || cssListContainsNonNone(values.webkitMaskImage)
          || cssListContainsNonNone(values.maskBorderSource)
          || cssListContainsNonNone(values.webkitMaskBoxImageSource)
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    function cssListContainsNonNone(value: string | undefined): boolean {
      if (!value) {
        return false;
      }
      return value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .some((part) => part !== "" && part !== "none" && !part.startsWith("none "));
    }

    function densityOverflowClips(value: string): boolean {
      const normalized = value.trim().toLowerCase();
      return normalized === "hidden"
        || normalized === "clip"
        || normalized === "auto"
        || normalized === "scroll";
    }

    function densityFlowRootFor(element: Element): Element {
      let current: Element | null = element;
      while (current) {
        const display = window.getComputedStyle(current).display;
        if (
          display !== "inline"
          && display !== "contents"
          && !display.startsWith("ruby")
        ) {
          return current;
        }
        if (current === document.body) {
          break;
        }
        current = current.parentElement;
      }
      return document.body;
    }

    function densityRegionFromRect(rect: DensityClippedRect): VisualMetricRegion {
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.right - rect.left)),
        height: Math.max(1, Math.round(rect.bottom - rect.top))
      };
    }

    function incrementDensitySkip(
      target: Partial<Record<DensityComplexitySkipReason, number>>,
      reason: DensityComplexitySkipReason
    ): void {
      target[reason] = (target[reason] ?? 0) + 1;
    }

    function sumOptionalCounts(counts: Record<string, number | undefined>): number {
      return Object.values(counts)
        .reduce<number>((sum, count) => sum + (count ?? 0), 0);
    }

    function asciiLower(value: string): string {
      return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
    }

    function classifyTypedSpacingEvidence(
      value: unknown,
      propertyKind: "margin" | "gap"
    ): "numeric" | SpacingAdherenceSkipReason {
      if (!value || typeof value !== "object") {
        return "unsupported-typed-value";
      }

      const typedValue = value as {
        constructor?: { name?: string };
        unit?: unknown;
        value?: unknown;
        toString?: () => string;
      };
      const constructorName = typedValue.constructor?.name ?? "";
      const keyword = typeof typedValue.value === "string"
        ? typedValue.value.trim().toLowerCase()
        : constructorName === "CSSKeywordValue" && typeof typedValue.toString === "function"
          ? typedValue.toString().trim().toLowerCase()
          : "";
      if (propertyKind === "margin" && keyword === "auto") {
        return "auto-margin";
      }
      if (propertyKind === "gap" && keyword === "normal") {
        return "normal-gap";
      }
      if (constructorName === "CSSKeywordValue" || keyword !== "") {
        return "unsupported-typed-value";
      }
      if (
        constructorName === "CSSUnitValue"
        && typeof typedValue.value === "number"
        && Number.isFinite(typedValue.value)
        && typeof typedValue.unit === "string"
      ) {
        return "numeric";
      }
      if (constructorName.startsWith("CSSMath") && typeof typedValue.toString === "function") {
        return "numeric";
      }
      return "unsupported-typed-value";
    }

    function parseComputedCssPixelValue(value: string): number {
      const normalized = value.trim().toLowerCase();
      if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(normalized)) {
        return Number.NaN;
      }
      return Number(normalized.slice(0, -2));
    }

    function prepareFontFamilySelectors(): void {
      if (!fontFamilyEnabled) {
        return;
      }
      for (const [selectorIndex, selector] of fontFamilyIgnoreSelectors.entries()) {
        try {
          document.documentElement.matches(selector);
        } catch {
          fontFamilyError = { code: "invalid-selector", selectorIndex };
          return;
        }
      }
    }

    function prepareColorAdherenceSelectors(): void {
      if (!colorAdherenceEnabled) {
        return;
      }
      for (const [selectorIndex, selector] of colorAdherenceIgnoreSelectors.entries()) {
        try {
          document.documentElement.matches(selector);
        } catch {
          colorAdherenceError = { code: "invalid-selector", selectorIndex };
          return;
        }
      }
    }

    function prepareSpacingAdherenceSelectors(): void {
      if (!spacingAdherenceEnabled) {
        return;
      }
      for (const [selectorIndex, selector] of spacingAdherenceIgnoreSelectors.entries()) {
        try {
          document.documentElement.matches(selector);
        } catch {
          spacingAdherenceError = { code: "invalid-selector", selectorIndex };
          return;
        }
      }
    }

    function prepareTypographyVariantSelectors(): void {
      if (!typographyVariantsEnabled) {
        return;
      }
      for (const [selectorIndex, selector] of typographyVariantIgnoreSelectors.entries()) {
        try {
          document.documentElement.matches(selector);
        } catch {
          typographyVariantError = { code: "invalid-selector", selectorIndex };
          return;
        }
      }
    }

    function preparePaletteDisciplineSelectors(): void {
      if (!paletteDisciplineEnabled) {
        return;
      }
      for (const [selectorIndex, selector] of paletteDisciplineIgnoreSelectors.entries()) {
        try {
          document.documentElement.matches(selector);
        } catch {
          paletteDisciplineError = { code: "invalid-selector", selectorIndex };
          return;
        }
      }
    }

    function prepareDensityComplexitySelectors(): void {
      if (!densityComplexityEnabled) {
        return;
      }
      for (const [selectorIndex, selector] of densityComplexityIgnoreSelectors.entries()) {
        try {
          document.documentElement.matches(selector);
        } catch {
          densityComplexityError = { code: "invalid-selector", selectorIndex };
          return;
        }
      }
    }

    function prepareSurfaceMatchers(): void {
      for (const [ruleIndex, rule] of surfaceRules.entries()) {
        for (const [matcherIndex, matcher] of rule.matchers.entries()) {
          const key = matcherKey(ruleIndex, matcherIndex);
          if (matcher.kind !== "adapter") {
            continue;
          }
          if (matcher.adapter !== "web-dom") {
            unusableMatcherKeys.add(key);
            addSurfaceNotice(
              "copy-surface-unsupported-adapter",
              `Copy surface adapter "${matcher.adapter}" is not supported and was skipped.`,
              matcher,
              ruleIndex,
              matcherIndex
            );
            continue;
          }
          try {
            document.documentElement.matches(matcher.value);
          } catch {
            unusableMatcherKeys.add(key);
            addSurfaceNotice(
              "copy-surface-invalid-query",
              `Copy surface query "${matcher.value}" is invalid and was skipped.`,
              matcher,
              ruleIndex,
              matcherIndex
            );
          }
        }
      }
    }

    function resolveCopySurface(element: HTMLElement) {
      if (surfaceRules.length === 0) {
        return undefined;
      }
      let current: HTMLElement | null = element;
      while (current) {
        const role = surfaceRoleFor(current);
        for (const [ruleIndex, rule] of surfaceRules.entries()) {
          for (const [matcherIndex, matcher] of rule.matchers.entries()) {
            if (unusableMatcherKeys.has(matcherKey(ruleIndex, matcherIndex))) {
              continue;
            }
            if (matcher.kind === "role") {
              if (role === matcher.value.trim().toLowerCase()) {
                return { surface: rule.surface, ruleIndex, matcher };
              }
              continue;
            }
            if (matcher.adapter !== "web-dom") {
              continue;
            }
            try {
              if (current.matches(matcher.value)) {
                return { surface: rule.surface, ruleIndex, matcher };
              }
            } catch {
              unusableMatcherKeys.add(matcherKey(ruleIndex, matcherIndex));
              addSurfaceNotice(
                "copy-surface-invalid-query",
                `Copy surface query "${matcher.value}" is invalid and was skipped.`,
                matcher,
                ruleIndex,
                matcherIndex
              );
            }
          }
        }
        current = current.parentElement;
      }
      return undefined;
    }

    function addSurfaceNotice(
      code: "copy-surface-unsupported-adapter" | "copy-surface-invalid-query",
      message: string,
      matcher: Extract<CopyStyleSurfaceRule["matchers"][number], { kind: "adapter" }>,
      ruleIndex: number,
      matcherIndex: number
    ): void {
      const key = [code, matcher.adapter, matcher.value, ruleIndex, matcherIndex].join("\u0000");
      if (noticeKeys.has(key)) {
        return;
      }
      noticeKeys.add(key);
      notices.push({
        code,
        message,
        viewport: viewportName,
        details: {
          adapter: matcher.adapter,
          value: matcher.value,
          ruleIndex,
          matcherIndex
        }
      });
    }

    function matcherKey(ruleIndex: number, matcherIndex: number): string {
      return `${ruleIndex}:${matcherIndex}`;
    }

    function isTextInventoryCandidate(element: HTMLElement): boolean {
      if (isSensitiveTextControl(element)) {
        return false;
      }
      if (element.closest("script,style,noscript,template,[aria-hidden='true']")) {
        return false;
      }
      return isElementVisible(element) && normalizeWhitespace(element.innerText ?? element.textContent ?? "").length > 0;
    }

    function textForInventory(element: HTMLElement): string {
      const directText = directTextFor(element);
      if (hasVisibleTextChild(element)) {
        return directText;
      }
      return normalizeWhitespace(element.innerText ?? element.textContent ?? "");
    }

    function isSensitiveTextControl(element: HTMLElement): boolean {
      return element instanceof HTMLInputElement && ["hidden", "password"].includes(element.type);
    }

    function directTextFor(element: HTMLElement): string {
      return normalizeWhitespace(Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" "));
    }

    function hasVisibleTextChild(element: HTMLElement): boolean {
      return Array.from(element.children).some((child) => {
        if (!(child instanceof HTMLElement) || !isTextInventoryCandidate(child)) {
          return false;
        }
        return true;
      });
    }

    function normalizeWhitespace(value: string): string {
      return value.replace(/\s+/g, " ").trim();
    }

    function truncateTextForInventory(text: string): { text: string; truncated: boolean } {
      if (text.length <= MAX_TEXT_INVENTORY_TEXT_LENGTH) {
        return { text, truncated: false };
      }
      return { text: text.slice(0, MAX_TEXT_INVENTORY_TEXT_LENGTH), truncated: true };
    }

    function nearestLangFor(element: HTMLElement): string {
      let current: HTMLElement | null = element;
      while (current) {
        const lang = current.getAttribute("lang")?.trim();
        if (lang) {
          return lang;
        }
        current = current.parentElement;
      }
      return document.documentElement.getAttribute("lang")?.trim() ?? "";
    }

    function roleFor(element: HTMLElement): string {
      const explicitRole = element.getAttribute("role")?.trim();
      if (explicitRole) {
        return explicitRole;
      }

      const tag = element.tagName;
      if (tag === "A" && element.hasAttribute("href")) return "link";
      if (tag === "BUTTON") return "button";
      if (/^H[1-6]$/.test(tag)) return "heading";
      if (tag === "IMG") return "img";
      if (tag === "MAIN") return "main";
      if (tag === "NAV") return "navigation";
      if (tag === "HEADER") return "banner";
      if (tag === "FOOTER") return "contentinfo";
      if (tag === "UL" || tag === "OL") return "list";
      if (tag === "LI") return "listitem";
      if (tag === "INPUT") {
        const input = element as HTMLInputElement;
        if (["button", "submit", "reset"].includes(input.type)) return "button";
        if (input.type === "checkbox") return "checkbox";
        if (input.type === "radio") return "radio";
        return "textbox";
      }
      if (tag === "TEXTAREA") return "textbox";
      if (tag === "SELECT") return "combobox";
      return "";
    }

    function surfaceRoleFor(element: HTMLElement): string {
      const explicitRole = element.getAttribute("role")?.trim();
      if (explicitRole) {
        const concreteRole = explicitRole
          .toLowerCase()
          .split(/\s+/)
          .find((token) => concreteAriaRoles.has(token));
        if (concreteRole) {
          return concreteRole;
        }
      }

      return nativeSurfaceRoleFor(element);
    }

    function nativeSurfaceRoleFor(element: HTMLElement): string {
      const tag = element.tagName;
      if ((tag === "A" || tag === "AREA") && element.hasAttribute("href")) return "link";
      if (tag === "ARTICLE") return "article";
      if (tag === "ASIDE") return "complementary";
      if (tag === "BUTTON" || tag === "SUMMARY") return "button";
      if (tag === "DATALIST") return "listbox";
      if (tag === "DETAILS" || tag === "FIELDSET" || tag === "OPTGROUP") return "group";
      if (tag === "DIALOG") return "dialog";
      if (tag === "FIGURE") return "figure";
      if (tag === "FORM") return "form";
      if (/^H[1-6]$/.test(tag)) return "heading";
      if (tag === "HR") return "separator";
      if (tag === "IMG") return "img";
      if (tag === "MAIN") return "main";
      if (tag === "MATH") return "math";
      if (tag === "METER") return "meter";
      if (tag === "NAV") return "navigation";
      if (tag === "HEADER") return "banner";
      if (tag === "FOOTER") return "contentinfo";
      if (tag === "UL" || tag === "OL" || tag === "MENU") return "list";
      if (tag === "LI") return "listitem";
      if (tag === "OPTION") return "option";
      if (tag === "OUTPUT") return "status";
      if (tag === "PROGRESS") return "progressbar";
      if (tag === "TABLE") return "table";
      if (tag === "THEAD" || tag === "TBODY" || tag === "TFOOT") return "rowgroup";
      if (tag === "TR") return "row";
      if (tag === "TD") return "cell";
      if (tag === "TH") {
        return element.getAttribute("scope")?.toLowerCase() === "row" ? "rowheader" : "columnheader";
      }
      if (tag === "INPUT") {
        const input = element as HTMLInputElement;
        if (["button", "image", "reset", "submit"].includes(input.type)) return "button";
        if (input.type === "checkbox") return "checkbox";
        if (input.type === "number") return "spinbutton";
        if (input.type === "radio") return "radio";
        if (input.type === "range") return "slider";
        if (input.list) return "combobox";
        if (input.type === "search") return "searchbox";
        return "textbox";
      }
      if (tag === "TEXTAREA") return "textbox";
      if (tag === "SELECT") {
        const select = element as HTMLSelectElement;
        return select.multiple || select.size > 1 ? "listbox" : "combobox";
      }
      return "";
    }

    function selectorFor(element: Element): string {
      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const dataTestId = element.getAttribute("data-testid");
      if (dataTestId) {
        return `[data-testid="${CSS.escape(dataTestId)}"]`;
      }

      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const sameTagSiblings = Array.from(parent.children).filter((sibling: Element) => sibling.tagName === current?.tagName);
        const suffix = sameTagSiblings.length > 1 ? `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${suffix}`);
        current = parent;
      }
      return parts.join(" > ") || element.tagName.toLowerCase();
    }

    function isElementVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }

    function isElementVisibleInViewport(element: Element): element is HTMLElement {
      if (!(element instanceof HTMLElement) || !isElementVisible(element)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
    }

    function isAdherenceElementVisibleInViewport(element: HTMLElement): boolean {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none"
        || style.visibility !== "visible"
        || rect.width <= 0
        || rect.height <= 0
        || rect.bottom <= 0
        || rect.right <= 0
        || rect.top >= window.innerHeight
        || rect.left >= window.innerWidth
      ) {
        return false;
      }

      let current: HTMLElement | null = element;
      while (current) {
        const currentOpacity = Number(window.getComputedStyle(current).opacity);
        if (Number.isFinite(currentOpacity) && currentOpacity === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    }

    function accessibleNameFor(element: HTMLElement): string {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) {
        return ariaLabel;
      }

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText.trim() ?? "")
          .filter(Boolean)
          .join(" ")
          .trim();
        if (text) {
          return text;
        }
      }

      if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type) && element.value.trim()) {
        return element.value.trim();
      }

      if (element instanceof HTMLImageElement && element.alt.trim()) {
        return element.alt.trim();
      }

      const labelText = labelTextFor(element);
      if (labelText) {
        return labelText;
      }

      const ownText = element.innerText?.trim();
      if (ownText) {
        return ownText;
      }

      const title = element.getAttribute("title")?.trim();
      return title ?? "";
    }

    function labelTextFor(element: HTMLElement): string {
      if ("labels" in element) {
        const labels = Array.from((element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).labels ?? []);
        const text = labels.map((label) => label.innerText.trim()).filter(Boolean).join(" ").trim();
        if (text) {
          return text;
        }
      }

      const id = element.id;
      if (id) {
        const explicitLabel = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
        if (explicitLabel?.innerText.trim()) {
          return explicitLabel.innerText.trim();
        }
      }

      const wrappingLabel = element.closest("label");
      return wrappingLabel?.innerText.trim() ?? "";
    }

    function requiresProgrammaticFormLabel(element: HTMLElement): boolean {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return true;
      }
      return element instanceof HTMLInputElement && !["hidden", "button", "submit", "reset", "image"].includes(element.type);
    }

    function collectHeadingIssues() {
      const headings = Array.from(document.body.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6")).filter(isElementVisible);
      const issues: Array<ReturnType<typeof sampleElement> & {
        level: number;
        issue: "empty-heading" | "heading-level-skip" | "duplicate-h1";
        previousLevel?: number;
      }> = [];
      const detectedByIssue = {
        "empty-heading": 0,
        "heading-level-skip": 0,
        "duplicate-h1": 0
      };
      let previousLevel = 0;
      let h1Count = 0;

      const recordIssue = (issue: (typeof issues)[number]): void => {
        detectedByIssue[issue.issue] += 1;
        if (issues.length < MAX_BROWSER_FINDING_SAMPLES) {
          issues.push(issue);
        }
      };

      for (const heading of headings) {
        const level = Number(heading.tagName.slice(1));
        const text = heading.innerText.trim();
        if (level === 1) {
          h1Count += 1;
          if (h1Count > 1) {
            recordIssue({ ...sampleElement(heading), level, issue: "duplicate-h1" });
          }
        }

        if (!text) {
          recordIssue({ ...sampleElement(heading), level, issue: "empty-heading" });
        }

        if (previousLevel > 0 && level > previousLevel + 1) {
          recordIssue({ ...sampleElement(heading), level, issue: "heading-level-skip", previousLevel });
        }

        previousLevel = level;
      }

      return { samples: issues, detectedByIssue };
    }

    function collectRepeatedLabels(elements: HTMLElement[]) {
      const labelGroups = new Map<string, { count: number; selectors: string[] }>();
      for (const element of elements) {
        const label = accessibleNameFor(element);
        if (!label || label.length > 40) {
          continue;
        }

        const normalized = label.toLowerCase();
        const group = labelGroups.get(normalized) ?? { count: 0, selectors: [] };
        group.count += 1;
        if (group.selectors.length < MAX_BROWSER_FINDING_SAMPLES) {
          group.selectors.push(selectorFor(element));
        }
        labelGroups.set(normalized, group);
      }

      const qualifyingGroups = Array.from(labelGroups.entries())
        .filter(([, group]) => group.count >= 3);
      return {
        detectedCount: qualifyingGroups.length,
        samples: qualifyingGroups
          .slice(0, MAX_BROWSER_FINDING_SAMPLES)
          .map(([label, group]) => ({
            label,
            count: group.count,
            selectors: group.selectors
          }))
      };
    }

    function collectRepeatedVisualWeightRisks() {
      const candidates = Array.from(document.body.querySelectorAll<HTMLElement>([
        "article",
        "aside",
        "section",
        "[class*='card']",
        "[class*='panel']",
        "[class*='tile']",
        "[class*='metric']"
      ].join(",")))
        .filter(isElementVisible)
        .filter((element) => element.innerText.trim().length >= 8)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element,
            area: Math.round(rect.width * rect.height),
            rect
          };
        })
        .filter(({ area, rect }) => rect.width >= 120 && rect.height >= 72 && area >= 8_000)
        .filter(({ rect }) => rect.top < viewport.height * 1.25)
        .sort((left, right) => left.area - right.area);

      for (const candidate of candidates) {
        const similar = candidates.filter(({ area }) => area >= candidate.area * 0.8 && area <= candidate.area * 1.25);
        if (similar.length < 6) {
          continue;
        }

        const areas = similar.map(({ area }) => area);
        const averageArea = Math.round(areas.reduce((sum, area) => sum + area, 0) / areas.length);
        const areaVariation = standardDeviation(areas) / Math.max(averageArea, 1);
        if (areaVariation > 0.18) {
          continue;
        }

        return [{
          count: similar.length,
          selectors: similar.slice(0, 8).map(({ element }) => selectorFor(element)),
          averageArea,
          areaVariation: Number(areaVariation.toFixed(3))
        }];
      }

      return [];
    }

    function collectSaturatedColorNoiseRisks() {
      const samples = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
        .filter(isElementVisible)
        .map((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const color = parseRgb(style.backgroundColor);
          const hsl = rgbToHsl(color);
          return {
            element,
            rect,
            hueBucket: (Math.round(hsl.hue / 30) * 30) % 360,
            saturation: hsl.saturation,
            lightness: hsl.lightness,
            alpha: color.alpha
          };
        })
        .filter(({ rect }) => rect.width >= 32 && rect.height >= 18 && rect.width * rect.height >= 1_500)
        .filter(({ rect }) => rect.top < viewport.height * 1.25 && rect.bottom > -viewport.height * 0.1)
        .filter(({ alpha, saturation, lightness }) => alpha > 0 && saturation >= 0.55 && lightness >= 0.22 && lightness <= 0.86);

      const hueBuckets = Array.from(new Set(samples.map((sample) => sample.hueBucket))).sort((left, right) => left - right);
      if (samples.length < 8 || hueBuckets.length < 4) {
        return [];
      }

      return [{
        count: samples.length,
        hueBucketCount: hueBuckets.length,
        hueBuckets,
        selectors: samples.slice(0, 10).map(({ element }) => selectorFor(element))
      }];
    }

    function collectChecklistStateVisibilityRisks() {
      const controls = Array.from(document.body.querySelectorAll<HTMLElement>("input[type='checkbox'],[role='checkbox'],[aria-checked]"))
        .filter(isElementVisible)
        .filter(isChecklistLikeControl)
        .map((control) => {
          const row = checklistRowFor(control);
          return {
            control,
            row,
            checked: isCheckedState(control),
            signature: visualSignature(row),
            hasCustomStateTreatment: hasCustomChecklistStateTreatment(control, row)
          };
        });

      const checked = controls.filter((sample) => sample.checked);
      const unchecked = controls.filter((sample) => !sample.checked);
      const findings: Array<{
        reason: "inconsistent-checked-styles" | "checked-unchecked-styles-too-similar";
        checkedCount: number;
        uncheckedCount: number;
        selectors: string[];
      }> = [];

      if (checked.length >= 3) {
        const checkedSignatures = new Set(checked.map((sample) => sample.signature));
        if (checkedSignatures.size >= Math.min(checked.length, 3)) {
          findings.push({
            reason: "inconsistent-checked-styles",
            checkedCount: checked.length,
            uncheckedCount: unchecked.length,
            selectors: checked.slice(0, 8).map(({ row }) => selectorFor(row))
          });
        }
      }

      const checkedWithStateTreatment = checked.filter((sample) => sample.hasCustomStateTreatment);
      const uncheckedWithStateTreatment = unchecked.filter((sample) => sample.hasCustomStateTreatment);
      if (checkedWithStateTreatment.length >= 2 && uncheckedWithStateTreatment.length >= 2) {
        const uncheckedSignatures = new Set(uncheckedWithStateTreatment.map((sample) => sample.signature));
        const hasSharedSignature = checkedWithStateTreatment.some((sample) => uncheckedSignatures.has(sample.signature));
        if (hasSharedSignature) {
          findings.push({
            reason: "checked-unchecked-styles-too-similar",
            checkedCount: checked.length,
            uncheckedCount: unchecked.length,
            selectors: controls.slice(0, 8).map(({ row }) => selectorFor(row))
          });
        }
      }

      return findings.slice(0, 2);
    }

    function isChecklistLikeControl(control: HTMLElement): boolean {
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        return true;
      }

      if (control.getAttribute("role") === "checkbox") {
        return true;
      }

      const row = checklistRowFor(control);
      return /\b(check|checklist|complete|completed|done|task|todo|step)\b/i.test(`${classNameFor(control)} ${classNameFor(row)}`);
    }

    function checklistRowFor(control: HTMLElement): HTMLElement {
      return control.closest<HTMLElement>("li,[role='listitem'],label,[class*='item'],[class*='row'],[class*='step'],[class*='check']") ?? control.parentElement ?? control;
    }

    function isCheckedState(control: HTMLElement): boolean {
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        return control.checked;
      }

      const ariaChecked = control.getAttribute("aria-checked");
      if (ariaChecked === "true") {
        return true;
      }

      return /\b(active|checked|complete|completed|done|selected)\b/i.test(control.className);
    }

    function hasCustomChecklistStateTreatment(control: HTMLElement, row: HTMLElement): boolean {
      return /\b(active|checked|complete|completed|done|selected|current|pending|waiting)\b/i.test(`${classNameFor(control)} ${classNameFor(row)}`);
    }

    function classNameFor(element: HTMLElement): string {
      return typeof element.className === "string" ? element.className : "";
    }

    function visualSignature(element: HTMLElement): string {
      const style = window.getComputedStyle(element);
      const fontWeight = Number.parseInt(style.fontWeight || "400", 10) >= 600 ? "bold" : "normal";
      return [
        normalizedColor(style.backgroundColor),
        normalizedColor(style.borderTopColor),
        normalizedColor(style.color),
        fontWeight
      ].join("|");
    }

    function normalizedColor(value: string): string {
      const color = parseRgb(value);
      return `${Math.round(color.red)},${Math.round(color.green)},${Math.round(color.blue)},${Number(color.alpha.toFixed(2))}`;
    }

    function collectFixedWidthRisks() {
      if (viewport.width > 480) {
        return { samples: [], detectedCount: 0 };
      }

      const matches = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
        .filter(isElementVisible)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > viewport.width + 2 || element.scrollWidth > viewport.width + 2;
        });
      return boundedElementSamples(matches);
    }

    function collectStickyObstructionRisks() {
      const matches = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
        .filter(isElementVisible)
        .filter((element) => {
          const style = window.getComputedStyle(element);
          if (style.position !== "fixed" && style.position !== "sticky") {
            return false;
          }
          const rect = element.getBoundingClientRect();
          const intersectsViewport = rect.bottom > 0 && rect.top < viewport.height;
          const occupiesLargeHeight = rect.height >= viewport.height * 0.22;
          const occupiesLargeWidth = rect.width >= viewport.width * 0.5;
          return intersectsViewport && occupiesLargeHeight && occupiesLargeWidth;
        });
      return boundedElementSamples(matches);
    }

    function cjkCharacterShare(text: string): number {
      let cjkCount = 0;
      let totalCount = 0;
      for (const character of text) {
        if (/\s/.test(character)) {
          continue;
        }
        totalCount += 1;
        if (/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(character)) {
          cjkCount += 1;
        }
      }
      return totalCount === 0 ? 0 : cjkCount / totalCount;
    }

    function collectExcessiveLineLength(elements: HTMLElement[]) {
      const matches = elements
        .filter(isReadableTextMeasureCandidate)
        .map((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const fontSize = Number.parseFloat(style.fontSize || "16");
          const measuredWidth = style.whiteSpace === "nowrap" ? Math.max(rect.width, element.scrollWidth) : rect.width;
          const text = element.innerText.trim();
          // CJK glyphs are full-width (~1.0em) while Latin averages ~0.52em, and
          // majority-CJK text has a shorter comfortable measure (~40-45 chars vs
          // 50-75 for Latin), so the width factor and threshold branch by script.
          const isCjkMajority = cjkCharacterShare(text) > 0.5;
          const characterWidthFactor = isCjkMajority ? 1 : 0.52;
          const riskThreshold = isCjkMajority ? 60 : 95;
          const estimatedCharactersPerLine = Math.round(measuredWidth / Math.max(fontSize * characterWidthFactor, 1));
          return {
            element,
            text,
            estimatedCharactersPerLine,
            riskThreshold
          };
        })
        .filter(({ text, estimatedCharactersPerLine, riskThreshold }) => text.length > 160 && estimatedCharactersPerLine > riskThreshold);
      return {
        detectedCount: matches.length,
        samples: matches
          .slice(0, MAX_BROWSER_FINDING_SAMPLES)
          .map(({ element, estimatedCharactersPerLine }) => ({
            ...sampleElement(element),
            estimatedCharactersPerLine
          }))
      };
    }

    function isReadableTextMeasureCandidate(element: HTMLElement): boolean {
      if (["P", "LI", "TD", "TH"].includes(element.tagName)) {
        return true;
      }

      if (element.tagName !== "ARTICLE") {
        return false;
      }

      return element.querySelector("p,li,td,th,article,section,main") === null;
    }

    // Collection only — the Spacing-exception geometry (WCAG 2.5.8) runs in Node, over the full set, so it
    // is table-testable and cannot be truncated by a slice before exemption is decided. Inline controls are
    // exempt here (text-flow targets sized by their line): a link or button rendered inline in a sentence.
    function collectTapTargetCandidates(elements: HTMLElement[]) {
      return elements
        .filter((element) => window.getComputedStyle(element).display !== "inline")
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const sample = sampleElement(element);
          return {
            ...sample,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          };
        });
    }

    function collectFormErrorAssociationRisks(elements: HTMLElement[]) {
      const matches = elements
        .filter((element) => element.getAttribute("aria-invalid") === "true")
        .filter((element) => !element.getAttribute("aria-describedby") && !element.getAttribute("aria-errormessage"));
      return boundedElementSamples(matches);
    }

    function collectColorOnlyStateRisks() {
      const matches = Array.from(document.body.querySelectorAll<HTMLElement>([
        "[class*='error']",
        "[class*='danger']",
        "[class*='success']",
        "[class*='warning']",
        "[data-state='error']",
        "[data-state='success']",
        "[data-state='warning']"
      ].join(",")))
        .filter(isElementVisible)
        .filter((element) => !element.innerText.trim())
        .filter((element) => !accessibleNameFor(element))
        .filter((element) => !element.getAttribute("role") && !element.getAttribute("aria-live"));
      return boundedElementSamples(matches);
    }

    function collectDisabledWithoutExplanation() {
      const matches = Array.from(document.body.querySelectorAll<HTMLElement>("button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled='true']"))
        .filter(isElementVisible)
        .filter((element) => !element.getAttribute("aria-describedby") && !element.getAttribute("title"))
        .filter((element) => {
          const parentText = element.parentElement?.innerText.trim() ?? "";
          const ownText = element.innerText?.trim() ?? "";
          const nearbyText = parentText.replace(ownText, "").trim();
          return nearbyText.length < 12;
        });
      return boundedElementSamples(matches);
    }

    function collectStatusLiveRegionRisks() {
      const matches = Array.from(document.body.querySelectorAll<HTMLElement>([
        "[class*='status']",
        "[class*='toast']",
        "[class*='alert']",
        "[class*='loading']",
        "[class*='saving']",
        "[aria-busy='true']",
        "[data-state]"
      ].join(",")))
        .filter(isElementVisible)
        .filter((element) => {
          // Language-keyed status vocabulary; \b does not match Hangul boundaries,
          // so the Korean pattern relies on the status-ish selectors above for scope.
          const statusKeywordPatterns = [
            /\b(loading|saving|saved|success|error|failed|complete)\b/i,
            /로딩\s*중|불러오는\s*중|저장\s*중|저장됨|처리\s*중|완료|실패|오류/
          ];
          return statusKeywordPatterns.some((pattern) => pattern.test(element.innerText));
        })
        .filter((element) => !hasStatusSemantics(element));
      return boundedElementSamples(matches);
    }

    function collectModalFocusRisks() {
      const matches = Array.from(document.body.querySelectorAll<HTMLElement>("dialog[open],[role='dialog'],[aria-modal='true']"))
        .filter(isElementVisible)
        .filter((element) => element.getAttribute("aria-modal") !== "true" || !hasFocusableDescendant(element));
      return boundedElementSamples(matches);
    }

    function collectCustomControlSemanticsRisks() {
      const matches = Array.from(document.body.querySelectorAll<HTMLElement>("[onclick],[role='button'],[role='link'],[role='checkbox'],[role='switch'],[role='tab']"))
        .filter(isElementVisible)
        .filter((element) => !["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName))
        .filter((element) => !element.getAttribute("role") || (!element.hasAttribute("tabindex") && element.getAttribute("contenteditable") !== "true") || !accessibleNameFor(element));
      return boundedElementSamples(matches);
    }

    function collectMovingContentControlRisks() {
      const autoplayMedia = Array.from(document.body.querySelectorAll<HTMLElement>("video[autoplay],audio[autoplay],marquee"))
        .filter(isElementVisible)
        .filter((element) => !element.hasAttribute("controls"));

      const animatedElements = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
        .filter(isElementVisible)
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const duration = parseCssTime(style.animationDuration);
          const iterationCount = style.animationIterationCount;
          return duration > 0 && (iterationCount === "infinite" || Number(iterationCount) > 1);
        })
        .filter((element) => !element.closest("[data-design-harness-motion-control]"));

      return boundedElementSamples([...autoplayMedia, ...animatedElements]);
    }

    function boundedElementSamples(elements: HTMLElement[]) {
      return {
        detectedCount: elements.length,
        samples: elements
          .slice(0, MAX_BROWSER_FINDING_SAMPLES)
          .map((element) => sampleElement(element))
      };
    }

    function hasStatusSemantics(element: HTMLElement): boolean {
      let current: HTMLElement | null = element;
      while (current) {
        const role = current.getAttribute("role");
        if (role === "status" || role === "alert" || role === "progressbar" || current.getAttribute("aria-live")) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    function hasFocusableDescendant(element: HTMLElement): boolean {
      return element.querySelector([
        "a[href]",
        "button:not(:disabled)",
        "input:not(:disabled):not([type='hidden'])",
        "select:not(:disabled)",
        "textarea:not(:disabled)",
        "[tabindex]:not([tabindex='-1'])"
      ].join(",")) !== null;
    }

    function parseCssTime(value: string): number {
      const first = value.split(",")[0]?.trim() ?? "0s";
      if (first.endsWith("ms")) {
        return Number.parseFloat(first) / 1000;
      }
      if (first.endsWith("s")) {
        return Number.parseFloat(first);
      }
      return 0;
    }

    function rendersOwnText(element: HTMLElement): boolean {
      // Literal 3 rather than Node.TEXT_NODE: this closure is serialised via Function.prototype.toString,
      // and a literal removes any question about identifier resolution in the page.
      //
      // This is deliberately not a leaf test. In `<p style="color:#777">x <strong style="color:#fff">y
      // </strong></p>` both elements render their own text in their own colour and both must be scored;
      // a leaf test would drop the `p` and lose its risk entirely.
      return Array.from(element.childNodes)
        .some((node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "");
    }

    function directTextOf(element: HTMLElement): string {
      return Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim()
        .slice(0, 120);
    }

    /**
     * A computed colour is opaque unless it carries an explicit alpha component. Chromium omits alpha
     * entirely when opaque (`rgb(11, 15, 25)`, `oklch(0.7 0.35 150)`) and always emits it otherwise
     * (`rgba(…, 0.06)`, `oklab(… / 0.06)`, `color(srgb 1 1 1 / 0.06)`). This is purely syntactic, so the
     * closure needs no colour maths — conversion stays in Node where it is unit-testable.
     *
     * Conservative in the safe direction: an unrecognised string reads as opaque and stops the walk, and
     * Node then returns null for it and skips. It can never fabricate a backdrop.
     */
    function layerIsOpaque(value: string): boolean {
      if (typeof value !== "string") {
        return true;
      }
      if (value.indexOf("/") !== -1) {
        return false;
      }
      const legacy = value.match(/^rgba?\(([^)]*)\)$/);
      if (legacy) {
        const parts = legacy[1].split(",");
        return parts.length >= 4 ? Number.parseFloat(parts[3]) === 1 : true;
      }
      return true;
    }

    /**
     * Measures the UA canvas instead of inferring it from `color-scheme`.
     *
     * Testing `/dark/` against `color-scheme` is wrong: `color-scheme: light dark` — what Tailwind v4 and
     * shadcn emit — computes to the literal string "light dark" and would mass-skip light pages. A
     * `color: Canvas` probe reads rgb(255, 255, 255) for normal/light/"light dark"-in-light and
     * rgb(18, 18, 18) for dark, deriving the value rather than hardcoding a Chromium constant.
     */
    function measureCanvasColor(): string {
      const probe = document.createElement("div");
      probe.style.color = "Canvas";
      probe.style.display = "none";
      document.documentElement.appendChild(probe);
      const measured = window.getComputedStyle(probe).color;
      probe.remove();
      return measured || "rgb(255, 255, 255)";
    }

    /**
     * Finds group paint effects that make computed foreground/background colours insufficient evidence.
     *
     * This walk is deliberately separate from `collectBackdrop` and always reaches through <html>.
     * Backdrop collection can stop at an opaque child background, but an ancestor's opacity, blending, or
     * filter still changes the pixels painted for that child. Scan every ancestor so an opaque layer cannot
     * hide one of those effects, then apply one stable priority across the complete chain.
     */
    function collectPaintEffectSkipReason(element: HTMLElement): ContrastSkipReason | undefined {
      let mixBlendModeFound = false;
      let filterFound = false;
      let current: HTMLElement | null = element;

      while (current) {
        const style = window.getComputedStyle(current);
        const opacity = Number(style.opacity);
        if (!Number.isFinite(opacity) || opacity !== 1) {
          return "opacity";
        }
        if (style.mixBlendMode !== "normal") {
          mixBlendModeFound = true;
        }
        // Identity-looking syntax still creates a filter effect and is intentionally not interpreted.
        if (style.filter !== "none") {
          filterFound = true;
        }
        current = current.parentElement;
      }

      if (mixBlendModeFound) {
        return "mix-blend-mode";
      }
      return filterFound ? "filter" : undefined;
    }

    function collectBackdrop(element: HTMLElement): { layers: string[]; skipReason?: ContrastSkipReason } {
      const layers: string[] = [];
      let outOfFlowVisited = false;
      let current: HTMLElement | null = element;

      while (current) {
        const style = window.getComputedStyle(current);

        // Bail flags are tested BEFORE the background-colour opacity test on the same element: a
        // background-image paints on top of that element's background-color, so an opaque colour does not
        // make the image irrelevant.
        if (style.backgroundImage !== "none") {
          return { layers, skipReason: "background-image" };
        }
        const backdropFilter = style.backdropFilter
          || (style as unknown as Record<string, string>).webkitBackdropFilter;
        if (backdropFilter && backdropFilter !== "none") {
          return { layers, skipReason: "backdrop-filter" };
        }
        if (style.position === "fixed" || style.position === "absolute") {
          outOfFlowVisited = true;
        }

        layers.push(style.backgroundColor);
        if (layerIsOpaque(style.backgroundColor)) {
          return { layers };
        }
        current = current.parentElement;
      }

      // The chain reached past <html> without an opaque layer. For an in-flow element that genuinely means
      // the canvas paints behind it, and the measured canvas colour is correct. For an out-of-flow element
      // — a portalled scrim, a fixed overlay — the DOM ancestry does not describe what paints behind it,
      // and using the canvas would manufacture a false positive on dark app shells painted by a wrapper.
      return outOfFlowVisited ? { layers, skipReason: "detached-backdrop" } : { layers };
    }

    function parseRgb(value: string) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) {
        return { red: 0, green: 0, blue: 0, alpha: 1 };
      }
      const [red, green, blue, alpha = "1"] = match[1].split(",").map((part) => part.trim());
      return {
        red: Number(red),
        green: Number(green),
        blue: Number(blue),
        alpha: Number(alpha)
      };
    }

    function rgbToHsl(color: { red: number; green: number; blue: number }) {
      const red = color.red / 255;
      const green = color.green / 255;
      const blue = color.blue / 255;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const lightness = (max + min) / 2;
      const delta = max - min;
      if (delta === 0) {
        return { hue: 0, saturation: 0, lightness };
      }

      const saturation = delta / (1 - Math.abs(2 * lightness - 1));
      let hue = 0;
      if (max === red) {
        hue = 60 * (((green - blue) / delta) % 6);
      } else if (max === green) {
        hue = 60 * ((blue - red) / delta + 2);
      } else {
        hue = 60 * ((red - green) / delta + 4);
      }

      return {
        hue: hue < 0 ? hue + 360 : hue,
        saturation,
        lightness
      };
    }

    function standardDeviation(values: number[]): number {
      const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
      const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length, 1);
      return Math.sqrt(variance);
    }
  }, config);

  const { contrastCandidates, tapTargetCandidates, findingCoverage, ...collection } = raw;
  const { risks, detectedCount: contrastDetectedCount, coverage } = computeContrastRisks(contrastCandidates);
  const { risks: tapTargetRisks, detectedCount: tapTargetDetectedCount } = computeTapTargetRisks(tapTargetCandidates);
  const likelyBlank = collection.measurements.textLength === 0
    && collection.measurements.meaningfulElementCount === 0;
  const emittedContrastCount = likelyBlank ? 0 : Math.min(risks.length, 5);
  const emittedTapTargetCount = likelyBlank ? 0 : Math.min(tapTargetRisks.length, 5);
  const completeFindingCoverage = !likelyBlank && findingCoverage
    ? {
        viewport: findingCoverage.viewport,
        entries: [
          ...findingCoverage.entries,
          {
            checkName: "dom-contrast-risk",
            detectedCount: contrastDetectedCount,
            emittedCount: emittedContrastCount,
            omittedCount: contrastDetectedCount - emittedContrastCount,
            limit: 5
          },
          {
            checkName: "tap-target-risk",
            detectedCount: tapTargetDetectedCount,
            emittedCount: emittedTapTargetCount,
            omittedCount: tapTargetDetectedCount - emittedTapTargetCount,
            limit: 5
          }
        ]
      } satisfies FindingCoverage
    : undefined;
  const notices = coverage.skippedElementCount > 0
    ? [...collection.notices, {
        code: "contrast-elements-skipped",
        message: `Skipped ${coverage.skippedElementCount} element(s) whose painted contrast could not be `
          + "determined from computed styles; no contrast finding was emitted for them.",
        viewport: collection.measurements.viewport,
        details: {
          skippedElementCount: coverage.skippedElementCount,
          skippedByReason: coverage.skippedByReason
        }
      } satisfies AuditNotice]
    : collection.notices;

  return {
    ...collection,
    notices,
    ...(completeFindingCoverage ? { findingCoverage: completeFindingCoverage } : {}),
    measurements: {
      ...collection.measurements,
      // Overrides the placeholders emitted by the closure. Every key already exists there, so these
      // assignments keep their original positions and audit.json serialisation order is unchanged.
      contrastRisks: risks,
      contrastCoverage: coverage,
      tapTargetRisks
    }
  };
}
