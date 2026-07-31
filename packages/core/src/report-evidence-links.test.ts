import { describe, expect, it } from "vitest";
import { buildMarkdownReport, type AuditResult } from "./index.js";

/**
 * Evidence assets are listed, never inlined.
 *
 * Measured 2026-08-01 by auditing the merchant-dashboard fixture: a page with zero
 * findings produced a 33869-byte report of which 96% was `JSON.stringify` of the
 * text inventory, aria snapshot, and measurement blobs. The same data already sits
 * in `audit.json` under the same asset id, so the report duplicated it while
 * crowding out what a human or an agent actually reads. After the fix the same
 * page renders 2836 bytes.
 */
describe("report evidence links do not inline payloads", () => {
  const render = (assets: unknown[]): string => {
    const auditResult = {
      schemaVersion: "0.2",
      harnessVersion: "0.0.0-test",
      runId: "test-run",
      target: { kind: "local-url", url: "http://127.0.0.1:4173/" },
      viewportPresets: [],
      evidenceAssets: assets,
      findings: [],
      timings: {
        startedAt: "2026-08-01T00:00:00.000Z",
        finishedAt: "2026-08-01T00:00:01.000Z",
        durationMs: 1000
      },
      status: "success",
      failedChecks: [],
      advisoryScore: {
        formulaVersion: "epistemic-criterion-max-v2",
        value: 100,
        max: 100,
        band: "strong",
        deductions: [],
        totalDeduction: 0,
        saturated: false,
        explanation: "test"
      }
    } as unknown as AuditResult;
    return buildMarkdownReport({ auditResult }).markdown;
  };

  it("keeps a real file path for path-bearing assets", () => {
    const markdown = render([
      { id: "screenshot-desktop", type: "screenshot", viewport: "desktop", path: "screenshots/desktop.png" }
    ]);
    expect(markdown).toContain("`screenshot-desktop` (screenshot, desktop): screenshots/desktop.png");
  });

  it("points a path-less asset at audit.json instead of dumping it", () => {
    const markdown = render([
      {
        id: "text-inventory-desktop",
        type: "text-inventory",
        viewport: "desktop",
        data: {
          viewport: "desktop",
          count: 46,
          items: Array.from({ length: 46 }, (_unused, index) => ({ text: `row ${index}` }))
        }
      }
    ]);
    expect(markdown).toContain("see `audit.json`");
    expect(markdown).toContain("`text-inventory-desktop`");
    expect(markdown).not.toContain("row 0");
    expect(markdown).not.toContain('"items"');
  });

  it("adds a counts-only shape hint, never content", () => {
    const markdown = render([
      {
        id: "text-inventory-desktop",
        type: "text-inventory",
        viewport: "desktop",
        data: { count: 46, truncatedCount: 3, items: [{ text: "secret label" }] }
      }
    ]);
    expect(markdown).toContain("46 item(s)");
    expect(markdown).toContain("3 truncated");
    expect(markdown).not.toContain("secret label");
  });

  it("names the snapshot format for aria assets without emitting the snapshot", () => {
    const markdown = render([
      {
        id: "aria-snapshot-desktop",
        type: "aria-snapshot",
        viewport: "desktop",
        data: { format: "playwright-aria-yaml", snapshot: '- button "Export"' }
      }
    ]);
    expect(markdown).toContain("playwright-aria-yaml");
    expect(markdown).not.toContain("- button");
  });

  it("tolerates assets with neither a path nor data", () => {
    const markdown = render([{ id: "bare", type: "measurement" }]);
    expect(markdown).toContain("`bare` (measurement): see `audit.json`");
  });

  it("still reports when no assets exist at all", () => {
    expect(render([])).toContain("No evidence assets were recorded.");
  });

  /**
   * The regression that matters: payload size must not scale the report. Eight
   * assets carrying a thousand inventory items each must still render short.
   */
  it("keeps the report small regardless of payload size", () => {
    const heavy = Array.from({ length: 8 }, (_unused, index) => ({
      id: `asset-${index}`,
      type: "text-inventory",
      viewport: index % 2 === 0 ? "desktop" : "mobile",
      data: {
        count: 1000,
        items: Array.from({ length: 1000 }, (_u, i) => ({
          text: "x".repeat(80),
          selector: `div:nth-child(${i})`
        }))
      }
    }));
    const markdown = render(heavy);
    expect(markdown.length).toBeLessThan(4000);
    expect(markdown).not.toContain("nth-child(999)");
  });
});
