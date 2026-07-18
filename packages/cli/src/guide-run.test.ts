import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compileDesignGuide, type DesignGuide } from "@design-harness/core";
import { GuideOperationError } from "./guide-errors.js";
import { runGuideCommand, type GuideRunDependencies } from "./guide-run.js";
import {
  resolveGuidePaths,
  type GuideTargetPlan,
  type ResolvedGuidePaths
} from "./guide-targets.js";

describe("runGuideCommand", () => {
  it("establishes containment before loading and returns compile observability", async () => {
    const events: string[] = [];
    const compilation = compileDesignGuide(validGuide());
    const plans = fakePlans("changed");
    const dependencies: GuideRunDependencies = {
      cwd: () => "/workspace",
      resolvePaths: vi.fn(async () => {
        events.push("containment");
        return fakePaths();
      }),
      loadDesignGuide: vi.fn(async () => {
        events.push("guide-read");
        return validGuide();
      }),
      compile: vi.fn(() => {
        events.push("compile");
        return compilation;
      }),
      planTargets: vi.fn(async () => {
        events.push("plan");
        return plans;
      }),
      materialize: vi.fn(async () => {
        events.push("materialize");
        return { artifacts: plans.map((plan) => ({ name: plan.name, status: plan.status })) };
      })
    };

    const result = await runGuideCommand({
      command: "guide",
      action: "compile",
      guidePath: "project/design-guide.yaml",
      targetDir: "project"
    }, dependencies);

    expect(events).toEqual(["containment", "guide-read", "compile", "plan", "materialize"]);
    expect(dependencies.loadDesignGuide).toHaveBeenCalledWith(
      "/workspace/project/design-guide.yaml",
      expect.objectContaining({
        requireRealPath: true,
        expectedIdentity: fakePaths().guideIdentity
      })
    );
    expect(result).toMatchObject({
      action: "compile",
      ok: true,
      targetDir: "project",
      profileId: compilation.profileId,
      catalogVersion: compilation.catalogVersion,
      sourceHash: compilation.sourceHash,
      tokenEstimate: {
        method: "guide-token-estimate-v1",
        estimated: compilation.tokenEstimate.estimated,
        ceiling: 2000
      }
    });
    expect(result.artifacts).toHaveLength(4);
  });

  it("runs check as a compare-only gate and reports stale versus missing without materializing", async () => {
    const compilation = compileDesignGuide(validGuide());
    const plans = fakePlans("unchanged");
    plans[1] = { ...plans[1], status: "changed" };
    plans[2] = { ...plans[2], status: "changed", snapshot: { ...plans[2].snapshot, exists: false } };
    const materialize = vi.fn();

    const result = await runGuideCommand({
      command: "guide",
      action: "check",
      guidePath: "project/design-guide.yaml",
      targetDir: "project",
      maxTokens: 2000
    }, {
      cwd: () => "/workspace",
      resolvePaths: async () => fakePaths(),
      loadDesignGuide: async () => validGuide(),
      compile: () => compilation,
      planTargets: async () => plans,
      recheckInputs: async () => undefined,
      recheckPlans: async () => undefined,
      checkTargets: () => ({
        ok: false,
        artifacts: [
          { name: "AGENTS.md", status: "current" },
          { name: "CLAUDE.md", status: "stale" },
          { name: "DESIGN.md", status: "missing" },
          { name: "design.tokens.json", status: "current" }
        ]
      }),
      materialize
    });

    expect(result.ok).toBe(false);
    expect(result.artifacts.map((artifact) => artifact.checkStatus)).toEqual([
      "current", "stale", "missing", "current"
    ]);
    expect(materialize).not.toHaveBeenCalled();
  });

  it("does not report check success when the final input/output recheck detects drift", async () => {
    const compilation = compileDesignGuide(validGuide());
    const plans = fakePlans("unchanged");
    const checkTargets = vi.fn();

    await expect(runGuideCommand({
      command: "guide",
      action: "check",
      guidePath: "project/design-guide.yaml",
      targetDir: "project",
      maxTokens: 2000
    }, {
      cwd: () => "/workspace",
      resolvePaths: async () => fakePaths(),
      loadDesignGuide: async () => validGuide(),
      compile: () => compilation,
      planTargets: async () => plans,
      recheckInputs: async () => undefined,
      recheckPlans: async () => {
        throw new GuideOperationError("concurrent-change", "AGENTS.md", "changed after planning");
      },
      checkTargets
    })).rejects.toMatchObject({ phase: "concurrent-change", path: "AGENTS.md" });

    expect(checkTargets).not.toHaveBeenCalled();
  });

  it("does not report check success when an input drifts during the final output sweep", async () => {
    const compilation = compileDesignGuide(validGuide());
    const plans = fakePlans("unchanged");
    const checkTargets = vi.fn();
    let outputSweepFinished = false;

    await expect(runGuideCommand({
      command: "guide",
      action: "check",
      guidePath: "project/design-guide.yaml",
      targetDir: "project",
      maxTokens: 2000
    }, {
      cwd: () => "/workspace",
      resolvePaths: async () => fakePaths(),
      loadDesignGuide: async () => validGuide(),
      compile: () => compilation,
      planTargets: async () => plans,
      recheckInputs: async () => {
        if (outputSweepFinished) {
          throw new GuideOperationError("concurrent-change", "--guide", "changed during output sweep");
        }
      },
      recheckPlans: async () => {
        outputSweepFinished = true;
      },
      checkTargets
    })).rejects.toMatchObject({ phase: "concurrent-change", path: "--guide" });

    expect(checkTargets).not.toHaveBeenCalled();
  });

  it("enforces a lower check ceiling before target planning or writing", async () => {
    const planTargets = vi.fn();
    const materialize = vi.fn();

    await expect(runGuideCommand({
      command: "guide",
      action: "check",
      guidePath: "project/design-guide.yaml",
      targetDir: "project",
      maxTokens: 1
    }, {
      cwd: () => "/workspace",
      resolvePaths: async () => fakePaths(),
      loadDesignGuide: async () => validGuide(),
      planTargets,
      materialize
    })).rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
      && error.phase === "budget"
      && error.message.includes("guide-token-estimate-v1"));

    expect(planTargets).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });

  it("does not invoke any loader when containment fails", async () => {
    const loadDesignGuide = vi.fn();
    const loadCopyStyle = vi.fn();
    await expect(runGuideCommand({
      command: "guide",
      action: "compile",
      guidePath: "outside.yaml",
      copyStylePath: "outside-copy.yaml",
      targetDir: "project"
    }, {
      resolvePaths: async () => {
        throw new GuideOperationError("containment", "--guide", "--guide must be inside --target");
      },
      loadDesignGuide,
      loadCopyStyle
    })).rejects.toMatchObject({ phase: "containment" });

    expect(loadDesignGuide).not.toHaveBeenCalled();
    expect(loadCopyStyle).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")("fails closed when a config becomes a symlink after containment", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-harness-guide-race-"));
    const target = join(root, "project");
    const guidePath = join(target, "design-guide.yaml");
    const outsidePath = join(root, "outside.yaml");
    await mkdir(target);
    await writeFile(guidePath, "schemaVersion: '0.2'\n", "utf8");
    await writeFile(outsidePath, "schemaVersion: '0.2'\n", "utf8");
    try {
      await expect(runGuideCommand({
        command: "guide",
        action: "compile",
        guidePath: "design-guide.yaml",
        targetDir: "."
      }, {
        cwd: () => target,
        resolvePaths: async () => {
          await rm(guidePath);
          await symlink(outsidePath, guidePath);
          return {
            cwd: target,
            targetDir: target,
            targetIdentity: { dev: 1, ino: 1 },
            guidePath,
            guideIdentity: { dev: 1, ino: 2, size: 21, mode: 0o100644, mtimeMs: 1, ctimeMs: 1 },
            outputs: {
              "AGENTS.md": join(target, "AGENTS.md"),
              "CLAUDE.md": join(target, "CLAUDE.md"),
              "DESIGN.md": join(target, "DESIGN.md"),
              "design.tokens.json": join(target, "design.tokens.json")
            }
          };
        }
      })).rejects.toMatchObject({ phase: "read", path: "--guide" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a regular-file replacement after containment before parsing its bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "design-harness-guide-identity-race-"));
    const target = join(root, "project");
    const guidePath = join(target, "design-guide.yaml");
    const replacementPath = join(target, "replacement.yaml");
    const originalPath = join(target, "original.yaml");
    await mkdir(target);
    await writeFile(guidePath, "schemaVersion: '0.2'\n", "utf8");
    await writeFile(replacementPath, "schemaVersion: '0.2'\nreplacement: true\n", "utf8");
    try {
      const captured = await resolveGuidePaths({
        cwd: target,
        targetDir: ".",
        guidePath: "design-guide.yaml"
      });
      await rename(guidePath, originalPath);
      await rename(replacementPath, guidePath);

      await expect(runGuideCommand({
        command: "guide",
        action: "compile",
        guidePath: "design-guide.yaml",
        targetDir: "."
      }, {
        cwd: () => target,
        resolvePaths: async () => captured
      })).rejects.toMatchObject({
        phase: "read",
        path: "--guide",
        detail: "file identity changed since containment"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function fakePaths(): ResolvedGuidePaths {
  return {
    cwd: "/workspace",
    targetDir: "/workspace/project",
    targetIdentity: { dev: 1, ino: 1 },
    guidePath: "/workspace/project/design-guide.yaml",
    guideIdentity: { dev: 1, ino: 2, size: 3, mode: 0o100644, mtimeMs: 1, ctimeMs: 1 },
    outputs: {
      "AGENTS.md": "/workspace/project/AGENTS.md",
      "CLAUDE.md": "/workspace/project/CLAUDE.md",
      "DESIGN.md": "/workspace/project/DESIGN.md",
      "design.tokens.json": "/workspace/project/design.tokens.json"
    }
  };
}

function fakePlans(status: "changed" | "unchanged"): GuideTargetPlan[] {
  return (["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"] as const).map((name) => ({
    name,
    path: `/workspace/project/${name}`,
    relativePath: name,
    targetDir: "/workspace/project",
    targetIdentity: { dev: 1, ino: 1 },
    status,
    snapshot: {
      exists: true,
      content: Buffer.from("old"),
      mode: 0o644,
      identity: { dev: 1, ino: 1, size: 3, mode: 0o100644, mtimeMs: 1, ctimeMs: 1 }
    },
    nextContent: Buffer.from(status === "changed" ? "new" : "old")
  }));
}

function validGuide(): DesignGuide {
  const color = (components: [number, number, number]) => ({
    $value: { colorSpace: "srgb" as const, components }
  });
  const dimension = (value: number, unit: "px" | "rem") => ({ $value: { value, unit } });
  return {
    schemaVersion: "0.2",
    tokens: {
      color: {
        semantic: {
          $type: "color",
          background: color([1, 1, 1]),
          text: color([0.1, 0.1, 0.1]),
          accent: color([0.2, 0.4, 0.8]),
          border: color([0.7, 0.7, 0.7])
        }
      },
      font: {
        family: {
          $type: "fontFamily",
          heading: { $value: ["Example Sans", "sans-serif"] },
          body: { $value: ["Example Sans", "sans-serif"] }
        }
      },
      spacing: {
        $type: "dimension",
        sm: dimension(0.5, "rem"),
        md: dimension(1, "rem")
      },
      radius: {
        $type: "dimension",
        sm: dimension(4, "px"),
        md: dimension(8, "px")
      }
    },
    prohibitions: ["decorative-gradient-without-purpose"],
    signatureElement: "Use a compact outlined status rail as the recurring product signature."
  };
}
