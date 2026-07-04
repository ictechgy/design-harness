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

    return {
      viewport: document.documentElement.dataset.designHarnessViewport || "unknown",
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      textLength: document.body.innerText.trim().length,
      meaningfulElementCount: textElements.length,
      clippedText,
      contrastRisks
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
  });
}
