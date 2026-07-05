import type { ViewportMeasurements } from "./checks.js";

export async function collectViewportMeasurements(page: {
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
}): Promise<ViewportMeasurements> {
  return page.evaluate(() => {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    const textElements = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return Boolean(element.innerText?.trim()) && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });

    const clippedText = textElements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const clipsOverflow = ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflowY);
        return clipsOverflow && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
      })
      .slice(0, 10)
      .map((element) => sampleElement(element));

    const contrastRisks = textElements
      .map((element) => {
        const style = window.getComputedStyle(element);
        const color = style.color;
        const backgroundColor = findEffectiveBackgroundColor(element);
        const ratio = contrastRatio(parseRgb(color), parseRgb(backgroundColor));
        const fontSize = Number.parseFloat(style.fontSize || "16");
        const fontWeight = Number.parseInt(style.fontWeight || "400", 10);
        const requiredRatio = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        return {
          ...sampleElement(element),
          ratio,
          requiredRatio,
          color,
          backgroundColor
        };
      })
      .filter((sample) => Number.isFinite(sample.ratio) && sample.ratio < sample.requiredRatio)
      .slice(0, 10);

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

    const missingAccessibleNames = interactiveElements
      .filter((element) => !requiresProgrammaticFormLabel(element))
      .filter((element) => !accessibleNameFor(element))
      .slice(0, 10)
      .map((element) => sampleElement(element));

    const formControls = Array.from(document.body.querySelectorAll<HTMLElement>([
      "input:not([type='hidden']):not([type='button']):not([type='submit']):not([type='reset'])",
      "select",
      "textarea"
    ].join(","))).filter(isElementVisible);

    const missingFormLabels = formControls
      .filter((element) => !accessibleNameFor(element))
      .slice(0, 10)
      .map((element) => sampleElement(element));

    const missingImageAlt = Array.from(document.body.querySelectorAll<HTMLImageElement>("img"))
      .filter(isElementVisible)
      .filter((element) => element.getAttribute("role") !== "presentation" && element.getAttribute("aria-hidden") !== "true")
      .filter((element) => !element.hasAttribute("alt"))
      .slice(0, 10)
      .map((element) => sampleElement(element));

    const headingIssues = collectHeadingIssues();
    const missingMainLandmark = document.body.querySelector("main,[role='main']") === null;
    const repeatedLabels = collectRepeatedLabels(interactiveElements);
    const repeatedVisualWeightRisks = collectRepeatedVisualWeightRisks();
    const fixedWidthRisks = collectFixedWidthRisks();
    const stickyObstructionRisks = collectStickyObstructionRisks();
    const excessiveLineLength = collectExcessiveLineLength(textElements);
    const tapTargetRisks = collectTapTargetRisks(interactiveElements);
    const formErrorAssociationRisks = collectFormErrorAssociationRisks(formControls);
    const colorOnlyStateRisks = collectColorOnlyStateRisks();
    const disabledWithoutExplanation = collectDisabledWithoutExplanation();
    const statusLiveRegionRisks = collectStatusLiveRegionRisks();
    const modalFocusRisks = collectModalFocusRisks();
    const customControlSemanticsRisks = collectCustomControlSemanticsRisks();
    const movingContentControlRisks = collectMovingContentControlRisks();

    return {
      viewport: document.documentElement.dataset.designHarnessViewport || "unknown",
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      textLength: document.body.innerText.trim().length,
      meaningfulElementCount: textElements.length,
      clippedText,
      contrastRisks,
      missingAccessibleNames,
      missingFormLabels,
      missingImageAlt,
      headingIssues,
      missingMainLandmark,
      repeatedLabels,
      repeatedVisualWeightRisks,
      fixedWidthRisks,
      stickyObstructionRisks,
      excessiveLineLength,
      tapTargetRisks,
      formErrorAssociationRisks,
      colorOnlyStateRisks,
      disabledWithoutExplanation,
      statusLiveRegionRisks,
      modalFocusRisks,
      customControlSemanticsRisks,
      movingContentControlRisks
    };

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
      let previousLevel = 0;
      let h1Count = 0;

      for (const heading of headings) {
        const level = Number(heading.tagName.slice(1));
        const text = heading.innerText.trim();
        if (level === 1) {
          h1Count += 1;
          if (h1Count > 1) {
            issues.push({ ...sampleElement(heading), level, issue: "duplicate-h1" });
          }
        }

        if (!text) {
          issues.push({ ...sampleElement(heading), level, issue: "empty-heading" });
        }

        if (previousLevel > 0 && level > previousLevel + 1) {
          issues.push({ ...sampleElement(heading), level, issue: "heading-level-skip", previousLevel });
        }

        previousLevel = level;
      }

      return issues.slice(0, 10);
    }

    function collectRepeatedLabels(elements: HTMLElement[]) {
      const labelGroups = new Map<string, string[]>();
      for (const element of elements) {
        const label = accessibleNameFor(element);
        if (!label || label.length > 40) {
          continue;
        }

        const normalized = label.toLowerCase();
        const selectors = labelGroups.get(normalized) ?? [];
        selectors.push(selectorFor(element));
        labelGroups.set(normalized, selectors);
      }

      return Array.from(labelGroups.entries())
        .filter(([, selectors]) => selectors.length >= 3)
        .slice(0, 10)
        .map(([label, selectors]) => ({
          label,
          count: selectors.length,
          selectors
        }));
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

    function collectFixedWidthRisks() {
      if (viewport.width > 480) {
        return [];
      }

      return Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
        .filter(isElementVisible)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > viewport.width + 2 || element.scrollWidth > viewport.width + 2;
        })
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectStickyObstructionRisks() {
      return Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
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
        })
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectExcessiveLineLength(elements: HTMLElement[]) {
      return elements
        .filter(isReadableTextMeasureCandidate)
        .map((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const fontSize = Number.parseFloat(style.fontSize || "16");
          const measuredWidth = style.whiteSpace === "nowrap" ? Math.max(rect.width, element.scrollWidth) : rect.width;
          const estimatedCharactersPerLine = Math.round(measuredWidth / Math.max(fontSize * 0.52, 1));
          return {
            element,
            estimatedCharactersPerLine
          };
        })
        .filter(({ element, estimatedCharactersPerLine }) => element.innerText.trim().length > 160 && estimatedCharactersPerLine > 95)
        .slice(0, 10)
        .map(({ element, estimatedCharactersPerLine }) => ({
          ...sampleElement(element),
          estimatedCharactersPerLine
        }));
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

    function collectTapTargetRisks(elements: HTMLElement[]) {
      return elements
        .filter((element) => {
          const style = window.getComputedStyle(element);
          if (element.tagName === "A" && style.display === "inline") {
            return false;
          }
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24);
        })
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectFormErrorAssociationRisks(elements: HTMLElement[]) {
      return elements
        .filter((element) => element.getAttribute("aria-invalid") === "true")
        .filter((element) => !element.getAttribute("aria-describedby") && !element.getAttribute("aria-errormessage"))
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectColorOnlyStateRisks() {
      return Array.from(document.body.querySelectorAll<HTMLElement>([
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
        .filter((element) => !element.getAttribute("role") && !element.getAttribute("aria-live"))
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectDisabledWithoutExplanation() {
      return Array.from(document.body.querySelectorAll<HTMLElement>("button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled='true']"))
        .filter(isElementVisible)
        .filter((element) => !element.getAttribute("aria-describedby") && !element.getAttribute("title"))
        .filter((element) => {
          const parentText = element.parentElement?.innerText.trim() ?? "";
          const ownText = element.innerText?.trim() ?? "";
          const nearbyText = parentText.replace(ownText, "").trim();
          return nearbyText.length < 12;
        })
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectStatusLiveRegionRisks() {
      return Array.from(document.body.querySelectorAll<HTMLElement>([
        "[class*='status']",
        "[class*='toast']",
        "[class*='alert']",
        "[class*='loading']",
        "[class*='saving']",
        "[aria-busy='true']",
        "[data-state]"
      ].join(",")))
        .filter(isElementVisible)
        .filter((element) => /\b(loading|saving|saved|success|error|failed|complete)\b/i.test(element.innerText))
        .filter((element) => !hasStatusSemantics(element))
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectModalFocusRisks() {
      return Array.from(document.body.querySelectorAll<HTMLElement>("dialog[open],[role='dialog'],[aria-modal='true']"))
        .filter(isElementVisible)
        .filter((element) => element.getAttribute("aria-modal") !== "true" || !hasFocusableDescendant(element))
        .slice(0, 10)
        .map((element) => sampleElement(element));
    }

    function collectCustomControlSemanticsRisks() {
      return Array.from(document.body.querySelectorAll<HTMLElement>("[onclick],[role='button'],[role='link'],[role='checkbox'],[role='switch'],[role='tab']"))
        .filter(isElementVisible)
        .filter((element) => !["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName))
        .filter((element) => !element.getAttribute("role") || (!element.hasAttribute("tabindex") && element.getAttribute("contenteditable") !== "true") || !accessibleNameFor(element))
        .slice(0, 10)
        .map((element) => sampleElement(element));
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

      return [...autoplayMedia, ...animatedElements]
        .slice(0, 10)
        .map((element) => sampleElement(element));
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

    function findEffectiveBackgroundColor(element: HTMLElement): string {
      let current: HTMLElement | null = element;
      while (current) {
        const backgroundColor = window.getComputedStyle(current).backgroundColor;
        const parsed = parseRgb(backgroundColor);
        if (parsed.alpha > 0) {
          return backgroundColor;
        }
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
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

    function contrastRatio(
      foreground: { red: number; green: number; blue: number },
      background: { red: number; green: number; blue: number }
    ): number {
      const foregroundLuminance = relativeLuminance(foreground);
      const backgroundLuminance = relativeLuminance(background);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance);
      const darker = Math.min(foregroundLuminance, backgroundLuminance);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function relativeLuminance(color: { red: number; green: number; blue: number }): number {
      const [red, green, blue] = [color.red, color.green, color.blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }

    function standardDeviation(values: number[]): number {
      const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
      const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length, 1);
      return Math.sqrt(variance);
    }
  });
}
