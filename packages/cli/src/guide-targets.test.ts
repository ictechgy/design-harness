import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESIGN_GUIDE_PROFILE_ID, GUIDE_CATALOG_VERSION } from "@design-harness/core";
import { GuideOperationError } from "./guide-errors.js";
import {
  GUIDE_MARKER_BEGIN,
  GUIDE_MARKER_END,
  MAX_GUIDE_TARGET_BYTES,
  checkGuideTargets,
  defaultGuideFileSystem,
  planGuideTargets,
  readGuideTargetSnapshot,
  recheckGuideTargetPlans,
  recheckResolvedGuideInputs,
  resolveGuidePaths,
  type GuideFileStat
} from "./guide-targets.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("resolveGuidePaths", () => {
  it("resolves only explicit real config paths inside a relative target", async () => {
    const fixture = await targetFixture();
    const paths = await resolveGuidePaths({
      cwd: fixture.cwd,
      targetDir: "project",
      guidePath: "project/design-guide.yaml"
    });

    expect(paths.targetDir).toBe(fixture.target);
    expect(paths.guidePath).toBe(join(fixture.target, "design-guide.yaml"));
    expect(paths.outputs["AGENTS.md"]).toBe(join(fixture.target, "AGENTS.md"));
  });

  it("rejects outside-target config and absolute target paths with a stable safe diagnostic", async () => {
    const fixture = await targetFixture();
    await writeFile(join(fixture.cwd, "secret.yaml"), "do-not-echo-this: true\n");

    await expect(resolveGuidePaths({
      cwd: fixture.cwd,
      targetDir: "project",
      guidePath: "secret.yaml"
    })).rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
      && error.phase === "containment"
      && error.message.includes("inside --target")
      && !error.message.includes("do-not-echo-this"));

    await expect(resolveGuidePaths({
      cwd: fixture.cwd,
      targetDir: fixture.target,
      guidePath: "project/design-guide.yaml"
    })).rejects.toMatchObject({ phase: "containment" });
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked config component", async () => {
    const fixture = await targetFixture();
    await symlink(join(fixture.target, "design-guide.yaml"), join(fixture.target, "linked-guide.yaml"));

    await expect(resolveGuidePaths({
      cwd: fixture.cwd,
      targetDir: "project",
      guidePath: "project/linked-guide.yaml"
    })).rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
      && error.phase === "containment"
      && error.message.includes("symlink"));
  });
});

describe("planGuideTargets", () => {
  it("replaces only owned spans and leaves a standalone Claude import byte-identical", async () => {
    const fixture = await targetFixture();
    const agents = `prefix\r\n${GUIDE_MARKER_BEGIN}\nold\n${GUIDE_MARKER_END}\nsuffix\r\n`;
    const design = "human notes without a final newline";
    const claude = "# Claude notes\n@AGENTS.md\nkeep me\n";
    await writeFile(join(fixture.target, "AGENTS.md"), agents);
    await writeFile(join(fixture.target, "DESIGN.md"), design);
    await writeFile(join(fixture.target, "CLAUDE.md"), claude);
    await writeFile(join(fixture.target, "design.tokens.json"), tokenJson("b"));
    const paths = await resolvedFixture(fixture);

    const plans = await planGuideTargets({ paths, markdown: "# Generated\nRule", designTokensJson: tokenJson("a") });
    const agentsPlan = plans.find((plan) => plan.name === "AGENTS.md")!;
    const designPlan = plans.find((plan) => plan.name === "DESIGN.md")!;
    const claudePlan = plans.find((plan) => plan.name === "CLAUDE.md")!;

    expect(agentsPlan.nextContent.toString()).toBe(`prefix\r\n${GUIDE_MARKER_BEGIN}\n# Generated\nRule\n${GUIDE_MARKER_END}\nsuffix\r\n`);
    expect(designPlan.nextContent.subarray(0, Buffer.byteLength(design)).toString()).toBe(design);
    expect(claudePlan.status).toBe("unchanged");
    expect(claudePlan.nextContent.toString()).toBe(claude);
  });

  it("does not count a fenced import example and rejects duplicate standalone imports", async () => {
    const fixture = await targetFixture();
    const paths = await resolvedFixture(fixture);
    await writeFile(join(fixture.target, "CLAUDE.md"), "```md\n@AGENTS.md\n```\n");
    let plans = await planGuideTargets({ paths, markdown: "rule", designTokensJson: tokenJson("a") });
    expect(plans.find((plan) => plan.name === "CLAUDE.md")!.nextContent.toString()).toContain(
      `${GUIDE_MARKER_BEGIN}\n@AGENTS.md\n${GUIDE_MARKER_END}`
    );

    await writeFile(join(fixture.target, "CLAUDE.md"), "@AGENTS.md\n@AGENTS.md\n");
    await expect(planGuideTargets({ paths, markdown: "rule", designTokensJson: tokenJson("a") }))
      .rejects.toMatchObject({ phase: "ownership", path: "CLAUDE.md" });
  });

  it("fails closed on malformed markers and foreign token ownership", async () => {
    const fixture = await targetFixture();
    const paths = await resolvedFixture(fixture);
    await writeFile(join(fixture.target, "AGENTS.md"), `${GUIDE_MARKER_BEGIN}\norphan\n`);
    await expect(planGuideTargets({ paths, markdown: "rule", designTokensJson: tokenJson("a") }))
      .rejects.toMatchObject({ phase: "marker", path: "AGENTS.md" });

    await writeFile(join(fixture.target, "AGENTS.md"), "notes\n");
    await writeFile(join(fixture.target, "design.tokens.json"), '{"tokens":"foreign"}\n');
    await expect(planGuideTargets({ paths, markdown: "rule", designTokensJson: tokenJson("a") }))
      .rejects.toMatchObject({ phase: "ownership", path: "design.tokens.json" });
  });

  it("classifies current, stale, and missing artifacts without a write dependency", async () => {
    const fixture = await targetFixture();
    const paths = await resolvedFixture(fixture);
    const plans = await planGuideTargets({ paths, markdown: "rule", designTokensJson: tokenJson("a") });
    plans[0] = { ...plans[0], status: "unchanged", snapshot: { ...plans[0].snapshot, exists: true } };
    plans[1] = { ...plans[1], status: "changed", snapshot: { ...plans[1].snapshot, exists: true } };

    expect(checkGuideTargets(plans)).toEqual({
      ok: false,
      artifacts: [
        { name: "AGENTS.md", status: "current" },
        { name: "CLAUDE.md", status: "stale" },
        { name: "DESIGN.md", status: "missing" },
        { name: "design.tokens.json", status: "missing" }
      ]
    });
  });

  it("rejects an input or output identity change during the final zero-write recheck", async () => {
    const fixture = await targetFixture();
    const paths = await resolvedFixture(fixture);
    const plans = await planGuideTargets({ paths, markdown: "rule", designTokensJson: tokenJson("a") });

    await writeFile(join(fixture.target, "design-guide.yaml"), "schemaVersion: changed\n");
    await expect(recheckResolvedGuideInputs(paths)).rejects.toMatchObject({
      phase: "concurrent-change",
      path: "--guide"
    });

    await writeFile(join(fixture.target, "design-guide.yaml"), "schemaVersion: '0.2'\n");
    await writeFile(join(fixture.target, "AGENTS.md"), "created after planning\n");
    await expect(recheckGuideTargetPlans(plans)).rejects.toMatchObject({
      phase: "concurrent-change",
      path: "AGENTS.md"
    });
  });
});

describe("readGuideTargetSnapshot", () => {
  it("performs a bounded MAX+1 read and rejects a file that grows after stat", async () => {
    const stats = regularStats(1);
    let emitted = false;
    const read = vi.fn(async (buffer: Buffer, offset: number, length: number) => {
      if (emitted) {
        return { bytesRead: 0 };
      }
      emitted = true;
      const bytesRead = Math.min(length, MAX_GUIDE_TARGET_BYTES + 1);
      buffer.fill(0x61, offset, offset + bytesRead);
      return { bytesRead };
    });
    const close = vi.fn(async () => undefined);
    const fs = {
      ...defaultGuideFileSystem(),
      lstat: vi.fn(async () => stats),
      openRead: vi.fn(async () => ({ stat: async () => stats, read, close }))
    };

    await expect(readGuideTargetSnapshot("/project/AGENTS.md", "AGENTS.md", fs))
      .rejects.toMatchObject({ phase: "size" });
    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

async function targetFixture(): Promise<{ cwd: string; target: string }> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "design-harness-guide-targets-")));
  tempDirs.push(cwd);
  const target = join(cwd, "project");
  await mkdir(target);
  await writeFile(join(target, "design-guide.yaml"), "schemaVersion: '0.2'\n");
  return { cwd, target };
}

async function resolvedFixture(fixture: { cwd: string; target: string }) {
  return resolveGuidePaths({
    cwd: fixture.cwd,
    targetDir: "project",
    guidePath: "project/design-guide.yaml"
  });
}

function tokenJson(hashCharacter: string): string {
  return `${JSON.stringify({
    color: {},
    $extensions: {
      "dev.design-harness": {
        profile: DESIGN_GUIDE_PROFILE_ID,
        catalogVersion: GUIDE_CATALOG_VERSION,
        sourceHash: hashCharacter.repeat(64)
      }
    }
  }, null, 2)}\n`;
}

function regularStats(size: number): GuideFileStat {
  return {
    dev: 1,
    ino: 2,
    size,
    mode: 0o100644,
    mtimeMs: 1,
    ctimeMs: 1,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false
  };
}
