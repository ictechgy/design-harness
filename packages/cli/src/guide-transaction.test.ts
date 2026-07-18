import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DESIGN_GUIDE_PROFILE_ID, GUIDE_CATALOG_VERSION } from "@design-harness/core";
import { GuideOperationError } from "./guide-errors.js";
import {
  defaultGuideFileSystem,
  planGuideTargets,
  resolveGuidePaths,
  type GuideFileSystem
} from "./guide-targets.js";
import { materializeGuideTargets } from "./guide-transaction.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("materializeGuideTargets", () => {
  it("removes its owned empty lock when acquisition fails after mkdir", async () => {
    const fixture = await transactionFixture();
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let lockCreated = false;
    let guardFailed = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      mkdir: async (path, mode) => {
        await base.mkdir(path, mode);
        if (path.endsWith(".design-harness-guide.lock")) {
          lockCreated = true;
        }
      },
      lstat: async (path) => {
        if (lockCreated && !guardFailed && path === fixture.target) {
          guardFailed = true;
          throw new Error("injected acquisition post-mkdir guard failure");
        }
        return base.lstat(path);
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "acquire" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.message.includes("injected acquisition post-mkdir guard failure"));
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);
  });

  it("preserves a replacement lock when acquisition cleanup cannot prove ownership", async () => {
    const fixture = await transactionFixture();
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    const lockPath = join(fixture.target, ".design-harness-guide.lock");
    const displacedPath = join(fixture.target, "displaced-owned-lock");
    let capturedLock = false;
    let replacedLock = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      lstat: async (path) => {
        const stats = await base.lstat(path);
        if (path === lockPath && !capturedLock) {
          capturedLock = true;
        } else if (path === fixture.target && capturedLock && !replacedLock) {
          replacedLock = true;
          await rename(lockPath, displacedPath);
          await mkdir(lockPath, { mode: 0o700 });
          throw new Error("injected lock replacement after identity capture");
        }
        return stats;
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "replaced-lock" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.message.includes("injected lock replacement after identity capture")
        && error.secondaryFailures.some((failure) => (
          failure.detail.includes("no longer matches the captured identity")
        )));
    expect((await stat(lockPath)).isDirectory()).toBe(true);
    expect((await stat(displacedPath)).isDirectory()).toBe(true);
  });

  it("preserves an acquired lock when its identity cannot be captured", async () => {
    const fixture = await transactionFixture();
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    const lockPath = join(fixture.target, ".design-harness-guide.lock");
    let failed = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      lstat: async (path) => {
        if (path === lockPath && !failed) {
          failed = true;
          throw new Error("injected lock identity read failure");
        }
        return base.lstat(path);
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "unidentified-lock" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.message.includes("injected lock identity read failure")
        && error.secondaryFailures.some((failure) => (
          failure.detail.includes("created identity was never captured")
        )));
    expect((await stat(lockPath)).isDirectory()).toBe(true);
  });

  it("serializes, commits, and removes its private lock, then rechecks an unchanged run", async () => {
    const fixture = await transactionFixture();
    const firstPlans = await plansFor(fixture);
    const first = await materializeGuideTargets(firstPlans, undefined, { transactionId: () => "first" });

    expect(first.artifacts.every((artifact) => artifact.status === "changed")).toBe(true);
    const firstMtimes = await targetMtimes(fixture.target);
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);

    const secondPlans = await plansFor(fixture);
    expect(secondPlans.every((plan) => plan.status === "unchanged")).toBe(true);
    const second = await materializeGuideTargets(secondPlans, undefined, { transactionId: () => "second" });
    expect(second.artifacts.every((artifact) => artifact.status === "unchanged")).toBe(true);
    expect(await targetMtimes(fixture.target)).toEqual(firstMtimes);

    await writeFile(join(fixture.target, "AGENTS.md"), "concurrent drift\n");
    await expect(materializeGuideTargets(secondPlans, undefined, { transactionId: () => "stale" }))
      .rejects.toMatchObject({ phase: "concurrent-change", path: "AGENTS.md" });
  });

  it("restores byte-for-byte originals after a late conditional-link failure", async () => {
    const fixture = await transactionFixture();
    const originals = await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        if (from.includes("-stage-") && to.endsWith("DESIGN.md")) {
          throw new Error("injected late link failure");
        }
        await base.link(from, to);
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "late" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.phase === "commit"
        && error.path === "DESIGN.md"
        && error.message.includes("injected late link failure"));

    await expectTargets(fixture.target, originals);
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);
  });

  it("restores an original when the first post-rename guard fails", async () => {
    const fixture = await transactionFixture();
    const originals = await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let renamed = false;
    let guardFailed = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      rename: async (from, to) => {
        await base.rename(from, to);
        if (from.endsWith("AGENTS.md") && to.includes("-backup-0")) {
          renamed = true;
        }
      },
      lstat: async (path) => {
        if (renamed && !guardFailed && path === fixture.target) {
          guardFailed = true;
          throw new Error("injected post-rename guard failure");
        }
        return base.lstat(path);
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "post-rename" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.phase === "concurrent-change"
        && error.message.includes("injected post-rename guard failure"));

    await expectTargets(fixture.target, originals);
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);
  });

  it("finishes verified rollback when its recovery rename post-guard fails", async () => {
    const fixture = await transactionFixture();
    const originals = await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let rollbackRenamed = false;
    let guardFailed = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        if (from.includes("-stage-") && to.endsWith("DESIGN.md")) {
          throw new Error("injected primary commit failure");
        }
        await base.link(from, to);
      },
      rename: async (from, to) => {
        await base.rename(from, to);
        if (from.endsWith("AGENTS.md") && to.includes("-recovery-0")) {
          rollbackRenamed = true;
        }
      },
      lstat: async (path) => {
        if (rollbackRenamed && !guardFailed && path === fixture.target) {
          guardFailed = true;
          throw new Error("injected rollback post-rename guard failure");
        }
        return base.lstat(path);
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "rollback-post-rename" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.detail.includes("injected primary commit failure")
        && error.secondaryFailures.some((failure) => (
          failure.detail.includes("post-rename guard failed")
        )));

    await expectTargets(fixture.target, originals);
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);
  });

  it("rolls back earlier output while preserving a concurrent pending edit", async () => {
    const fixture = await transactionFixture();
    const originals = await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let injected = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        await base.link(from, to);
        if (!injected && from.includes("-stage-") && to.endsWith("AGENTS.md")) {
          injected = true;
          await writeFile(join(fixture.target, "DESIGN.md"), "concurrent owner edit\n");
        }
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "pending-race" }))
      .rejects.toMatchObject({ phase: "concurrent-change", path: "DESIGN.md" });

    expect(await readFile(join(fixture.target, "AGENTS.md"), "utf8")).toBe(originals["AGENTS.md"]);
    expect(await readFile(join(fixture.target, "DESIGN.md"), "utf8")).toBe("concurrent owner edit\n");
    expect(await readFile(join(fixture.target, "design.tokens.json"), "utf8")).toBe(originals["design.tokens.json"]);
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);
  });

  it("preserves a post-commit concurrent edit instead of clobbering it during rollback", async () => {
    const fixture = await transactionFixture();
    await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let agentsCommitted = false;
    let ownerEdited = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        if (from.includes("-stage-") && to.endsWith("DESIGN.md")) {
          throw new Error("late failure after concurrent edit");
        }
        await base.link(from, to);
        if (from.includes("-stage-") && to.endsWith("AGENTS.md")) {
          agentsCommitted = true;
        }
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, {
      transactionId: () => "post-commit",
      revalidateInputs: async () => {
        if (agentsCommitted && !ownerEdited) {
          ownerEdited = true;
          await writeFile(join(fixture.target, "AGENTS.md"), "post-commit owner edit\n");
        }
      }
    }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.secondaryFailures.some((failure) => failure.detail.includes("concurrent content was preserved")));

    expect(await readFile(join(fixture.target, "AGENTS.md"), "utf8")).toBe("post-commit owner edit\n");
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);
  });

  it("does no rollback or cleanup mutation once a target-directory replacement remains observable", async () => {
    const fixture = await transactionFixture();
    await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const outside = join(fixture.cwd, "outside");
    const movedTarget = join(fixture.cwd, "moved-project");
    await mkdir(outside);
    await writeFile(join(outside, "AGENTS.md"), "outside sentinel\n");
    const base = defaultGuideFileSystem();
    let replaced = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        await base.link(from, to);
        if (!replaced && from.includes("-stage-") && to.endsWith("AGENTS.md")) {
          replaced = true;
          await rename(fixture.target, movedTarget);
          await symlink(outside, fixture.target);
        }
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "dir-race" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.phase === "concurrent-change"
        && error.secondaryFailures.some((failure) => failure.path === ".design-harness-guide.lock"));

    expect(await readFile(join(outside, "AGENTS.md"), "utf8")).toBe("outside sentinel\n");
    expect((await readdir(outside)).sort()).toEqual(["AGENTS.md"]);
  });

  it("restores the original and preserves an unverified staged-source replacement in recovery", async () => {
    const fixture = await transactionFixture();
    const originals = await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let replaced = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        if (!replaced && from.includes("-stage-0") && to.endsWith("AGENTS.md")) {
          replaced = true;
          await unlink(from);
          await writeFile(from, "foreign stage replacement\n");
        }
        await base.link(from, to);
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "stage-race" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.phase === "concurrent-change"
        && error.secondaryFailures.some((failure) => failure.detail.includes("unverified linked source")));

    expect(await readFile(join(fixture.target, "AGENTS.md"), "utf8")).toBe(originals["AGENTS.md"]);
    const lockEntries = await readdir(join(fixture.target, ".design-harness-guide.lock"));
    expect(lockEntries.some((name) => name.includes("recovery-0"))).toBe(true);
    expect(lockEntries.some((name) => name.includes("stage-0"))).toBe(true);
  });

  it("keeps the primary commit error and reports a failed conditional restore as secondary", async () => {
    const fixture = await transactionFixture();
    await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        if (from.includes("-stage-") && to.endsWith("DESIGN.md")) {
          throw new Error("primary commit failure");
        }
        if (from.includes("-backup-0") && to.endsWith("AGENTS.md")) {
          throw new Error("secondary restore failure");
        }
        await base.link(from, to);
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "secondary" }))
      .rejects.toSatisfy((error: unknown) => error instanceof GuideOperationError
        && error.phase === "commit"
        && error.detail.includes("primary commit failure")
        && error.secondaryFailures.some((failure) => failure.phase === "rollback"
          && failure.path === "AGENTS.md"
          && failure.detail.includes("secondary restore failure")));
  });

  it("removes an owned stage when close fails and never removes a foreign lock collision", async () => {
    const fixture = await transactionFixture();
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let injected = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      openExclusive: async (path, mode) => {
        const handle = await base.openExclusive(path, mode);
        if (injected || !path.includes("-stage-0")) {
          return handle;
        }
        injected = true;
        return {
          stat: () => handle.stat(),
          writeFile: (data) => handle.writeFile(data),
          chmod: (targetMode) => handle.chmod(targetMode),
          sync: () => handle.sync(),
          close: async () => {
            await handle.close();
            throw new Error("injected close failure");
          }
        };
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, { transactionId: () => "close" }))
      .rejects.toMatchObject({ phase: "stage-write", path: "AGENTS.md" });
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);

    const lock = join(fixture.target, ".design-harness-guide.lock");
    await mkdir(lock, { mode: 0o700 });
    await writeFile(join(lock, "foreign-owner"), "keep\n");
    await expect(materializeGuideTargets(await plansFor(fixture), undefined, { transactionId: () => "collision" }))
      .rejects.toMatchObject({ phase: "stage-write", path: ".design-harness-guide.lock" });
    expect(await readFile(join(lock, "foreign-owner"), "utf8")).toBe("keep\n");
  });

  it("rolls back when an input identity changes after the first commit", async () => {
    const fixture = await transactionFixture();
    const originals = await seedOwnedTargets(fixture.target);
    const plans = await plansFor(fixture);
    const base = defaultGuideFileSystem();
    let committed = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      link: async (from, to) => {
        await base.link(from, to);
        if (from.includes("-stage-") && to.endsWith("AGENTS.md")) {
          committed = true;
        }
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, {
      transactionId: () => "input-race",
      revalidateInputs: async () => {
        if (committed) {
          throw new GuideOperationError("concurrent-change", "--guide", "input changed");
        }
      }
    })).rejects.toMatchObject({ phase: "concurrent-change", path: "--guide" });
    await expectTargets(fixture.target, originals);
    expect(await privateTransactionEntries(fixture.target)).toEqual([]);
  });

  it("does not return unchanged when an input drifts during the last output sweep", async () => {
    const fixture = await transactionFixture();
    await materializeGuideTargets(await plansFor(fixture), undefined, { transactionId: () => "seed" });
    const plans = await plansFor(fixture);
    expect(plans.every((plan) => plan.status === "unchanged")).toBe(true);
    const base = defaultGuideFileSystem();
    let agentSweeps = 0;
    let inputDrifted = false;
    const fileSystem: GuideFileSystem = {
      ...base,
      lstat: async (path) => {
        const stats = await base.lstat(path);
        if (path === join(fixture.target, "AGENTS.md") && ++agentSweeps === 2) {
          inputDrifted = true;
        }
        return stats;
      }
    };

    await expect(materializeGuideTargets(plans, fileSystem, {
      transactionId: () => "unchanged-race",
      revalidateInputs: async () => {
        if (inputDrifted) {
          throw new GuideOperationError("concurrent-change", "--guide", "input drifted during output sweep");
        }
      }
    })).rejects.toMatchObject({ phase: "concurrent-change", path: "--guide" });
  });
});

async function transactionFixture(): Promise<{ cwd: string; target: string }> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "design-harness-guide-transaction-")));
  tempDirs.push(cwd);
  const target = join(cwd, "project");
  await mkdir(target);
  await writeFile(join(target, "design-guide.yaml"), "schemaVersion: '0.2'\n");
  return { cwd, target };
}

async function plansFor(fixture: { cwd: string; target: string }) {
  const paths = await resolveGuidePaths({
    cwd: fixture.cwd,
    targetDir: "project",
    guidePath: "project/design-guide.yaml"
  });
  return planGuideTargets({ paths, markdown: "# Stable guide\n- rule", designTokensJson: tokenJson("a") });
}

async function seedOwnedTargets(target: string): Promise<Record<string, string>> {
  const originals: Record<string, string> = {
    "AGENTS.md": "owner agent notes\n",
    "CLAUDE.md": "@AGENTS.md\nowner Claude notes\n",
    "DESIGN.md": "owner design notes\n",
    "design.tokens.json": tokenJson("b")
  };
  await Promise.all(Object.entries(originals).map(([name, content]) => writeFile(join(target, name), content)));
  return originals;
}

async function expectTargets(target: string, originals: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(originals)) {
    expect(await readFile(join(target, name), "utf8")).toBe(content);
  }
}

async function targetMtimes(target: string): Promise<Record<string, number>> {
  return Object.fromEntries(await Promise.all(
    ["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"].map(async (name) => [
      name,
      (await stat(join(target, name))).mtimeMs
    ])
  ));
}

async function privateTransactionEntries(target: string): Promise<string[]> {
  return (await readdir(target)).filter((name) => name === ".design-harness-guide.lock");
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
