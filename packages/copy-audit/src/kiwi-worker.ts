import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

import {
  reverifyAndReadPreparedKiwiModelFiles,
  type PreparedKiwiModelProfile
} from "./kiwi-model.js";
import type {
  MorphologyToken,
  MorphologyTokenAnalysis
} from "./josa-batchim.js";
import type { CopyInventory } from "./types.js";

interface AnalyzeRequest {
  readonly type: "analyze";
  readonly profile: PreparedKiwiModelProfile;
  readonly inventories: readonly CopyInventory[];
}

interface AnalyzeSuccess {
  readonly type: "result";
  readonly analyses: readonly MorphologyTokenAnalysis[];
}

interface AnalyzeFailure {
  readonly type: "error";
  readonly code: string;
}

if (!parentPort) {
  throw new Error("Kiwi worker requires a worker_threads parent port.");
}

parentPort.once("message", (message: AnalyzeRequest) => {
  void analyze(message)
    .then((result) => parentPort?.postMessage(result))
    .catch((error) => parentPort?.postMessage({
      type: "error",
      code: workerErrorCode(error)
    } satisfies AnalyzeFailure));
});

async function analyze(request: AnalyzeRequest): Promise<AnalyzeSuccess> {
  if (request.type !== "analyze") {
    throw new Error("invalid-request");
  }
  const modelFiles = await loadVerifiedModelFiles(request.profile);
  const kiwiModule = await import("kiwi-nlp");
  const kiwiEntry = import.meta.resolve("kiwi-nlp");
  const wasmPath = fileURLToPath(new URL("./kiwi-wasm.wasm", kiwiEntry));
  const builder = await kiwiModule.KiwiBuilder.create(wasmPath);
  const kiwi = await builder.build({
    modelFiles,
    modelType: "cong",
    integrateAllomorph: true,
    loadDefaultDict: false,
    loadTypoDict: false,
    loadMultiDict: false
  });

  const analyses: MorphologyTokenAnalysis[] = [];
  for (const [inventoryIndex, inventory] of request.inventories.entries()) {
    for (const [itemIndex, item] of inventory.items.entries()) {
      const result = kiwi.analyze(item.text);
      analyses.push({
        inventoryIndex,
        itemIndex,
        tokens: result.tokens.map(projectToken)
      });
    }
  }
  return { type: "result", analyses };
}

async function loadVerifiedModelFiles(
  profile: PreparedKiwiModelProfile
): Promise<Readonly<Record<string, Uint8Array>>> {
  try {
    return await reverifyAndReadPreparedKiwiModelFiles(profile);
  } catch (error) {
    const code = workerErrorCode(error);
    throw Object.assign(new Error("Kiwi model profile re-verification failed."), {
      code: code === "kiwi-worker-failed"
        ? "model-profile-reverification-failed"
        : code
    });
  }
}

function projectToken(token: {
  str: string;
  position: number;
  length: number;
  tag: string;
}): MorphologyToken {
  return {
    str: token.str,
    position: token.position,
    length: token.length,
    tag: token.tag
  };
}

function workerErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown };
  if (typeof candidate?.code === "string" && /^[a-z0-9-]{1,80}$/.test(candidate.code)) {
    return candidate.code;
  }
  return "kiwi-worker-failed";
}
