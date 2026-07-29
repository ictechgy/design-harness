#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFERENCE_SESSION_FORMAT,
  REFERENCE_SESSION_LIMITS,
  canonicalizeAssets,
  compareInventories,
  enforceAssetCaps,
  mediaTypeFromSignature,
  parseCanonicalInventory,
  parseSessionSlug,
  renderInventory,
  renderWorksheet,
  sha256Hex,
  validateAssetBasename
} from "./reference-session-lib.mjs";
import {
  checkReferenceSession,
  parseReferenceSessionArguments,
  prepareReferenceSession
} from "./reference-session.mjs";

const TEMP_PREFIX = "design-harness-reference-session-";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
const WEBP = Buffer.from("RIFF0000WEBPdata", "ascii");
const DEFAULT_ASSETS = Object.freeze([
  ["b.webp", WEBP],
  ["a.png", PNG],
  ["c.jpeg", JPEG]
]);

await runPureContractCases();
await runFilesystemCases();

const observedSession = parseObservedArgument(process.argv.slice(2));
if (observedSession) {
  console.log(JSON.stringify({
    observedReplay: await runObservedReplay(observedSession)
  }, null, 2));
}

console.log(
  observedSession
    ? "Reference-session regressions and observed replay passed."
    : "Reference-session regressions passed."
);

async function runPureContractCases() {
  assert.equal(parseSessionSlug("observed-2026-07-28"), "observed-2026-07-28");
  for (const value of ["", "UPPER", ".", "..", "a/b", "a\\b", "two--hyphens", " space"]) {
    assert.throws(() => parseSessionSlug(value), undefined, `slug should reject ${JSON.stringify(value)}`);
  }
  assert.deepEqual(
    parseReferenceSessionArguments(["prepare", "--session", "sample-1"]),
    { command: "prepare", sessionSlug: "sample-1" }
  );
  assert.throws(() => parseReferenceSessionArguments(["prepare", "sample-1"]));

  assert.equal(validateAssetBasename("plain.png").expectedMediaType, "image/png");
  for (const value of ["bad.PNG", "bad.gif", "../bad.png", "bad\\name.png", "bad\u202ename.png"]) {
    assert.throws(() => validateAssetBasename(value), undefined, `basename should reject ${JSON.stringify(value)}`);
  }

  assert.equal(mediaTypeFromSignature("a.png", PNG), "image/png");
  assert.equal(mediaTypeFromSignature("a.jpg", JPEG), "image/jpeg");
  assert.equal(mediaTypeFromSignature("a.webp", WEBP), "image/webp");
  assert.throws(() => mediaTypeFromSignature("a.png", JPEG));
  assert.throws(() => mediaTypeFromSignature("a.webp", Buffer.from("RIFF0000NOPE", "ascii")));

  const capAssets = (count, bytes) => Array.from(
    { length: count },
    (_, index) => ({ basename: `${index}.png`, bytes })
  );
  assert.equal(enforceAssetCaps(capAssets(32, 1)), 32);
  assert.equal(
    enforceAssetCaps(capAssets(8, REFERENCE_SESSION_LIMITS.maxAssetBytes)),
    REFERENCE_SESSION_LIMITS.maxTotalBytes
  );
  assert.throws(() => enforceAssetCaps([]));
  assert.throws(() => enforceAssetCaps(capAssets(33, 1)));
  assert.throws(() => enforceAssetCaps(capAssets(1, REFERENCE_SESSION_LIMITS.maxAssetBytes + 1)));
  assert.throws(() => enforceAssetCaps(capAssets(9, REFERENCE_SESSION_LIMITS.maxAssetBytes)));

  const shuffled = [
    assetRecord("z.png", PNG),
    assetRecord("a.png", PNG),
    assetRecord("m.jpg", JPEG)
  ];
  const inventory = renderInventory(shuffled);
  for (let run = 0; run < 10; run += 1) {
    assert.equal(renderInventory([...shuffled].sort(() => Math.random() - 0.5)), inventory);
  }
  assert.deepEqual(parseCanonicalInventory(inventory), canonicalizeAssets(shuffled));
  assert.match(inventory, new RegExp(`"format": "${REFERENCE_SESSION_FORMAT}"`, "u"));
  assert.ok(inventory.endsWith("\n"));
  assert.throws(() => parseCanonicalInventory(inventory.replace('"assets"', '"unknown"')));
  assert.throws(() => parseCanonicalInventory(inventory.trimEnd()));
  assert.throws(() => renderInventory([
    assetRecord("é.png", PNG),
    assetRecord("e\u0301.png", PNG)
  ]));

  const worksheet = renderWorksheet(shuffled, inventory);
  assert.match(worksheet, /LOCAL AND IGNORED/u);
  assert.match(worksheet, /Image pixels do not prove a token/u);
  assert.match(
    worksheet,
    /\| Asset \| Observed cue \| Candidate project choice \| Owner decision \| Rationale and validation \|/u
  );
  assert.equal((worksheet.match(/\| [amz]\.(?:png|jpg) \|  \|  \|  \|  \|/gu) ?? []).length, 3);
  assert.equal(compareInventories(shuffled, shuffled).length, 0);
  assert.deepEqual(
    compareInventories(shuffled, [...shuffled.slice(1), assetRecord("new.png", PNG)]),
    [
      { basename: "new.png", kind: "added" },
      { basename: "z.png", kind: "missing" }
    ]
  );
}

async function runFilesystemCases() {
  await withRepository("valid", DEFAULT_ASSETS, async (fixture) => {
    const sourceBefore = await assetHashes(fixture.sessionDirectory);
    const operations = [];
    const reads = [];
    const result = await prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug,
      hooks: {
        beforeOperation: (operation) => operations.push(operation),
        onRead: (read) => reads.push(read)
      }
    });
    assert.equal(result.assetCount, 3);
    assert.equal(result.scope, "repo-local-experimental");
    assert.deepEqual(result.outputs, ["inventory.json", "session.md"]);
    assert.deepEqual(await assetHashes(fixture.sessionDirectory), sourceBefore);
    assert.deepEqual(
      (await readdir(fixture.sessionDirectory)).sort(),
      ["a.png", "b.webp", "c.jpeg", "inventory.json", "session.md"]
    );
    for (const operation of operations) {
      assertAnchoredRelative(operation.path);
    }
    assert.ok(reads.length > 0);
    assert.ok(reads.every(({ length }) => length <= REFERENCE_SESSION_LIMITS.maxReadBytes));

    const beforeCheck = await treeSnapshot(fixture.sessionDirectory);
    let checkWriteObserved = false;
    const checked = await checkReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug,
      hooks: {
        beforeOperation: () => {
          checkWriteObserved = true;
        }
      }
    });
    assert.equal(checked.action, "current");
    assert.equal(checked.scope, "repo-local-experimental");
    assert.equal(checkWriteObserved, false);
    assert.deepEqual(await treeSnapshot(fixture.sessionDirectory), beforeCheck);

    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
    assert.deepEqual(await treeSnapshot(fixture.sessionDirectory), beforeCheck);
  });

  await withRepository("drift", DEFAULT_ASSETS, async (fixture) => {
    await prepareReferenceSession({ repositoryRoot: fixture.root, sessionSlug: fixture.slug });
    appendFileSync(join(fixture.sessionDirectory, "a.png"), Buffer.from([0x01]));
    await assert.rejects(
      () => checkReferenceSession({ repositoryRoot: fixture.root, sessionSlug: fixture.slug }),
      (error) => error.phase === "check" && error.basename === "a.png" && error.message === "asset changed"
    );
  });

  await withRepository("check-session-swap", DEFAULT_ASSETS, async (fixture) => {
    await prepareReferenceSession({ repositoryRoot: fixture.root, sessionSlug: fixture.slug });
    const beforeCheck = await treeSnapshot(fixture.sessionDirectory);
    const movedSession = join(fixture.root, "moved-check-session");
    const outside = join(fixture.root, "outside-check");
    mkdirSync(outside);
    let inventoryReadCount = 0;

    await assert.rejects(() => checkReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug,
      hooks: {
        onRead: ({ basename: assetName }) => {
          if (assetName !== "inventory.json") return;
          inventoryReadCount += 1;
          if (inventoryReadCount === 2) {
            renameSync(fixture.sessionDirectory, movedSession);
            symlinkSync(outside, fixture.sessionDirectory);
          }
        }
      }
    }));

    assert.equal(inventoryReadCount, 2);
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await treeSnapshot(movedSession), beforeCheck);
  });

  await withRepository("race", DEFAULT_ASSETS, async (fixture) => {
    let changed = false;
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug,
      hooks: {
        onRead: ({ basename: assetName }) => {
          if (!changed && assetName === "a.png") {
            changed = true;
            appendFileSync(join(fixture.sessionDirectory, assetName), Buffer.from([0x02]));
          }
        }
      }
    }));
    assert.equal(changed, true);
    assert.equal(await pathExists(join(fixture.sessionDirectory, "inventory.json")), false);
    assert.equal(await pathExists(join(fixture.sessionDirectory, "session.md")), false);
  });

  await withRepository("transaction", DEFAULT_ASSETS, async (fixture) => {
    const operations = [];
    let writeCount = 0;
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug,
      hooks: {
        beforeOperation: (operation) => {
          operations.push(operation);
          if (operation.operation === "write") {
            writeCount += 1;
            if (writeCount === 4) throw new Error("injected final-write failure");
          }
        }
      }
    }));
    assert.equal(writeCount, 4);
    assert.deepEqual((await readdir(fixture.sessionDirectory)).sort(), ["a.png", "b.webp", "c.jpeg"]);
    assert.ok(operations.every(({ path }) => {
      assertAnchoredRelative(path);
      return true;
    }));
  });

  await withRepository("concurrent", DEFAULT_ASSETS, async (fixture) => {
    let writeCount = 0;
    const concurrentContent = "created by concurrent operator\n";
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug,
      hooks: {
        beforeOperation: ({ operation, path }) => {
          if (operation !== "write") return;
          writeCount += 1;
          if (writeCount === 3) writeFileSync(path, concurrentContent, { flag: "wx" });
        }
      }
    }));
    assert.equal(
      await readFile(join(fixture.sessionDirectory, "inventory.json"), "utf8"),
      concurrentContent
    );
    assert.equal(await pathExists(join(fixture.sessionDirectory, "session.md")), false);
    assert.equal(
      (await readdir(fixture.sessionDirectory)).some((name) => name.startsWith(".reference-session-stage-")),
      false
    );
  });

  await withRepository("session-swap", DEFAULT_ASSETS, async (fixture) => {
    const movedSession = join(fixture.root, "moved-session");
    const outsideOne = join(fixture.root, "outside-one");
    const outsideTwo = join(fixture.root, "outside-two");
    mkdirSync(outsideOne);
    mkdirSync(outsideTwo);
    let writeCount = 0;
    let rollbackSwapObserved = false;

    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug,
      hooks: {
        beforeOperation: ({ operation }) => {
          if (operation === "write") {
            writeCount += 1;
            if (writeCount === 3) {
              renameSync(fixture.sessionDirectory, movedSession);
              symlinkSync(outsideOne, fixture.sessionDirectory);
            }
          }
          if (operation === "unlink" && !rollbackSwapObserved) {
            rollbackSwapObserved = true;
            unlinkSync(fixture.sessionDirectory);
            symlinkSync(outsideTwo, fixture.sessionDirectory);
          }
        }
      }
    }));

    assert.equal(writeCount, 4);
    assert.equal(rollbackSwapObserved, true);
    assert.deepEqual(await readdir(outsideOne), []);
    assert.deepEqual(await readdir(outsideTwo), []);
    assert.deepEqual((await readdir(movedSession)).sort(), ["a.png", "b.webp", "c.jpeg"]);
  });

  await withRepository("symlink", DEFAULT_ASSETS, async (fixture) => {
    symlinkSync("a.png", join(fixture.sessionDirectory, "linked.png"));
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
  });

  await withRepository("nested", DEFAULT_ASSETS, async (fixture) => {
    mkdirSync(join(fixture.sessionDirectory, "nested.png"));
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
  });

  await withRepository("output-symlink", DEFAULT_ASSETS, async (fixture) => {
    symlinkSync("a.png", join(fixture.sessionDirectory, "inventory.json"));
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
  });

  await withRepository("signature", [["wrong.png", JPEG]], async (fixture) => {
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
  });

  await withRepository("control", [["bad\nname.png", PNG]], async (fixture) => {
    await assert.rejects(
      () => prepareReferenceSession({ repositoryRoot: fixture.root, sessionSlug: fixture.slug }),
      (error) => !error.basename?.includes("\n")
    );
  });

  await withRepository("empty", [], async (fixture) => {
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
  });

  await withRepository(
    "count-cap",
    Array.from({ length: REFERENCE_SESSION_LIMITS.maxAssets + 1 }, (_, index) => [`${index}.png`, PNG]),
    async (fixture) => {
      await assert.rejects(() => prepareReferenceSession({
        repositoryRoot: fixture.root,
        sessionSlug: fixture.slug
      }));
    }
  );

  await withRepository("size-cap", [["huge.png", PNG]], async (fixture) => {
    const handle = await open(join(fixture.sessionDirectory, "huge.png"), "r+");
    try {
      await handle.truncate(REFERENCE_SESSION_LIMITS.maxAssetBytes + 1);
    } finally {
      await handle.close();
    }
    await assert.rejects(() => prepareReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
  });

  await withRepository("fifo", DEFAULT_ASSETS, async (fixture) => {
    const fifoPath = join(fixture.sessionDirectory, "pipe.png");
    const result = spawnSync("mkfifo", [fifoPath], { encoding: "utf8" });
    if (result.status === 0) {
      await assert.rejects(() => prepareReferenceSession({
        repositoryRoot: fixture.root,
        sessionSlug: fixture.slug
      }));
    }
  });

  await withRepository("malformed-inventory", DEFAULT_ASSETS, async (fixture) => {
    await prepareReferenceSession({ repositoryRoot: fixture.root, sessionSlug: fixture.slug });
    const path = join(fixture.sessionDirectory, "inventory.json");
    const parsed = JSON.parse(await readFile(path, "utf8"));
    parsed.assets[0].unknown = true;
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
    await assert.rejects(() => checkReferenceSession({
      repositoryRoot: fixture.root,
      sessionSlug: fixture.slug
    }));
  });
}

async function runObservedReplay(sessionSlug) {
  parseSessionSlug(sessionSlug);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const localAssetRoot = join(
    repositoryRoot,
    "datasets",
    "midjourney-reference-lab",
    "local-assets"
  );
  const source = join(
    localAssetRoot,
    sessionSlug
  );
  const names = readdirSync(source)
    .filter((name) => /\.(?:png|jpe?g|webp)$/u.test(name))
    .sort();
  assert.equal(names.length, 8, "observed replay must contain exactly eight image assets");
  const sourceBefore = Object.fromEntries(
    names.map((name) => [name, sha256Hex(readFileSync(join(source, name)))])
  );
  const replaySlug = `observed-replay-${process.pid}-${randomBytes(6).toString("hex")}`;
  const replayDirectory = join(localAssetRoot, replaySlug);
  mkdirSync(replayDirectory, { mode: 0o700 });
  let replayEvidence;
  try {
    for (const name of names) {
      copyFileSync(join(source, name), join(replayDirectory, name));
    }
    const commandPath = join(repositoryRoot, "scripts", "reference-session.mjs");
    const prepareProcess = spawnSync(process.execPath, [
      commandPath,
      "prepare",
      "--session",
      replaySlug
    ], {
      cwd: repositoryRoot,
      encoding: "utf8"
    });
    assert.equal(prepareProcess.status, 0, prepareProcess.stderr);
    const prepared = JSON.parse(prepareProcess.stdout);
    assert.equal(prepared.assetCount, 8);
    assert.equal(prepared.scope, "repo-local-experimental");
    const checkProcess = spawnSync(process.execPath, [
      commandPath,
      "check",
      "--session",
      replaySlug
    ], {
      cwd: repositoryRoot,
      encoding: "utf8"
    });
    assert.equal(checkProcess.status, 0, checkProcess.stderr);
    const checked = JSON.parse(checkProcess.stdout);
    assert.equal(checked.assetCount, 8);
    assert.equal(checked.scope, "repo-local-experimental");
    const inventory = JSON.parse(await readFile(join(replayDirectory, "inventory.json"), "utf8"));
    assert.deepEqual(
      Object.fromEntries(inventory.assets.map((asset) => [asset.basename, asset.sha256])),
      sourceBefore
    );
    replayEvidence = {
      sourceSession: sessionSlug,
      replaySession: replaySlug,
      assetCount: prepared.assetCount,
      inventorySha256: prepared.inventorySha256,
      checkInventorySha256: checked.inventorySha256,
      sourceHashes: sourceBefore
    };
  } finally {
    const suffix = relative(localAssetRoot, replayDirectory);
    const stats = await lstat(replayDirectory, { bigint: true }).catch(() => undefined);
    assert.equal(suffix, replaySlug);
    assert.equal(replaySlug.startsWith("observed-replay-"), true);
    assert.equal(stats?.isDirectory() && !stats.isSymbolicLink(), true);
    await rm(replayDirectory, { recursive: true, force: false });
  }

  const sourceAfter = Object.fromEntries(
    names.map((name) => [name, sha256Hex(readFileSync(join(source, name)))])
  );
  assert.deepEqual(sourceAfter, sourceBefore);
  assert.equal(await pathExists(replayDirectory), false);
  return {
    ...replayEvidence,
    originalSourceUnchanged: true,
    replayRemoved: true
  };
}

async function withRepository(label, assets, run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), `${TEMP_PREFIX}${label}-`)));
  const slug = "fixture-session";
  const sessionDirectory = join(
    root,
    "datasets",
    "midjourney-reference-lab",
    "local-assets",
    slug
  );
  await mkdir(sessionDirectory, { recursive: true });
  for (const [name, bytes] of assets) {
    await writeFile(join(sessionDirectory, name), bytes);
  }
  try {
    await run({ root, slug, sessionDirectory });
  } finally {
    assert.equal(basename(root).startsWith(TEMP_PREFIX), true);
    assert.equal(resolve(dirname(root)), await realpath(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
}

async function assetHashes(sessionDirectory) {
  const entries = await readdir(sessionDirectory);
  const assets = entries.filter((name) => /\.(?:png|jpe?g|webp)$/u.test(name)).sort();
  return Object.fromEntries(
    await Promise.all(assets.map(async (name) => [
      name,
      sha256Hex(await readFile(join(sessionDirectory, name)))
    ]))
  );
}

async function treeSnapshot(root) {
  const entries = await readdir(root);
  const result = [];
  for (const name of entries.sort()) {
    const path = join(root, name);
    const stats = await lstat(path, { bigint: true });
    result.push({
      name,
      mode: String(stats.mode),
      size: String(stats.size),
      mtimeNs: String(stats.mtimeNs),
      content: stats.isFile() ? sha256Hex(await readFile(path)) : null
    });
  }
  return result;
}

function assetRecord(name, bytes) {
  const mediaType = name.endsWith(".png")
    ? "image/png"
    : name.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return {
    basename: name,
    mediaType,
    bytes: bytes.length,
    sha256: sha256Hex(bytes)
  };
}

function assertAnchoredRelative(candidate) {
  const suffix = relative(".", candidate);
  assert.equal(
    !isAbsolute(candidate)
      && suffix !== ""
      && !suffix.startsWith(`..${sep}`)
      && suffix !== "..",
    true,
    `operation is not anchored to the session working directory: ${candidate}`
  );
}

async function pathExists(path) {
  return stat(path).then(() => true, () => false);
}

function parseObservedArgument(args) {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== "--observed-session") {
    throw new Error("Usage: node scripts/reference-session-regressions.mjs [--observed-session <slug>]");
  }
  return args[1];
}
