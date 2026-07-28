import { Worker } from "node:worker_threads";

import type {
  AuditNotice,
  Finding
} from "@design-harness/core";

import {
  josaBatchimMismatchFindings,
  type MorphologyTokenAnalysis
} from "./josa-batchim.js";
import {
  KIWI_MODEL_CONTRACT,
  KIWI_NLP_VERSION,
  isKiwiModelIntegrityError,
  type KiwiModelContract,
  type PreparedKiwiModelProfile,
  verifyKiwiModelDirectory
} from "./kiwi-model.js";
import type { CopyInventory } from "./types.js";

export const KIWI_MORPHOLOGY_INPUT_LIMITS = Object.freeze({
  maxInventories: 16,
  maxItems: 2_000,
  maxCodeUnitsPerItem: 2_000,
  maxTotalCodeUnits: 200_000
});

export const KIWI_MORPHOLOGY_DEADLINES_MS = Object.freeze({
  startup: 5_000,
  analysis: 30_000,
  shutdown: 5_000
});

export interface KiwiMorphologyProvenance {
  readonly kiwiNlpVersion: typeof KIWI_NLP_VERSION;
  readonly modelVersion: string;
  readonly modelType: string;
  readonly modelProfileSha256: string;
  readonly modelBytes: number;
}

export interface MorphologyCopyAnalysisResult {
  readonly findings: readonly Finding[];
  readonly notices: readonly AuditNotice[];
  readonly provenance?: KiwiMorphologyProvenance;
}

export interface MorphologyCopyAnalysisOptions {
  readonly signal?: AbortSignal;
}

export type MorphologyCopyAnalyzer = (
  inventories: readonly CopyInventory[],
  options?: MorphologyCopyAnalysisOptions
) => Promise<MorphologyCopyAnalysisResult>;

export interface KiwiWorkerRunnerInput {
  readonly profile: PreparedKiwiModelProfile;
  readonly inventories: readonly CopyInventory[];
  readonly signal?: AbortSignal;
}

export type KiwiWorkerRunner = (
  input: KiwiWorkerRunnerInput
) => Promise<readonly MorphologyTokenAnalysis[]>;

interface KiwiWorkerDeadlines {
  readonly startup: number;
  readonly analysis: number;
  readonly shutdown: number;
}

interface KiwiWorkerLifecycleOptions {
  readonly createWorker?: () => Worker;
  readonly deadlinesMs?: KiwiWorkerDeadlines;
}

export interface PrepareKiwiMorphologyAnalyzerOptions {
  readonly cwd?: string;
  readonly contract?: KiwiModelContract;
  readonly verifyModelDirectory?: typeof verifyKiwiModelDirectory;
  readonly runWorker?: KiwiWorkerRunner;
}

export async function prepareKiwiMorphologyAnalyzer(
  modelDir: string,
  options: PrepareKiwiMorphologyAnalyzerOptions = {}
): Promise<MorphologyCopyAnalyzer> {
  const contract = options.contract ?? KIWI_MODEL_CONTRACT;
  const profile = await (options.verifyModelDirectory ?? verifyKiwiModelDirectory)(
    modelDir,
    { cwd: options.cwd, contract }
  );
  const runWorker = options.runWorker ?? runKiwiWorker;

  return async (
    inventories: readonly CopyInventory[],
    analysisOptions: MorphologyCopyAnalysisOptions = {}
  ): Promise<MorphologyCopyAnalysisResult> => {
    const limitNotice = validateInputLimits(inventories);
    if (limitNotice) {
      return { findings: [], notices: [limitNotice] };
    }
    if (inventories.every((inventory) => inventory.items.length === 0)) {
      return { findings: [], notices: [] };
    }
    try {
      const analyses = await runWorker({
        profile,
        inventories,
        signal: analysisOptions.signal
      });
      validateWorkerAnalyses(inventories, analyses);
      return {
        findings: josaBatchimMismatchFindings(inventories, analyses),
        notices: [],
        provenance: {
          kiwiNlpVersion: KIWI_NLP_VERSION,
          modelVersion: profile.version,
          modelType: profile.modelType,
          modelProfileSha256: profile.profileSha256,
          modelBytes: profile.totalBytes
        }
      };
    } catch (error) {
      if (isKiwiModelIntegrityError(error)) {
        throw error;
      }
      return {
        findings: [],
        notices: [runtimeUnavailableNotice(runtimeErrorCode(error))]
      };
    }
  };
}

export async function runKiwiWorker(
  input: KiwiWorkerRunnerInput,
  options: KiwiWorkerLifecycleOptions = {}
): Promise<readonly MorphologyTokenAnalysis[]> {
  if (input.signal?.aborted) {
    throw new KiwiWorkerRuntimeError("kiwi-worker-cancelled");
  }
  const deadlines = options.deadlinesMs ?? KIWI_MORPHOLOGY_DEADLINES_MS;
  const worker = options.createWorker?.() ?? new Worker(
    new URL("./kiwi-worker.js", import.meta.url),
    {
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
      stdout: true,
      stderr: true
    }
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  try {
    await waitForOnline(worker, input.signal, deadlines.startup);
    const responsePromise = waitForResponse(worker, input.signal, deadlines.analysis);
    worker.postMessage({
      type: "analyze",
      profile: input.profile,
      inventories: input.inventories
    });
    const analyses = await responsePromise;
    return analyses;
  } finally {
    await terminateWorker(worker, deadlines.shutdown);
  }
}

class KiwiWorkerRuntimeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "KiwiWorkerRuntimeError";
    this.code = code;
  }
}

function validateInputLimits(inventories: readonly CopyInventory[]): AuditNotice | undefined {
  if (inventories.length > KIWI_MORPHOLOGY_INPUT_LIMITS.maxInventories) {
    return inputLimitNotice("inventory-count");
  }
  let itemCount = 0;
  let totalCodeUnits = 0;
  for (const inventory of inventories) {
    itemCount += inventory.items.length;
    if (itemCount > KIWI_MORPHOLOGY_INPUT_LIMITS.maxItems) {
      return inputLimitNotice("item-count");
    }
    for (const item of inventory.items) {
      if (item.text.length > KIWI_MORPHOLOGY_INPUT_LIMITS.maxCodeUnitsPerItem) {
        return inputLimitNotice("per-item-code-units");
      }
      totalCodeUnits += item.text.length;
      if (totalCodeUnits > KIWI_MORPHOLOGY_INPUT_LIMITS.maxTotalCodeUnits) {
        return inputLimitNotice("total-code-units");
      }
    }
  }
  return undefined;
}

function validateWorkerAnalyses(
  inventories: readonly CopyInventory[],
  analyses: readonly MorphologyTokenAnalysis[]
): void {
  const expected = inventories.reduce((sum, inventory) => sum + inventory.items.length, 0);
  if (analyses.length !== expected) {
    throw new KiwiWorkerRuntimeError("kiwi-worker-result-incomplete");
  }
  const seen = new Set<string>();
  for (const analysis of analyses) {
    const key = `${analysis.inventoryIndex}:${analysis.itemIndex}`;
    if (
      seen.has(key)
      || !inventories[analysis.inventoryIndex]?.items[analysis.itemIndex]
      || !Array.isArray(analysis.tokens)
    ) {
      throw new KiwiWorkerRuntimeError("kiwi-worker-result-invalid");
    }
    seen.add(key);
  }
}

function waitForOnline(
  worker: Worker,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<void> {
  return withWorkerDeadline<void>(
    worker,
    signal,
    timeoutMs,
    "kiwi-worker-startup-timeout",
    (resolve, reject) => {
      worker.once("online", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new KiwiWorkerRuntimeError(
        code === 0 ? "kiwi-worker-exited-before-online" : "kiwi-worker-startup-failed"
      )));
    }
  );
}

function waitForResponse(
  worker: Worker,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<readonly MorphologyTokenAnalysis[]> {
  return withWorkerDeadline<readonly MorphologyTokenAnalysis[]>(
    worker,
    signal,
    timeoutMs,
    "kiwi-worker-analysis-timeout",
    (resolve, reject) => {
      worker.once("message", (message: unknown) => {
        const response = message as {
          type?: unknown;
          analyses?: unknown;
          code?: unknown;
        };
        if (response.type === "result" && Array.isArray(response.analyses)) {
          resolve(response.analyses as MorphologyTokenAnalysis[]);
          return;
        }
        if (
          response.type === "error"
          && typeof response.code === "string"
          && /^[a-z0-9-]{1,80}$/.test(response.code)
        ) {
          reject(new KiwiWorkerRuntimeError(response.code));
          return;
        }
        reject(new KiwiWorkerRuntimeError("kiwi-worker-response-invalid"));
      });
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new KiwiWorkerRuntimeError(
        code === 0 ? "kiwi-worker-exited-without-result" : "kiwi-worker-analysis-failed"
      )));
    }
  );
}

function withWorkerDeadline<T>(
  worker: Worker,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutCode: string,
  subscribe: (
    resolve: (value: T) => void,
    reject: (error: unknown) => void
  ) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new KiwiWorkerRuntimeError("kiwi-worker-cancelled"));
      return;
    }
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners("online");
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      worker.removeAllListeners("exit");
      callback();
    };
    const timer = setTimeout(
      () => finish(() => reject(new KiwiWorkerRuntimeError(timeoutCode))),
      timeoutMs
    );
    const onAbort = () => finish(
      () => reject(new KiwiWorkerRuntimeError("kiwi-worker-cancelled"))
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    subscribe(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

async function terminateWorker(
  worker: Worker,
  timeoutMs: number
): Promise<void> {
  const termination = worker.terminate();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new KiwiWorkerRuntimeError("kiwi-worker-shutdown-timeout")),
      timeoutMs
    );
  });
  try {
    await Promise.race([termination, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function inputLimitNotice(limit: string): AuditNotice {
  return {
    code: "copy-morphology-skipped",
    message: "Kiwi morphology was skipped because the captured copy exceeded a bounded input limit.",
    details: {
      capability: "kiwi-morphology",
      reason: limit,
      limits: { ...KIWI_MORPHOLOGY_INPUT_LIMITS }
    }
  };
}

function runtimeUnavailableNotice(reason: string): AuditNotice {
  return {
    code: "copy-morphology-unavailable",
    message: "Kiwi morphology could not complete; parser-free and visual audit results remain available.",
    details: {
      capability: "kiwi-morphology",
      reason
    }
  };
}

function runtimeErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown };
  return typeof candidate?.code === "string" && /^[a-z0-9-]{1,80}$/.test(candidate.code)
    ? candidate.code
    : "kiwi-worker-failed";
}
