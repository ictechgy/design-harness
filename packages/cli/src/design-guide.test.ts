import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignGuideLoadError, loadDesignGuideFile } from "./design-guide.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("loadDesignGuideFile", () => {
  it("loads a schema-valid guide in the supported profile", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "design-guide.yaml"), validGuideYaml());
    await expect(loadDesignGuideFile("design-guide.yaml", { cwd })).resolves.toMatchObject({
      schemaVersion: "0.2",
      prohibitions: ["generic-card-grid"],
      signatureElement: "Use one compact status rail."
    });
  });

  it("reports closed-envelope failures at the schema stage", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "design-guide.yaml"), `${validGuideYaml()}unknown: true\n`);
    await expect(loadDesignGuideFile("design-guide.yaml", { cwd })).rejects.toSatisfy((error: unknown) => {
      return error instanceof DesignGuideLoadError
        && error.stage === "schema"
        && error.resolvedPath === join(cwd, "design-guide.yaml")
        && error.message.includes("$.unknown");
    });
  });

  it("reports supported-profile failures after schema validation", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "design-guide.yaml"), [
      "schemaVersion: '0.2'",
      "tokens:",
      "  color: {}",
      "  font: {}",
      "  spacing: {}",
      "  radius: {}",
      "prohibitions: [generic-card-grid]",
      "signatureElement: Use one compact status rail.",
      ""
    ].join("\n"));
    await expect(loadDesignGuideFile("design-guide.yaml", { cwd })).rejects.toMatchObject({ stage: "profile" });
  });

  it("maps strict YAML policy failures without losing their phase", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "design-guide.yaml"), "schemaVersion: &version '0.2'\ncopy: *version\n");
    await expect(loadDesignGuideFile("design-guide.yaml", { cwd })).rejects.toMatchObject({
      stage: "parse-policy",
      resolvedPath: join(cwd, "design-guide.yaml")
    });
  });

  it("rejects a production-path directory as non-regular", async () => {
    const path = await tempDir();
    await expect(loadDesignGuideFile(path)).rejects.toSatisfy((error: unknown) => {
      return error instanceof DesignGuideLoadError
        && error.stage === "read"
        && error.message.includes("not a regular file");
    });
  });

  it.skipIf(process.platform === "win32")("rejects a production-path FIFO without blocking", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "design-guide.pipe");
    execFileSync("mkfifo", [path]);
    await expect(loadDesignGuideFile(path)).rejects.toSatisfy((error: unknown) => {
      return error instanceof DesignGuideLoadError
        && error.stage === "read"
        && error.message.includes("not a regular file");
    });
  });

  it("bounds the same-handle read if the guide grows after stat", async () => {
    const source = Buffer.alloc(1024 * 1024 + 1, 0x20);
    const read = readFromBuffer(source);
    const close = vi.fn(async () => undefined);
    await expect(loadDesignGuideFile("growing.yaml", {
      openFile: async () => ({
        stat: async () => regularFileStats(10),
        read,
        close
      })
    })).rejects.toMatchObject({ stage: "size" });
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[2]).toBe(1024 * 1024 + 1);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed UTF-8 before YAML parsing", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "design-guide.yaml"), Buffer.from([0xc3, 0x28]));
    await expect(loadDesignGuideFile("design-guide.yaml", { cwd })).rejects.toMatchObject({ stage: "decode" });
  });

  it.each([
    ["syntax", "schemaVersion: '0.2'\n tokens: {}\n"],
    ["duplicate-key", "schemaVersion: '0.2'\nschemaVersion: '0.2'\n"],
    ["multiple-documents", "schemaVersion: '0.2'\n---\nschemaVersion: '0.2'\n"],
    ["custom-tag-warning", "schemaVersion: !custom '0.2'\n"]
  ])("rejects %s at the parse stage", async (name, source) => {
    const cwd = await tempDir();
    await writeFile(join(cwd, `${name}.yaml`), source);
    await expect(loadDesignGuideFile(`${name}.yaml`, { cwd })).rejects.toMatchObject({ stage: "parse" });
  });

  it.each([
    ["yaml-directive", "%YAML 1.2\n---\nschemaVersion: '0.2'\n"],
    ["tag-directive", "%TAG !e! tag:example.com,2020:\n---\nschemaVersion: '0.2'\n"],
    ["anchor", "schemaVersion: &version '0.2'\n"],
    ["alias", "schemaVersion: *version\n"],
    ["explicit-tag", "schemaVersion: !!str '0.2'\n"],
    ["merge-key", "schemaVersion: '0.2'\n<<: {}\n"]
  ])("rejects %s at the parse-policy stage", async (name, source) => {
    const cwd = await tempDir();
    await writeFile(join(cwd, `${name}.yaml`), source);
    await expect(loadDesignGuideFile(`${name}.yaml`, { cwd })).rejects.toMatchObject({ stage: "parse-policy" });
  });

  it("rejects prototype-named input at the schema stage", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "design-guide.yaml"), `${validGuideYaml()}constructor: unexpected\n`);
    await expect(loadDesignGuideFile("design-guide.yaml", { cwd })).rejects.toSatisfy((error: unknown) => {
      return error instanceof DesignGuideLoadError
        && error.stage === "schema"
        && error.message.includes("$.constructor");
    });
  });

  it.each([
    ["success", Buffer.from(validGuideYaml()), undefined],
    ["stat", Buffer.from(validGuideYaml()), "stat"],
    ["read", Buffer.from(validGuideYaml()), "read"],
    ["parse", Buffer.from("schemaVersion: [\n"), undefined],
    ["schema", Buffer.from("schemaVersion: '0.2'\nunknown: true\n"), undefined]
  ] as const)("closes exactly once after %s", async (_name, source, failure) => {
    const close = vi.fn(async () => undefined);
    const read = readFromBuffer(source);
    const load = loadDesignGuideFile("design-guide.yaml", {
      openFile: async () => ({
        stat: async () => {
          if (failure === "stat") {
            throw new Error("stat failed");
          }
          return regularFileStats(source.byteLength);
        },
        read: async (buffer, offset, length, _position) => {
          if (failure === "read") {
            throw new Error("read failed");
          }
          return read(buffer, offset, length);
        },
        close
      })
    });
    if (_name === "success") {
      await expect(load).resolves.toMatchObject({ schemaVersion: "0.2" });
    } else {
      await expect(load).rejects.toBeInstanceOf(DesignGuideLoadError);
    }
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports a close-only failure at the read stage", async () => {
    const source = Buffer.from(validGuideYaml());
    await expect(loadDesignGuideFile("design-guide.yaml", {
      openFile: async () => ({
        stat: async () => regularFileStats(source.byteLength),
        read: readFromBuffer(source),
        close: async () => {
          throw new Error("close failed");
        }
      })
    })).rejects.toSatisfy((error: unknown) => {
      return error instanceof DesignGuideLoadError
        && error.stage === "read"
        && error.detail.includes("close failed");
    });
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-harness-design-guide-"));
  tempDirs.push(dir);
  return dir;
}

function validGuideYaml(): string {
  return [
    "schemaVersion: '0.2'",
    "tokens:",
    "  color:",
    "    semantic:",
    "      $type: color",
    "      background:",
    "        $value: { colorSpace: srgb, components: [0.98, 0.98, 0.97], alpha: 1 }",
    "      surface:",
    "        $value: { colorSpace: srgb, components: [1, 1, 1], alpha: 1 }",
    "      text:",
    "        $value: { colorSpace: srgb, components: [0.08, 0.09, 0.11], alpha: 1 }",
    "      accent:",
    "        $value: { colorSpace: srgb, components: [0.12, 0.38, 0.82], alpha: 1 }",
    "  font:",
    "    family:",
    "      $type: fontFamily",
    "      heading: { $value: [Inter, sans-serif] }",
    "      body: { $value: [Inter, sans-serif] }",
    "  spacing:",
    "    $type: dimension",
    "    none: { $value: { value: 0, unit: px } }",
    "    md: { $value: { value: 1, unit: rem } }",
    "  radius:",
    "    $type: dimension",
    "    none: { $value: { value: 0, unit: px } }",
    "    md: { $value: { value: 8, unit: px } }",
    "prohibitions: [generic-card-grid]",
    "signatureElement: Use one compact status rail.",
    ""
  ].join("\n");
}

function readFromBuffer(contents: Buffer) {
  let position = 0;
  return vi.fn(async (target: Buffer, offset: number, length: number) => {
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
