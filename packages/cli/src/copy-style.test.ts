import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyStyleLoadError, copyStyleOpenFlags, loadCopyStyleFile } from "./copy-style.js";

const tempDirs: string[] = [];
const minimalYaml = "schemaVersion: '0.2'\nlocale: ko\n";

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("loadCopyStyleFile", () => {
  it("loads minimal and full YAML relative to an injected cwd", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "minimal.yaml"), minimalYaml);
    await writeFile(join(cwd, "full.yaml"), [
      "schemaVersion: '0.2'",
      "locale: ko-KR",
      "josaHedgePolicy: flag",
      "surfaceRegisters:",
      "  button: noun-form",
      "surfaceMapping:",
      "  - surface: button",
      "    matchers:",
      "      - kind: role",
      "        value: button",
      "glossary:",
      "  - term: 결제",
      "    tier: approved",
      "bannedPhrases:",
      "  - phrase: TODO",
      ""
    ].join("\n"));

    await expect(loadCopyStyleFile("minimal.yaml", { cwd })).resolves.toEqual({ schemaVersion: "0.2", locale: "ko" });
    await expect(loadCopyStyleFile("full.yaml", { cwd })).resolves.toMatchObject({
      locale: "ko-KR",
      glossary: [{ term: "결제", tier: "approved" }]
    });
  });

  it("accepts JSON syntax as a YAML subset", async () => {
    const path = await fixture("style.json", Buffer.from('{"schemaVersion":"0.2","locale":"ko"}'));
    await expect(loadCopyStyleFile(path)).resolves.toEqual({ schemaVersion: "0.2", locale: "ko" });
  });

  it("locks the production non-blocking flag where the runtime exposes it", () => {
    const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
    expect(copyStyleOpenFlags()).toBe(constants.O_RDONLY | nonBlocking);
  });

  it("rejects a production-path directory as non-regular", async () => {
    const path = await tempDir();
    await expect(loadCopyStyleFile(path)).rejects.toSatisfy((error: unknown) => {
      return error instanceof CopyStyleLoadError
        && error.stage === "read"
        && error.message.includes("not a regular file");
    });
  });

  it.skipIf(process.platform === "win32")("rejects a production-path FIFO without blocking", async () => {
    const dir = await tempDir();
    const path = join(dir, "copy-style.pipe");
    execFileSync("mkfifo", [path]);
    await expect(loadCopyStyleFile(path)).rejects.toSatisfy((error: unknown) => {
      return error instanceof CopyStyleLoadError
        && error.stage === "read"
        && error.message.includes("not a regular file");
    });
  });

  it("uses one handle for bounded reads and closes it on success", async () => {
    const calls: string[] = [];
    const read = readFromBuffer(Buffer.from(minimalYaml), calls);
    const handle = {
      stat: vi.fn(async () => {
        calls.push("stat");
        return regularFileStats(Buffer.byteLength(minimalYaml));
      }),
      read,
      close: vi.fn(async () => {
        calls.push("close");
      })
    };
    const openFile = vi.fn(async () => handle);

    await loadCopyStyleFile("style.yaml", { cwd: "/project", openFile });

    expect(openFile).toHaveBeenCalledOnce();
    expect(calls[0]).toBe("stat");
    expect(calls.at(-1)).toBe("close");
    expect(read).toHaveBeenCalled();
  });

  it("rejects non-regular files before reading and still closes the handle", async () => {
    const read = vi.fn(async () => ({ bytesRead: 0 }));
    const close = vi.fn(async () => undefined);
    await expect(loadCopyStyleFile("pipe.yaml", {
      openFile: async () => ({
        stat: async () => ({ size: 0, isFile: () => false }),
        read,
        close
      })
    })).rejects.toSatisfy((error: unknown) => {
      return error instanceof CopyStyleLoadError
        && error.stage === "read"
        && error.message.includes("not a regular file");
    });

    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the handle when stat fails", async () => {
    const close = vi.fn(async () => undefined);
    await expect(loadCopyStyleFile("style.yaml", {
      openFile: async () => ({
        stat: async () => {
          throw new Error("stat failed");
        },
        read: async () => ({ bytesRead: 0 }),
        close
      })
    })).rejects.toMatchObject({ stage: "read" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the handle when a bounded read fails", async () => {
    const close = vi.fn(async () => undefined);
    await expect(loadCopyStyleFile("style.yaml", {
      openFile: async () => ({
        stat: async () => regularFileStats(Buffer.byteLength(minimalYaml)),
        read: async () => {
          throw new Error("read failed");
        },
        close
      })
    })).rejects.toSatisfy((error: unknown) => {
      return error instanceof CopyStyleLoadError
        && error.stage === "read"
        && error.message.includes("read failed");
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves the primary stat error when close also fails", async () => {
    await expect(loadCopyStyleFile("style.yaml", {
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
      return error instanceof CopyStyleLoadError
        && error.stage === "read"
        && error.message.includes("primary stat failure")
        && !error.message.includes("secondary close failure");
    });
  });

  it("reports missing files at the read stage with a resolved path", async () => {
    const cwd = await tempDir();
    await expect(loadCopyStyleFile("missing.yaml", { cwd })).rejects.toSatisfy((error: unknown) => {
      return error instanceof CopyStyleLoadError
        && error.stage === "read"
        && error.message.includes(join(cwd, "missing.yaml"));
    });
  });

  it("admits exactly 1 MiB to decode and rejects larger input before decode", async () => {
    const exact = await fixture("exact.yaml", Buffer.alloc(1024 * 1024, 0x20));
    const over = await fixture("over.yaml", Buffer.alloc(1024 * 1024 + 1, 0xff));
    await expect(loadCopyStyleFile(exact)).rejects.toMatchObject({ stage: "schema" });
    await expect(loadCopyStyleFile(over)).rejects.toMatchObject({ stage: "size" });
  });

  it("bounds the same-handle read when the file grows after stat", async () => {
    const read = readFromBuffer(Buffer.alloc(1024 * 1024 + 1, 0x20));
    await expect(loadCopyStyleFile("growing.yaml", {
      openFile: async () => ({
        stat: async () => regularFileStats(Buffer.byteLength(minimalYaml)),
        read,
        close: async () => undefined
      })
    })).rejects.toMatchObject({ stage: "size" });

    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[2]).toBe(1024 * 1024 + 1);
  });

  it("rejects malformed UTF-8 before YAML parsing", async () => {
    const path = await fixture("invalid-utf8.yaml", Buffer.from([0xc3, 0x28]));
    await expect(loadCopyStyleFile(path)).rejects.toMatchObject({ stage: "decode" });
  });

  it.each([
    ["syntax", "schemaVersion: '0.2'\n locale: ko\n"],
    ["duplicate-key", "schemaVersion: '0.2'\nlocale: ko\nlocale: en\n"],
    ["multiple-documents", "schemaVersion: '0.2'\nlocale: ko\n---\nschemaVersion: '0.2'\nlocale: en\n"],
    ["custom-tag-warning", "schemaVersion: '0.2'\nlocale: !custom ko\n"]
  ])("rejects %s at the parse stage", async (name, source) => {
    const path = await fixture(`${name}.yaml`, Buffer.from(source));
    await expect(loadCopyStyleFile(path)).rejects.toMatchObject({ stage: "parse" });
  });

  it.each([
    ["yaml-1.1-directive", "%YAML 1.1\n---\nschemaVersion: '0.2'\nlocale: ko\n"],
    ["yaml-1.2-directive", "%YAML 1.2\n---\nschemaVersion: '0.2'\nlocale: ko\n"],
    ["tag-directive", "%TAG !e! tag:example.com,2020:\n---\nschemaVersion: '0.2'\nlocale: ko\n"],
    ["anchor", "schemaVersion: '0.2'\nlocale: &locale ko\n"],
    ["alias", "schemaVersion: '0.2'\nlocale: *locale\n"],
    ["known-explicit-tag", "schemaVersion: '0.2'\nlocale: !!str ko\n"],
    ["merge-key", "schemaVersion: '0.2'\nlocale: ko\n<<: {}\n"]
  ])("rejects %s at the parse-policy stage", async (name, source) => {
    const path = await fixture(`${name}.yaml`, Buffer.from(source));
    await expect(loadCopyStyleFile(path)).rejects.toMatchObject({ stage: "parse-policy" });
  });

  it.each([
    ["scalar", "hello\n"],
    ["sequence", "- hello\n"],
    ["null", "null\n"],
    ["wrong-version", "schemaVersion: '9.9'\nlocale: ko\n"],
    ["invalid-locale", "schemaVersion: '0.2'\nlocale: KO_kr\n"],
    ["unknown-field", "schemaVersion: '0.2'\nlocale: ko\nunknown: true\n"],
    ["invalid-nested", "schemaVersion: '0.2'\nlocale: ko\nglossary:\n  - term: 결제\n    tier: preferred\n"]
  ])("rejects %s at the schema stage", async (name, source) => {
    const path = await fixture(`${name}.yaml`, Buffer.from(source));
    await expect(loadCopyStyleFile(path)).rejects.toMatchObject({ stage: "schema" });
  });

  it("rejects a prototype-named own field at the schema stage", async () => {
    const path = await fixture("prototype.yaml", Buffer.from("schemaVersion: '0.2'\nlocale: ko\nconstructor: unexpected\n"));
    await expect(loadCopyStyleFile(path)).rejects.toSatisfy((error: unknown) => {
      return error instanceof CopyStyleLoadError
        && error.stage === "schema"
        && error.message.includes("$.constructor");
    });
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-harness-copy-style-"));
  tempDirs.push(dir);
  return dir;
}

async function fixture(name: string, contents: Buffer): Promise<string> {
  const dir = await tempDir();
  const path = join(dir, basename(name));
  await writeFile(path, contents);
  return path;
}

function readFromBuffer(contents: Buffer, calls?: string[]) {
  let position = 0;
  return vi.fn(async (target: Buffer, offset: number, length: number) => {
    calls?.push("read");
    const bytesRead = Math.min(length, contents.byteLength - position);
    if (bytesRead > 0) {
      contents.copy(target, offset, position, position + bytesRead);
      position += bytesRead;
    }
    return { bytesRead };
  });
}

function regularFileStats(size: number) {
  return { size, isFile: () => true };
}
