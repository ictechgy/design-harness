import { constants } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StrictYamlLoadError,
  loadStrictYamlFile,
  strictYamlOpenFlags,
  type StrictYamlFileHandle
} from "./strict-yaml.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("loadStrictYamlFile", () => {
  it("reads and closes one injected handle before returning the parsed value", async () => {
    const calls: string[] = [];
    const source = Buffer.from("schemaVersion: '0.2'\nlocale: ko\n");
    const handle = bufferedHandle(source, calls);

    await expect(loadStrictYamlFile("config.yaml", {
      cwd: "/project",
      openFile: async () => handle
    })).resolves.toEqual({
      resolvedPath: "/project/config.yaml",
      value: { schemaVersion: "0.2", locale: "ko" }
    });
    expect(calls[0]).toBe("stat");
    expect(calls.at(-1)).toBe("close");
  });

  it("rejects YAML representation features at the parse-policy stage", async () => {
    const source = Buffer.from("value: &shared hello\ncopy: *shared\n");
    await expect(loadStrictYamlFile("config.yaml", {
      openFile: async () => bufferedHandle(source)
    })).rejects.toMatchObject({ stage: "parse-policy" });
  });

  it("bounds a same-handle read even when the file grows after stat", async () => {
    const source = Buffer.from("abcd");
    const handle = bufferedHandle(source, undefined, 1);
    await expect(loadStrictYamlFile("config.yaml", {
      maxBytes: 3,
      openFile: async () => handle
    })).rejects.toMatchObject({ stage: "size" });
    expect(handle.read).toHaveBeenCalledOnce();
    expect(handle.read.mock.calls[0]?.[2]).toBe(4);
  });

  it("binds guide reads to the identity captured during containment", async () => {
    const source = Buffer.from("value: safe\n");
    const expectedIdentity = identity(1);
    const replaced = bufferedHandle(source, undefined, source.byteLength, identity(2));
    await expect(loadStrictYamlFile("config.yaml", {
      expectedIdentity,
      openFile: async () => replaced
    })).rejects.toMatchObject({
      stage: "read",
      detail: "file identity changed since containment"
    });
    expect(replaced.read).not.toHaveBeenCalled();
  });

  it("rejects an in-place identity change during a contained read", async () => {
    const source = Buffer.from("value: safe\n");
    const expectedIdentity = identity(1);
    const handle = bufferedHandle(source, undefined, source.byteLength, expectedIdentity);
    handle.stat
      .mockResolvedValueOnce({ ...expectedIdentity, isFile: () => true })
      .mockResolvedValueOnce({ ...expectedIdentity, ctimeMs: 2, isFile: () => true });

    await expect(loadStrictYamlFile("config.yaml", {
      expectedIdentity,
      openFile: async () => handle
    })).rejects.toMatchObject({
      stage: "read",
      detail: "file identity changed while reading"
    });
  });

  it("preserves a primary read failure when close also fails", async () => {
    await expect(loadStrictYamlFile("config.yaml", {
      openFile: async () => ({
        stat: async () => {
          throw new Error("primary stat failure");
        },
        read: async () => ({ bytesRead: 0 }),
        close: async () => {
          throw new Error("secondary close failure");
        }
      })
    })).rejects.toSatisfy((error: unknown) => {
      return error instanceof StrictYamlLoadError
        && error.stage === "read"
        && error.detail.includes("primary stat failure")
        && !error.detail.includes("secondary close failure");
    });
  });

  it("reports a close failure when no earlier error occurred", async () => {
    const source = Buffer.from("value: ok\n");
    const handle = bufferedHandle(source);
    handle.close.mockRejectedValueOnce(new Error("close failed"));
    await expect(loadStrictYamlFile("config.yaml", {
      openFile: async () => handle
    })).rejects.toSatisfy((error: unknown) => {
      return error instanceof StrictYamlLoadError
        && error.stage === "read"
        && error.detail.includes("failed to close file: close failed");
    });
  });

  it.skipIf(process.platform === "win32")("rejects a symlink at the file-open boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-harness-strict-yaml-"));
    tempRoots.push(root);
    const sourcePath = join(root, "source.yaml");
    const linkPath = join(root, "config.yaml");
    await writeFile(sourcePath, "value: safe\n", "utf8");
    await symlink(sourcePath, linkPath);

    await expect(loadStrictYamlFile(linkPath)).rejects.toMatchObject({ stage: "read" });
    if (typeof constants.O_NOFOLLOW === "number") {
      expect(strictYamlOpenFlags() & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    }
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked parent when a real path is required", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-harness-strict-yaml-parent-"));
    tempRoots.push(root);
    const realParent = join(root, "real");
    const linkedParent = join(root, "linked");
    await mkdir(realParent);
    await writeFile(join(realParent, "config.yaml"), "value: safe\n", "utf8");
    await symlink(realParent, linkedParent);

    await expect(loadStrictYamlFile(join(linkedParent, "config.yaml"), { requireRealPath: true }))
      .rejects.toMatchObject({ stage: "read" });
  });
});

function bufferedHandle(
  source: Buffer,
  calls?: string[],
  reportedSize = source.byteLength,
  fileIdentity?: ReturnType<typeof identity>
) {
  let position = 0;
  const handle = {
    stat: vi.fn(async () => {
      calls?.push("stat");
      return { ...fileIdentity, size: reportedSize, isFile: () => true };
    }),
    read: vi.fn(async (target: Buffer, offset: number, length: number) => {
      calls?.push("read");
      const bytesRead = Math.min(length, source.byteLength - position);
      if (bytesRead > 0) {
        source.copy(target, offset, position, position + bytesRead);
        position += bytesRead;
      }
      return { bytesRead };
    }),
    close: vi.fn(async () => {
      calls?.push("close");
    })
  } satisfies StrictYamlFileHandle;
  return handle;
}

function identity(ino: number) {
  return { dev: 1, ino, size: 12, mode: 0o100644, mtimeMs: 1, ctimeMs: 1 };
}
