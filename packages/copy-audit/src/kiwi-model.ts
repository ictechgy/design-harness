import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  stat
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const KIWI_NLP_VERSION = "0.23.0";
export const KIWI_MODEL_VERSION = "0.23.0";
export const KIWI_MODEL_TYPE = "cong";

export interface KiwiModelFileContract {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface KiwiModelContract {
  readonly version: string;
  readonly modelType: string;
  readonly files: readonly KiwiModelFileContract[];
}

export const KIWI_MODEL_CONTRACT: KiwiModelContract = Object.freeze({
  version: KIWI_MODEL_VERSION,
  modelType: KIWI_MODEL_TYPE,
  files: Object.freeze([
    Object.freeze({
      name: "combiningRule.txt",
      bytes: 3_584,
      sha256: "3d864f76eade67b250d37f4ee83de848b04fb14d0cd6ed36c36d0b210ad38ebc"
    }),
    Object.freeze({
      name: "cong.mdl",
      bytes: 75_667_563,
      sha256: "bd9ca89ee1b72e750c8e2166a17c80a0fe3fabd828c78b1f0928486a6b1833a7"
    }),
    Object.freeze({
      name: "extract.mdl",
      bytes: 17_370,
      sha256: "a0c92ffc051e43ae497845cdb8d4c8b9e2f359893cb55c67279c76d1d531ee17"
    }),
    Object.freeze({
      name: "nounchr.mdl",
      bytes: 9_734_234,
      sha256: "4b687e36836dd60dcb7addcfcf369ac082b339bab76549574ac1ce2b7ccd6836"
    }),
    Object.freeze({
      name: "sj.morph",
      bytes: 8_462_892,
      sha256: "5e3dab2def6d2cc079e21d5477bd610a391c69045d08caf1e0bbeabda8db8d1b"
    })
  ])
});

export interface PreparedKiwiModelFile extends KiwiModelFileContract {
  readonly path: string;
}

export interface PreparedKiwiModelProfile {
  readonly rootDir: string;
  readonly version: string;
  readonly modelType: string;
  readonly profileSha256: string;
  readonly totalBytes: number;
  readonly files: readonly PreparedKiwiModelFile[];
}

export interface VerifyKiwiModelDirectoryOptions {
  readonly cwd?: string;
  readonly contract?: KiwiModelContract;
}

export class KiwiModelVerificationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KiwiModelVerificationError";
    this.code = code;
  }
}

export async function verifyKiwiModelDirectory(
  modelDir: string,
  options: VerifyKiwiModelDirectoryOptions = {}
): Promise<PreparedKiwiModelProfile> {
  if (!modelDir || modelDir.includes("\0")) {
    throw new KiwiModelVerificationError(
      "invalid-model-directory",
      "--kiwi-model-dir must be a non-empty, NUL-free path."
    );
  }

  const contract = options.contract ?? KIWI_MODEL_CONTRACT;
  validateContract(contract);
  const requestedRoot = resolve(options.cwd ?? process.cwd(), modelDir);
  const rootBefore = await canonicalDirectory(requestedRoot);
  const rootStatBefore = await stat(rootBefore, { bigint: true });
  const entries = await readdir(rootBefore, { withFileTypes: true });
  const expectedNames = [...contract.files.map(({ name }) => name)].sort();
  const actualNames = entries.map(({ name }) => name).sort();
  if (!sameStrings(actualNames, expectedNames)) {
    throw new KiwiModelVerificationError(
      "model-profile-entries-mismatch",
      `Kiwi model directory must contain exactly: ${expectedNames.join(", ")}.`
    );
  }

  const preparedFiles: PreparedKiwiModelFile[] = [];
  for (const expected of contract.files) {
    const requestedFile = resolve(rootBefore, expected.name);
    const linkStat = await lstat(requestedFile);
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
      throw new KiwiModelVerificationError(
        "model-file-not-regular",
        `Kiwi model file ${expected.name} must be a regular non-symlink file.`
      );
    }
    const canonicalFile = await realpath(requestedFile);
    assertContained(rootBefore, canonicalFile, expected.name);
    await verifyFile(canonicalFile, expected);
    preparedFiles.push(Object.freeze({
      ...expected,
      path: canonicalFile
    }));
  }

  const rootAfter = await canonicalDirectory(requestedRoot);
  const rootStatAfter = await stat(rootAfter, { bigint: true });
  if (
    rootAfter !== rootBefore
    || rootStatBefore.dev !== rootStatAfter.dev
    || rootStatBefore.ino !== rootStatAfter.ino
  ) {
    throw new KiwiModelVerificationError(
      "model-directory-changed",
      "Kiwi model directory changed while it was being verified."
    );
  }

  return Object.freeze({
    rootDir: rootBefore,
    version: contract.version,
    modelType: contract.modelType,
    profileSha256: profileDigest(contract),
    totalBytes: contract.files.reduce((sum, file) => sum + file.bytes, 0),
    files: Object.freeze(preparedFiles)
  });
}

export async function reverifyPreparedKiwiModelProfile(
  prepared: PreparedKiwiModelProfile,
  contract: KiwiModelContract = KIWI_MODEL_CONTRACT
): Promise<PreparedKiwiModelProfile> {
  const verified = await verifyKiwiModelDirectory(prepared.rootDir, { contract });
  if (
    verified.version !== prepared.version
    || verified.modelType !== prepared.modelType
    || verified.profileSha256 !== prepared.profileSha256
    || verified.totalBytes !== prepared.totalBytes
    || verified.files.length !== prepared.files.length
    || verified.files.some((file, index) => file.path !== prepared.files[index]?.path)
  ) {
    throw new KiwiModelVerificationError(
      "model-profile-changed",
      "Kiwi model profile changed after CLI preflight."
    );
  }
  return verified;
}

function validateContract(contract: KiwiModelContract): void {
  if (!contract.version || !contract.modelType || contract.files.length === 0) {
    throw new KiwiModelVerificationError(
      "invalid-model-contract",
      "Kiwi model contract must declare a version, model type, and files."
    );
  }
  const seen = new Set<string>();
  for (const file of contract.files) {
    if (
      !/^[A-Za-z0-9._-]+$/.test(file.name)
      || seen.has(file.name)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 0
      || !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new KiwiModelVerificationError(
        "invalid-model-contract",
        "Kiwi model contract contains an invalid or duplicate file entry."
      );
    }
    seen.add(file.name);
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch {
    throw new KiwiModelVerificationError(
      "model-directory-unreadable",
      "Kiwi model directory could not be resolved."
    );
  }
  const details = await stat(canonical);
  if (!details.isDirectory()) {
    throw new KiwiModelVerificationError(
      "model-directory-not-directory",
      "--kiwi-model-dir must resolve to a directory."
    );
  }
  return canonical;
}

async function verifyFile(path: string, expected: KiwiModelFileContract): Promise<void> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollow);
  } catch {
    throw new KiwiModelVerificationError(
      "model-file-unreadable",
      `Kiwi model file ${expected.name} could not be opened safely.`
    );
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new KiwiModelVerificationError(
        "model-file-not-regular",
        `Kiwi model file ${expected.name} must remain a regular file.`
      );
    }
    if (before.size !== BigInt(expected.bytes)) {
      throw new KiwiModelVerificationError(
        "model-file-size-mismatch",
        `Kiwi model file ${expected.name} has the wrong byte size.`
      );
    }

    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      hash.update(chunk);
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
    ) {
      throw new KiwiModelVerificationError(
        "model-file-changed",
        `Kiwi model file ${expected.name} changed while it was being verified.`
      );
    }
    if (hash.digest("hex") !== expected.sha256) {
      throw new KiwiModelVerificationError(
        "model-file-digest-mismatch",
        `Kiwi model file ${expected.name} has the wrong SHA-256 digest.`
      );
    }
  } finally {
    await handle.close();
  }
}

function assertContained(root: string, path: string, name: string): void {
  const relativePath = relative(root, path);
  if (
    relativePath === ""
    || relativePath === ".."
    || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(relativePath)
  ) {
    throw new KiwiModelVerificationError(
      "model-file-escape",
      `Kiwi model file ${name} escapes the verified model directory.`
    );
  }
}

function profileDigest(contract: KiwiModelContract): string {
  const canonical = [
    `version=${contract.version}`,
    `modelType=${contract.modelType}`,
    ...contract.files.map(({ name, bytes, sha256 }) => `${name}\t${bytes}\t${sha256}`)
  ].join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
