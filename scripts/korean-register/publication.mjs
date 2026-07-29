import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  REAL_RUN_COUNT,
  aggregatePath,
  canonicalJson
} from "./contract.mjs";

export async function publishCalibrationOutput(
  root,
  files,
  { beforeReserve } = {}
) {
  const parent = dirname(root);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (realParent !== resolve(parent)) {
    throw new Error("output parent must not traverse a symlink");
  }
  const stage = await mkdtemp(
    join(realParent, `.${basename(root)}-stage-`)
  );
  let reservation;
  try {
    await writeStage(stage, files);
    await beforeReserve?.(root);
    await mkdir(root, { mode: 0o700 });
    reservation = await lstat(root);
    if (!reservation.isDirectory() || reservation.isSymbolicLink()) {
      throw new Error("output reservation must be a real directory");
    }
    await rename(stage, root);
    reservation = undefined;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    if (reservation) {
      await removeOwnedEmptyReservation(root, reservation);
    }
    throw error;
  }
}

async function writeStage(stage, files) {
  for (let run = 1; run <= REAL_RUN_COUNT; run += 1) {
    await writeFile(
      aggregatePath(stage, run),
      files.aggregateBytes,
      { flag: "wx" }
    );
  }
  await writeFile(
    join(stage, "repeatability.json"),
    canonicalJson(files.repeatability),
    { flag: "wx" }
  );
  await writeFile(
    join(stage, "status.json"),
    canonicalJson(files.status),
    { flag: "wx" }
  );
  await writeFile(join(stage, "README.md"), files.readme, {
    flag: "wx"
  });
}

async function removeOwnedEmptyReservation(root, expected) {
  try {
    const current = await lstat(root);
    if (
      current.isDirectory()
      && !current.isSymbolicLink()
      && current.dev === expected.dev
      && current.ino === expected.ino
    ) {
      await rmdir(root);
    }
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) {
      throw error;
    }
  }
}
