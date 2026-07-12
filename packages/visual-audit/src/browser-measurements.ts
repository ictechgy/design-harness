import type { AuditNotice, CopyStyleSurfaceRule } from "@design-harness/core";
import type { ViewportMeasurements } from "./checks.js";

export interface ViewportCollectionResult {
  measurements: ViewportMeasurements;
  notices: AuditNotice[];
}

export async function collectViewportMeasurements(page: {
  evaluate: <T>(pageFunction: ((arg?: unknown) => T | Promise<T>), arg?: unknown) => Promise<T>;
}, surfaceMapping?: CopyStyleSurfaceRule[]): Promise<ViewportCollectionResult> {
  return page.evaluate((rawSurfaceMapping): ViewportCollectionResult => {
    const MAX_TEXT_INVENTORY_TEXT_LENGTH = 2_000;
    const surfaceRules = Array.isArray(rawSurfaceMapping)
      ? rawSurfaceMapping as CopyStyleSurfaceRule[]
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

    prepareSurfaceMatchers();

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
    const pageLangMissing = (document.documentElement.getAttribute("lang") || "").trim() === "";
    const repeatedLabels = collectRepeatedLabels(interactiveElements);
    const repeatedVisualWeightRisks = collectRepeatedVisualWeightRisks();
    const saturatedColorNoiseRisks = collectSaturatedColorNoiseRisks();
    const checklistStateVisibilityRisks = collectChecklistStateVisibilityRisks();
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
    const textInventory = collectTextInventory();

    const measurements: ViewportMeasurements = {
      viewport: viewportName,
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
      pageLangMissing,
      missingMainLandmark,
      repeatedLabels,
      repeatedVisualWeightRisks,
      saturatedColorNoiseRisks,
      checklistStateVisibilityRisks,
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
      movingContentControlRisks,
      textInventory
    };

    return { measurements, notices };

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

    function collectTextInventory() {
      return Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
        .filter(isTextInventoryCandidate)
        .map((element) => ({
          element,
          text: textForInventory(element)
        }))
        .filter(({ text }) => text.length > 0)
        .map(({ element, text }) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const textValue = truncateTextForInventory(text);
          const accessibleName = truncateTextForInventory(accessibleNameFor(element));
          const role = roleFor(element);
          const copySurface = resolveCopySurface(element);
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
            ...(copySurface ? { copySurface } : {})
          };
        });
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
      return elements
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
        .filter(({ text, estimatedCharactersPerLine, riskThreshold }) => text.length > 160 && estimatedCharactersPerLine > riskThreshold)
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
        .filter((element) => {
          // Language-keyed status vocabulary; \b does not match Hangul boundaries,
          // so the Korean pattern relies on the status-ish selectors above for scope.
          const statusKeywordPatterns = [
            /\b(loading|saving|saved|success|error|failed|complete)\b/i,
            /로딩\s*중|불러오는\s*중|저장\s*중|저장됨|처리\s*중|완료|실패|오류/
          ];
          return statusKeywordPatterns.some((pattern) => pattern.test(element.innerText));
        })
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
  }, surfaceMapping);
}
