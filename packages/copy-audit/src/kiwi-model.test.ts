import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  KIWI_MODEL_CONTRACT,
  KiwiModelVerificationError,
  reverifyPreparedKiwiModelProfile,
  verifyKiwiModelDirectory,
  type KiwiModelContract
} from "./kiwi-model.js";

const roots: string[] = [];
const CONTENT = new TextEncoder().encode("model");
const CONTRACT: KiwiModelContract = Object.freeze({
  version: "test",
  modelType: "cong",
  files: Object.freeze([Object.freeze({
    name: "model.bin",
    bytes: CONTENT.byteLength,
    sha256: createHash("sha256").update(CONTENT).digest("hex")
  })])
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

describe("verifyKiwiModelDirectory", () => {
  it("locks the exact Kiwi 0.23.0 five-file profile", () => {
    expect(KIWI_MODEL_CONTRACT).toEqual({
      version: "0.23.0",
      modelType: "cong",
      files: [
        {
          name: "combiningRule.txt",
          bytes: 3_584,
          sha256: "3d864f76eade67b250d37f4ee83de848b04fb14d0cd6ed36c36d0b210ad38ebc"
        },
        {
          name: "cong.mdl",
          bytes: 75_667_563,
          sha256: "bd9ca89ee1b72e750c8e2166a17c80a0fe3fabd828c78b1f0928486a6b1833a7"
        },
        {
          name: "extract.mdl",
          bytes: 17_370,
          sha256: "a0c92ffc051e43ae497845cdb8d4c8b9e2f359893cb55c67279c76d1d531ee17"
        },
        {
          name: "nounchr.mdl",
          bytes: 9_734_234,
          sha256: "4b687e36836dd60dcb7addcfcf369ac082b339bab76549574ac1ce2b7ccd6836"
        },
        {
          name: "sj.morph",
          bytes: 8_462_892,
          sha256: "5e3dab2def6d2cc079e21d5477bd610a391c69045d08caf1e0bbeabda8db8d1b"
        }
      ]
    });
    expect(KIWI_MODEL_CONTRACT.files.reduce((sum, file) => sum + file.bytes, 0))
      .toBe(93_885_643);
  });

  it("returns only canonical immutable profile metadata", async () => {
    const root = await fixtureDirectory();
    const profile = await verifyKiwiModelDirectory(root, { contract: CONTRACT });
    expect(profile).toMatchObject({
      rootDir: await realpath(root),
      version: "test",
      modelType: "cong",
      totalBytes: CONTENT.byteLength,
      files: [{ name: "model.bin", bytes: CONTENT.byteLength }]
    });
    expect(profile.profileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.files)).toBe(true);
  });

  it.each([
    {
      label: "missing file",
      mutate: async (root: string) => {
        const { rm } = await import("node:fs/promises");
        await rm(join(root, "model.bin"));
      },
      code: "model-profile-entries-mismatch"
    },
    {
      label: "extra file",
      mutate: async (root: string) => writeFile(join(root, "extra.bin"), "extra"),
      code: "model-profile-entries-mismatch"
    },
    {
      label: "wrong size",
      mutate: async (root: string) => writeFile(join(root, "model.bin"), "oversized"),
      code: "model-file-size-mismatch"
    },
    {
      label: "wrong digest",
      mutate: async (root: string) => writeFile(join(root, "model.bin"), "other"),
      code: "model-file-digest-mismatch"
    },
    {
      label: "directory in place of a file",
      mutate: async (root: string) => {
        const { rm } = await import("node:fs/promises");
        await rm(join(root, "model.bin"));
        await mkdir(join(root, "model.bin"));
      },
      code: "model-file-not-regular"
    }
  ])("rejects $label", async ({ mutate, code }) => {
    const root = await fixtureDirectory();
    await mutate(root);
    await expect(verifyKiwiModelDirectory(root, { contract: CONTRACT }))
      .rejects.toMatchObject({ code });
  });

  it("rejects symlinks even when the target stays inside the directory", async () => {
    const root = await fixtureDirectory();
    await writeFile(join(root, "target.bin"), CONTENT);
    const { rm } = await import("node:fs/promises");
    await rm(join(root, "model.bin"));
    await symlink(join(root, "target.bin"), join(root, "model.bin"));
    const symlinkContract: KiwiModelContract = {
      ...CONTRACT,
      files: [
        CONTRACT.files[0] as NonNullable<(typeof CONTRACT.files)[number]>,
        {
          name: "target.bin",
          bytes: CONTENT.byteLength,
          sha256: CONTRACT.files[0]?.sha256 as string
        }
      ]
    };
    await expect(verifyKiwiModelDirectory(root, { contract: symlinkContract }))
      .rejects.toMatchObject({ code: "model-file-not-regular" });
  });

  it("rejects a Unix-domain socket as a non-regular model file", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await fixtureDirectory();
    const { rm } = await import("node:fs/promises");
    await rm(join(root, "model.bin"));
    const { createServer } = await import("node:net");
    const server = createServer();
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(join(root, "model.bin"), resolveListen);
    });
    try {
      await expect(verifyKiwiModelDirectory(root, { contract: CONTRACT }))
        .rejects.toMatchObject({ code: "model-file-not-regular" });
    } finally {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose());
      });
    }
  });

  it("fails closed when a prepared profile changes before use", async () => {
    const root = await fixtureDirectory();
    const profile = await verifyKiwiModelDirectory(root, { contract: CONTRACT });
    await writeFile(join(root, "model.bin"), "other");
    await expect(reverifyPreparedKiwiModelProfile(profile, CONTRACT))
      .rejects.toBeInstanceOf(KiwiModelVerificationError);
  });
});

async function fixtureDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "design-harness-kiwi-model-"));
  roots.push(root);
  await writeFile(join(root, "model.bin"), CONTENT);
  return root;
}
