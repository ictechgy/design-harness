import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

import { describe, expect, it, vi } from "vitest";

import {
  KIWI_MORPHOLOGY_INPUT_LIMITS,
  prepareKiwiMorphologyAnalyzer,
  runKiwiWorker
} from "./kiwi-morphology.js";
import type {
  KiwiModelContract,
  PreparedKiwiModelProfile
} from "./kiwi-model.js";
import type { CopyInventory } from "./types.js";

const CONTRACT: KiwiModelContract = {
  version: "0.23.0",
  modelType: "cong",
  files: [{
    name: "model.bin",
    bytes: 1,
    sha256: createHash("sha256").update("x").digest("hex")
  }]
};
const PROFILE: PreparedKiwiModelProfile = Object.freeze({
  rootDir: "/model",
  version: "0.23.0",
  modelType: "cong",
  profileSha256: "a".repeat(64),
  totalBytes: 1,
  files: Object.freeze([Object.freeze({
    ...CONTRACT.files[0] as NonNullable<(typeof CONTRACT.files)[number]>,
    path: "/model/model.bin"
  })])
});

describe("prepareKiwiMorphologyAnalyzer", () => {
  it("preflights once, stays lazy until invocation, and returns provenance only after success", async () => {
    const verifyModelDirectory = vi.fn(async () => PROFILE);
    const runWorker = vi.fn(async () => [{
      inventoryIndex: 0,
      itemIndex: 0,
      tokens: [
        { str: "마을", position: 0, length: 2, tag: "NNG" },
        { str: "를", position: 2, length: 1, tag: "JKO" }
      ]
    }]);
    const analyzer = await prepareKiwiMorphologyAnalyzer("model", {
      cwd: "/project",
      contract: CONTRACT,
      verifyModelDirectory,
      runWorker
    });

    expect(verifyModelDirectory).toHaveBeenCalledOnce();
    expect(runWorker).not.toHaveBeenCalled();
    const result = await analyzer(inventory("마을를"));
    expect(runWorker).toHaveBeenCalledOnce();
    expect(result.findings).toHaveLength(1);
    expect(result.notices).toEqual([]);
    expect(result.provenance).toEqual({
      kiwiNlpVersion: "0.23.0",
      modelVersion: "0.23.0",
      modelType: "cong",
      modelProfileSha256: "a".repeat(64),
      modelBytes: 1
    });
  });

  it("converts parser runtime errors into one bounded non-failing notice without provenance", async () => {
    const error = Object.assign(new Error("contains /private/model path"), {
      code: "kiwi-worker-analysis-failed"
    });
    const analyzer = await prepareKiwiMorphologyAnalyzer("model", {
      contract: CONTRACT,
      verifyModelDirectory: vi.fn(async () => PROFILE),
      runWorker: vi.fn(async () => {
        throw error;
      })
    });
    const result = await analyzer(inventory("마을를"));
    expect(result.findings).toEqual([]);
    expect(result).not.toHaveProperty("provenance");
    expect(result.notices).toEqual([{
      code: "copy-morphology-unavailable",
      message: "Kiwi morphology could not complete; parser-free and visual audit results remain available.",
      details: {
        capability: "kiwi-morphology",
        reason: "kiwi-worker-analysis-failed"
      }
    }]);
    expect(JSON.stringify(result)).not.toContain("/private/model");
  });

  it.each([
    "model-file-digest-mismatch",
    "model-profile-reverification-failed",
    "invalid-model-contract",
    "invalid-model-directory"
  ])("fails closed for model integrity code %s", async (code) => {
    const error = Object.assign(new Error("model integrity failed"), { code });
    const analyzer = await prepareKiwiMorphologyAnalyzer("model", {
      contract: CONTRACT,
      verifyModelDirectory: vi.fn(async () => PROFILE),
      runWorker: vi.fn(async () => {
        throw error;
      })
    });

    await expect(analyzer(inventory("마을를"))).rejects.toBe(error);
  });

  it("skips an over-cap batch without invoking the worker or truncating", async () => {
    const runWorker = vi.fn();
    const analyzer = await prepareKiwiMorphologyAnalyzer("model", {
      contract: CONTRACT,
      verifyModelDirectory: vi.fn(async () => PROFILE),
      runWorker
    });
    const result = await analyzer(inventory(
      "가".repeat(KIWI_MORPHOLOGY_INPUT_LIMITS.maxCodeUnitsPerItem + 1)
    ));
    expect(runWorker).not.toHaveBeenCalled();
    expect(result.findings).toEqual([]);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({
      code: "copy-morphology-skipped",
      details: { reason: "per-item-code-units" }
    });
  });

  it.each([
    {
      reason: "inventory-count",
      inventories: Array.from(
        { length: KIWI_MORPHOLOGY_INPUT_LIMITS.maxInventories + 1 },
        (_, index) => ({
          viewport: `viewport-${index}`,
          evidenceRef: `text-inventory-${index}`,
          items: []
        })
      )
    },
    {
      reason: "item-count",
      inventories: [{
        viewport: "desktop",
        evidenceRef: "text-inventory-desktop",
        items: Array.from(
          { length: KIWI_MORPHOLOGY_INPUT_LIMITS.maxItems + 1 },
          (_, index) => ({ selector: `#item-${index}`, text: "가" })
        )
      }]
    },
    {
      reason: "total-code-units",
      inventories: [{
        viewport: "desktop",
        evidenceRef: "text-inventory-desktop",
        items: Array.from(
          {
            length: (
              KIWI_MORPHOLOGY_INPUT_LIMITS.maxTotalCodeUnits
              / KIWI_MORPHOLOGY_INPUT_LIMITS.maxCodeUnitsPerItem
            ) + 1
          },
          (_, index) => ({
            selector: `#item-${index}`,
            text: "가".repeat(KIWI_MORPHOLOGY_INPUT_LIMITS.maxCodeUnitsPerItem)
          })
        )
      }]
    }
  ])("skips the $reason cap without a worker", async ({ reason, inventories }) => {
    const runWorker = vi.fn();
    const analyzer = await prepareKiwiMorphologyAnalyzer("model", {
      contract: CONTRACT,
      verifyModelDirectory: vi.fn(async () => PROFILE),
      runWorker
    });
    const result = await analyzer(inventories);
    expect(runWorker).not.toHaveBeenCalled();
    expect(result.findings).toEqual([]);
    expect(result.notices[0]).toMatchObject({
      code: "copy-morphology-skipped",
      details: { reason }
    });
  });

  it("rejects incomplete worker output instead of guessing", async () => {
    const analyzer = await prepareKiwiMorphologyAnalyzer("model", {
      contract: CONTRACT,
      verifyModelDirectory: vi.fn(async () => PROFILE),
      runWorker: vi.fn(async () => [])
    });
    const result = await analyzer(inventory("마을를"));
    expect(result.findings).toEqual([]);
    expect(result.notices[0]).toMatchObject({
      code: "copy-morphology-unavailable",
      details: { reason: "kiwi-worker-result-incomplete" }
    });
  });
});

describe("runKiwiWorker lifecycle", () => {
  const deadlinesMs = {
    startup: 1_000,
    analysis: 50,
    shutdown: 1_000
  } as const;

  it("terminates a fresh worker after every successful batch", async () => {
    const workers: Worker[] = [];
    const createWorker = () => {
      const worker = scriptedWorker(`
        parentPort.on("message", () => {
          parentPort.postMessage({
            type: "result",
            analyses: [{
              inventoryIndex: 0,
              itemIndex: 0,
              tokens: [{ str: "가", position: 0, length: 1, tag: "NNG" }]
            }]
          });
          setInterval(() => {}, 1000);
        });
      `);
      workers.push(worker);
      return worker;
    };

    for (let run = 0; run < 2; run += 1) {
      await expect(runKiwiWorker({
        profile: PROFILE,
        inventories: inventory("가")
      }, { createWorker, deadlinesMs })).resolves.toHaveLength(1);
    }

    expect(workers).toHaveLength(2);
    expect(new Set(workers).size).toBe(2);
    expect(workers.every((worker) => worker.threadId === -1)).toBe(true);
  });

  it("terminates after a structured parser error", async () => {
    let worker: Worker | undefined;
    await expect(runKiwiWorker({
      profile: PROFILE,
      inventories: inventory("가")
    }, {
      createWorker: () => {
        worker = scriptedWorker(`
          parentPort.on("message", () => {
            parentPort.postMessage({ type: "error", code: "synthetic-parse-error" });
            setInterval(() => {}, 1000);
          });
        `);
        return worker;
      },
      deadlinesMs
    })).rejects.toMatchObject({ code: "synthetic-parse-error" });
    expect(worker?.threadId).toBe(-1);
  });

  it("terminates after the bounded analysis deadline", async () => {
    let worker: Worker | undefined;
    await expect(runKiwiWorker({
      profile: PROFILE,
      inventories: inventory("가")
    }, {
      createWorker: () => {
        worker = scriptedWorker(`
          parentPort.on("message", () => {
            setInterval(() => {}, 1000);
          });
        `);
        return worker;
      },
      deadlinesMs
    })).rejects.toMatchObject({ code: "kiwi-worker-analysis-timeout" });
    expect(worker?.threadId).toBe(-1);
  });

  it("terminates when the caller cancels", async () => {
    const controller = new AbortController();
    let worker: Worker | undefined;
    const result = runKiwiWorker({
      profile: PROFILE,
      inventories: inventory("가"),
      signal: controller.signal
    }, {
      createWorker: () => {
        worker = scriptedWorker(`
          parentPort.on("message", () => {
            setInterval(() => {}, 1000);
          });
        `);
        return worker;
      },
      deadlinesMs
    });
    setTimeout(() => controller.abort(), 20);
    await expect(result).rejects.toMatchObject({ code: "kiwi-worker-cancelled" });
    expect(worker?.threadId).toBe(-1);
  });

  it("surfaces a shutdown deadline instead of masking cleanup failure", async () => {
    let worker: Worker | undefined;
    await expect(runKiwiWorker({
      profile: PROFILE,
      inventories: inventory("가")
    }, {
      createWorker: () => {
        worker = scriptedWorker(`
          parentPort.on("message", () => {
            parentPort.postMessage({
              type: "result",
              analyses: [{
                inventoryIndex: 0,
                itemIndex: 0,
                tokens: []
              }]
            });
          });
        `);
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          void terminate();
          return new Promise<number>(() => {});
        };
        return worker;
      },
      deadlinesMs: {
        ...deadlinesMs,
        shutdown: 25
      }
    })).rejects.toMatchObject({ code: "kiwi-worker-shutdown-timeout" });
    expect(worker?.threadId).toBe(-1);
  });
});

function inventory(text: string): readonly CopyInventory[] {
  return [{
    viewport: "desktop",
    evidenceRef: "text-inventory-desktop",
    items: [{ selector: "#copy", text }]
  }];
}

function scriptedWorker(body: string): Worker {
  return new Worker(
    `const { parentPort } = require("node:worker_threads");\n${body}`,
    { eval: true }
  );
}
