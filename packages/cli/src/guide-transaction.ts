import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import {
  NEW_GUIDE_FILE_MODE,
  assertGuideTargetDirectory,
  defaultGuideFileSystem,
  identityOf,
  nodeIdentityOf,
  readGuideTargetSnapshot,
  recheckGuideTargetPlans,
  sameNodeIdentity,
  type GuideFileIdentity,
  type GuideFileStat,
  type GuideFileSystem,
  type GuideNodeIdentity,
  type GuideTargetPlan,
  type GuideWriteHandle
} from "./guide-targets.js";
import {
  GuideOperationError,
  errorDetail,
  type GuideSecondaryFailure
} from "./guide-errors.js";

export interface GuideMaterializationResult {
  artifacts: ReadonlyArray<{
    name: GuideTargetPlan["name"];
    status: "changed" | "unchanged";
  }>;
}

export interface GuideTransactionOptions {
  transactionId?: () => string;
  revalidateInputs?: () => Promise<void>;
}

interface OwnedFile {
  path: string;
  identity: GuideNodeIdentity;
  content: Buffer;
  mode: number;
}

interface StagedTarget {
  plan: GuideTargetPlan;
  stage: OwnedFile;
  index: number;
}

interface CommitRecord {
  staged: StagedTarget;
  backupPath?: string;
  backup?: OwnedFile;
  linked: boolean;
  suspectLinkedSource?: boolean;
}

interface TransactionContext {
  rootPlan: GuideTargetPlan;
  lockPath: string;
  lockIdentity: GuideNodeIdentity;
  transactionId: string;
}

const LOCK_DIRECTORY_NAME = ".design-harness-guide.lock";
const LOCK_DIRECTORY_MODE = 0o700;

export async function materializeGuideTargets(
  plans: readonly GuideTargetPlan[],
  fileSystem: GuideFileSystem = defaultGuideFileSystem(),
  options: GuideTransactionOptions = {}
): Promise<GuideMaterializationResult> {
  assertPlanSet(plans);
  const artifacts = plans.map((plan) => ({ name: plan.name, status: plan.status }));
  await revalidate(plans, fileSystem, options);
  const changed = plans.filter((plan) => plan.status === "changed");
  if (changed.length === 0) {
    await revalidate(plans, fileSystem, options);
    return { artifacts };
  }

  const transactionId = (options.transactionId ?? randomUUID)();
  if (!/^[a-zA-Z0-9-]+$/u.test(transactionId)) {
    throw new TypeError("transactionId must contain only ASCII letters, digits, and hyphens");
  }

  const context = await acquireTransactionLock(plans[0], transactionId, fileSystem);
  const staged: StagedTarget[] = [];
  const records: CommitRecord[] = [];
  try {
    await assertHardLinkSupport(context, fileSystem);
    for (let index = 0; index < changed.length; index += 1) {
      await revalidate(plans, fileSystem, options);
      const plan = changed[index];
      const stagePath = lockEntryPath(context, `stage-${index}`);
      const stage = await createOwnedFile(
        stagePath,
        plan.relativePath,
        plan.nextContent,
        plan.snapshot.exists ? plan.snapshot.mode : NEW_GUIDE_FILE_MODE,
        context,
        fileSystem
      );
      staged.push({ plan, stage, index });
    }

    for (let index = 0; index < staged.length; index += 1) {
      await revalidate(
        staged.slice(index).map((item) => item.plan),
        fileSystem,
        options
      );
      const record: CommitRecord = { staged: staged[index], linked: false };
      records.push(record);
      await prepareCommit(record, context, fileSystem);
      await linkStagedTarget(record, context, fileSystem);
    }

    await revalidateInputsOnly(options);
    await validateFinalOutputs(plans, staged, context, fileSystem);
    await revalidateInputsOnly(options);
  } catch (error) {
    const primary = normalizePrimary(error, "commit", "guide outputs");
    const rollbackFailures = await rollbackRecords(records, context, fileSystem);
    const cleanupFailures = await cleanupStagedFiles(staged, context, fileSystem);
    const lockFailures = await releaseTransactionLock(context, fileSystem);
    throw withSecondary(primary, [...rollbackFailures, ...cleanupFailures, ...lockFailures]);
  }

  const cleanupFailures = await finalizeSuccessfulTransaction(records, staged, context, fileSystem);
  if (cleanupFailures.length > 0) {
    throw new GuideOperationError(
      "commit",
      LOCK_DIRECTORY_NAME,
      "guide outputs committed but private transaction cleanup was incomplete",
      cleanupFailures
    );
  }
  return { artifacts };
}

async function acquireTransactionLock(
  rootPlan: GuideTargetPlan,
  transactionId: string,
  fileSystem: GuideFileSystem
): Promise<TransactionContext> {
  await assertGuideTargetDirectory(rootPlan, fileSystem);
  const lockPath = join(rootPlan.targetDir, LOCK_DIRECTORY_NAME);
  try {
    await fileSystem.mkdir(lockPath, LOCK_DIRECTORY_MODE);
  } catch (error) {
    throw new GuideOperationError(
      "stage-write",
      LOCK_DIRECTORY_NAME,
      `cannot acquire the exclusive guide transaction lock: ${errorDetail(error)}`
    );
  }

  let lockIdentity: GuideNodeIdentity | undefined;
  try {
    const stats = await fileSystem.lstat(lockPath);
    if (stats.isSymbolicLink()
      || !stats.isDirectory()
      || String(stats.dev) !== String(rootPlan.targetIdentity.dev)
      || !hasPrivateLockMode(stats.mode)) {
      throw new GuideOperationError(
        "stage-write",
        LOCK_DIRECTORY_NAME,
        "exclusive transaction lock has an unsafe identity, type, device, or mode"
      );
    }
    lockIdentity = nodeIdentityOf(stats);
    await assertGuideTargetDirectory(rootPlan, fileSystem);
    const context = {
      rootPlan,
      lockPath,
      lockIdentity,
      transactionId
    };
    await guardTransaction(context, fileSystem);
    return context;
  } catch (error) {
    const primary = error instanceof GuideOperationError
      ? error
      : new GuideOperationError("stage-write", LOCK_DIRECTORY_NAME, errorDetail(error));
    const failures = await cleanupAbortedTransactionLock(
      rootPlan,
      lockPath,
      lockIdentity,
      fileSystem
    );
    throw withSecondary(primary, failures);
  }
}

async function cleanupAbortedTransactionLock(
  rootPlan: GuideTargetPlan,
  lockPath: string,
  lockIdentity: GuideNodeIdentity | undefined,
  fileSystem: GuideFileSystem
): Promise<GuideSecondaryFailure[]> {
  if (!lockIdentity) {
    return [{
      phase: "rollback",
      path: LOCK_DIRECTORY_NAME,
      detail: "transaction lock was preserved because its created identity was never captured"
    }];
  }

  let removed = false;
  try {
    await assertGuideTargetDirectory(rootPlan, fileSystem);
    const stats = await fileSystem.lstat(lockPath);
    if (stats.isSymbolicLink()
      || !stats.isDirectory()
      || !sameNodeIdentity(nodeIdentityOf(stats), lockIdentity)
      || String(stats.dev) !== String(rootPlan.targetIdentity.dev)
      || !hasPrivateLockMode(stats.mode)) {
      throw new Error("lock no longer matches the captured identity, type, device, or mode");
    }
    await fileSystem.rmdir(lockPath);
    removed = true;
    await assertGuideTargetDirectory(rootPlan, fileSystem);
    return [];
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    return [{
      phase: "rollback",
      path: LOCK_DIRECTORY_NAME,
      detail: removed
        ? `transaction lock was removed, but target post-check failed: ${errorDetail(error)}`
        : `transaction lock was preserved after acquisition failed: ${errorDetail(error)}`
    }];
  }
}

async function assertHardLinkSupport(
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  const source = await createOwnedFile(
    lockEntryPath(context, "hardlink-probe-source"),
    LOCK_DIRECTORY_NAME,
    Buffer.alloc(0),
    0o600,
    context,
    fileSystem
  );
  const linkedPath = lockEntryPath(context, "hardlink-probe-link");
  let linked = false;
  try {
    await linkOwnedFile(source, linkedPath, context, fileSystem, () => { linked = true; });
  } catch (error) {
    const primary = new GuideOperationError(
      "stage-write",
      LOCK_DIRECTORY_NAME,
      `same-device conditional hard links are required: ${errorDetail(error)}`
    );
    const failures = await cleanupOwnedFiles([
      ...(linked ? [{ ...source, path: linkedPath }] : []),
      source
    ], context, fileSystem, "stage-write");
    throw withSecondary(primary, failures);
  }
  const failures = await cleanupOwnedFiles([
    { ...source, path: linkedPath },
    source
  ], context, fileSystem, "stage-write");
  if (failures.length > 0) {
    throw new GuideOperationError(
      "stage-write",
      LOCK_DIRECTORY_NAME,
      "hard-link capability probe cleanup failed",
      failures
    );
  }
}

async function prepareCommit(
  record: CommitRecord,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  const { staged } = record;
  await verifyOwnedFile(staged.stage, context, fileSystem);
  if (!staged.plan.snapshot.exists) {
    return;
  }

  const backupPath = lockEntryPath(context, `backup-${staged.index}`);
  await assertMissingLockEntry(backupPath, context, fileSystem);
  record.backupPath = backupPath;
  await guardedRename(staged.plan.path, backupPath, context, fileSystem);

  const backup = await readOwnedFile(backupPath, staged.plan.relativePath, context, fileSystem);
  if (!staged.plan.snapshot.identity
    || !sameNodeIdentity(backup.identity, nodeIdentityOfIdentity(staged.plan.snapshot.identity))) {
    throw new GuideOperationError(
      "concurrent-change",
      staged.plan.relativePath,
      "target identity changed while it was moved into private recovery"
    );
  }
  record.backup = backup;
  if (!backup.content.equals(staged.plan.snapshot.content)
    || backup.mode !== staged.plan.snapshot.mode) {
    throw new GuideOperationError(
      "concurrent-change",
      staged.plan.relativePath,
      "target changed while it was moved into private recovery"
    );
  }
}

async function linkStagedTarget(
  record: CommitRecord,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  const { staged } = record;
  await verifyOwnedFile(staged.stage, context, fileSystem);
  try {
    await linkOwnedFile(
      staged.stage,
      staged.plan.path,
      context,
      fileSystem,
      () => { record.linked = true; }
    );
    await verifyTargetMatchesOwned(staged.plan.path, staged.stage, context, fileSystem);
  } catch (error) {
    if (record.linked) {
      record.suspectLinkedSource = true;
    }
    throw error instanceof GuideOperationError
      ? error
      : new GuideOperationError("commit", staged.plan.relativePath, errorDetail(error));
  }
}

async function validateFinalOutputs(
  plans: readonly GuideTargetPlan[],
  staged: readonly StagedTarget[],
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  const stagedByName = new Map(staged.map((item) => [item.plan.name, item]));
  for (const plan of plans) {
    await guardTransaction(context, fileSystem);
    const item = stagedByName.get(plan.name);
    if (item) {
      await verifyTargetMatchesOwned(plan.path, item.stage, context, fileSystem);
      continue;
    }
    const snapshot = await readGuideTargetSnapshot(plan.path, plan.relativePath, fileSystem);
    if (!snapshot.exists
      || !snapshot.identity
      || !plan.snapshot.identity
      || !sameNodeIdentity(
        nodeIdentityOfIdentity(snapshot.identity),
        nodeIdentityOfIdentity(plan.snapshot.identity)
      )
      || !snapshot.content.equals(plan.snapshot.content)
      || snapshot.mode !== plan.snapshot.mode) {
      throw new GuideOperationError(
        "concurrent-change",
        plan.relativePath,
        "unchanged target changed during guide compilation"
      );
    }
  }
  await guardTransaction(context, fileSystem);
}

async function rollbackRecords(
  records: readonly CommitRecord[],
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<GuideSecondaryFailure[]> {
  const failures: GuideSecondaryFailure[] = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    failures.push(...await rollbackRecord(records[index], context, fileSystem));
  }
  return sortedFailures(failures);
}

async function rollbackRecord(
  record: CommitRecord,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<GuideSecondaryFailure[]> {
  const failures: GuideSecondaryFailure[] = [];
  const { staged } = record;
  if (!record.linked) {
    if (!record.backup && record.backupPath) {
      try {
        const candidate = await readOwnedFile(
          record.backupPath,
          staged.plan.relativePath,
          context,
          fileSystem
        );
        if (!staged.plan.snapshot.identity
          || !sameNodeIdentity(
            candidate.identity,
            nodeIdentityOfIdentity(staged.plan.snapshot.identity)
          )) {
          throw new GuideOperationError(
            "rollback",
            staged.plan.relativePath,
            "private recovery entry does not match the original target inode"
          );
        }
        record.backup = candidate;
      } catch (error) {
        if (await targetMatchesSnapshot(staged.plan, context, fileSystem)) {
          return failures;
        }
        failures.push(rollbackFailure(
          staged.plan.relativePath,
          `original target could not be verified or recovered from ${basename(record.backupPath)}: ${errorDetail(error)}`
        ));
        return failures;
      }
    }
    if (record.backup) {
      const restored = await restoreOwnedFile(record.backup, staged.plan.path, context, fileSystem, failures);
      if (restored) {
        failures.push(...await cleanupOwnedFiles([record.backup], context, fileSystem, "rollback"));
      }
    }
    return failures;
  }

  const recoveryPath = lockEntryPath(context, `recovery-${staged.index}`);
  let movedToRecovery = false;
  try {
    await assertMissingLockEntry(recoveryPath, context, fileSystem);
    await guardedRename(
      staged.plan.path,
      recoveryPath,
      context,
      fileSystem,
      () => { movedToRecovery = true; }
    );
  } catch (error) {
    if (!movedToRecovery) {
      failures.push(rollbackFailure(staged.plan.relativePath, errorDetail(error)));
      return failures;
    }
    failures.push(rollbackFailure(
      staged.plan.relativePath,
      `post-rename guard failed; verifying private recovery: ${errorDetail(error)}`
    ));
  }

  let recovered: OwnedFile;
  try {
    recovered = await readOwnedFile(recoveryPath, staged.plan.relativePath, context, fileSystem);
  } catch (error) {
    if (record.backup) {
      await restoreOwnedFile(record.backup, staged.plan.path, context, fileSystem, failures);
    }
    failures.push(rollbackFailure(
      staged.plan.relativePath,
      `unexpected replacement preserved at ${basename(recoveryPath)}: ${errorDetail(error)}`
    ));
    return failures;
  }

  const generated = sameNodeIdentity(recovered.identity, staged.stage.identity)
    && recovered.content.equals(staged.stage.content)
    && recovered.mode === staged.stage.mode;
  if (record.suspectLinkedSource && !generated) {
    if (record.backup) {
      await restoreOwnedFile(record.backup, staged.plan.path, context, fileSystem, failures);
    }
    failures.push(rollbackFailure(
      staged.plan.relativePath,
      `unverified linked source preserved at ${basename(recoveryPath)}`
    ));
    return failures;
  }
  if (!generated) {
    const restored = await restoreOwnedFile(recovered, staged.plan.path, context, fileSystem, failures);
    if (restored) {
      failures.push(...await cleanupOwnedFiles([recovered], context, fileSystem, "rollback"));
    }
    failures.push(rollbackFailure(
      staged.plan.relativePath,
      "target changed after commit; concurrent content was preserved instead of being overwritten"
    ));
    if (record.backup) {
      failures.push(...await cleanupOwnedFiles([record.backup], context, fileSystem, "rollback"));
    }
    if (sameNodeIdentity(recovered.identity, staged.stage.identity)) {
      staged.stage = { ...recovered, path: staged.stage.path };
    }
    return failures;
  }

  if (staged.plan.snapshot.exists) {
    if (!record.backup) {
      failures.push(rollbackFailure(staged.plan.relativePath, "original backup is unavailable"));
      return failures;
    }
    const restored = await restoreOwnedFile(record.backup, staged.plan.path, context, fileSystem, failures);
    if (!restored) {
      return failures;
    }
    failures.push(...await cleanupOwnedFiles([record.backup], context, fileSystem, "rollback"));
  }
  failures.push(...await cleanupOwnedFiles([recovered], context, fileSystem, "rollback"));
  return failures;
}

async function restoreOwnedFile(
  source: OwnedFile,
  destination: string,
  context: TransactionContext,
  fileSystem: GuideFileSystem,
  failures: GuideSecondaryFailure[]
): Promise<boolean> {
  try {
    await linkOwnedFile(source, destination, context, fileSystem);
    await verifyTargetMatchesOwned(destination, source, context, fileSystem);
    return true;
  } catch (error) {
    failures.push(rollbackFailure(
      basename(destination),
      `conditional restore failed; preserved ${basename(source.path)}: ${errorDetail(error)}`
    ));
    return false;
  }
}

async function targetMatchesSnapshot(
  plan: GuideTargetPlan,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<boolean> {
  try {
    await guardTransaction(context, fileSystem);
    const snapshot = await readGuideTargetSnapshot(plan.path, plan.relativePath, fileSystem);
    await guardTransaction(context, fileSystem);
    return snapshot.exists
      && snapshot.identity !== undefined
      && plan.snapshot.identity !== undefined
      && sameNodeIdentity(
        nodeIdentityOfIdentity(snapshot.identity),
        nodeIdentityOfIdentity(plan.snapshot.identity)
      )
      && snapshot.content.equals(plan.snapshot.content)
      && snapshot.mode === plan.snapshot.mode;
  } catch {
    return false;
  }
}

async function finalizeSuccessfulTransaction(
  records: readonly CommitRecord[],
  staged: readonly StagedTarget[],
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<GuideSecondaryFailure[]> {
  const backups = records.flatMap((record) => record.backup ? [record.backup] : []);
  const failures = await cleanupOwnedFiles(
    [...backups, ...staged.map((item) => item.stage)],
    context,
    fileSystem,
    "commit"
  );
  failures.push(...await releaseTransactionLock(context, fileSystem));
  return sortedFailures(failures);
}

async function cleanupStagedFiles(
  staged: readonly StagedTarget[],
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<GuideSecondaryFailure[]> {
  return cleanupOwnedFiles(staged.map((item) => item.stage), context, fileSystem, "rollback");
}

async function cleanupOwnedFiles(
  files: readonly OwnedFile[],
  context: TransactionContext,
  fileSystem: GuideFileSystem,
  phase: "stage-write" | "commit" | "rollback"
): Promise<GuideSecondaryFailure[]> {
  const failures: GuideSecondaryFailure[] = [];
  for (const file of files) {
    try {
      await unlinkOwnedFile(file, context, fileSystem);
    } catch (error) {
      if (!isMissing(error)) {
        failures.push({
          phase,
          path: basename(file.path),
          detail: `owned cleanup failed: ${errorDetail(error)}`
        });
      }
    }
  }
  return sortedFailures(failures);
}

async function releaseTransactionLock(
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<GuideSecondaryFailure[]> {
  let removed = false;
  try {
    await guardTransaction(context, fileSystem);
    await fileSystem.rmdir(context.lockPath);
    removed = true;
    await assertGuideTargetDirectory(context.rootPlan, fileSystem);
    return [];
  } catch (error) {
    return [{
      phase: "rollback",
      path: LOCK_DIRECTORY_NAME,
      detail: removed
        ? `transaction lock was removed, but target post-check failed: ${errorDetail(error)}`
        : `transaction lock was preserved: ${errorDetail(error)}`
    }];
  }
}

async function createOwnedFile(
  path: string,
  displayPath: string,
  content: Buffer,
  mode: number,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<OwnedFile> {
  await guardTransaction(context, fileSystem);
  let handle: GuideWriteHandle | undefined;
  let identity: GuideNodeIdentity | undefined;
  let actualMode: number | undefined;
  let primary: GuideOperationError | undefined;
  try {
    handle = await fileSystem.openExclusive(path, mode);
    await handle.writeFile(content);
    await handle.chmod(mode);
    await handle.sync();
    const stats = await handle.stat();
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("exclusive stage is not a regular file");
    }
    identity = nodeIdentityOf(stats);
    actualMode = numericMode(stats.mode) & 0o777;
    if (process.platform !== "win32" && actualMode !== mode) {
      throw new Error(`exclusive stage mode is ${actualMode.toString(8)}, expected ${mode.toString(8)}`);
    }
  } catch (error) {
    primary = new GuideOperationError("stage-write", displayPath, errorDetail(error));
  }

  let closeFailure: GuideSecondaryFailure | undefined;
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      closeFailure = {
        phase: "stage-write",
        path: displayPath,
        detail: `failed to close private stage: ${errorDetail(error)}`
      };
    }
  }

  if (primary || closeFailure || !identity) {
    const failure = primary ?? new GuideOperationError(
      "stage-write",
      displayPath,
      closeFailure?.detail ?? "exclusive stage identity was unavailable"
    );
    const secondary = closeFailure && primary ? [closeFailure] : [];
    if (identity && actualMode !== undefined) {
      const cleanup = await cleanupOwnedFiles([
        { path, identity, content, mode: actualMode }
      ], context, fileSystem, "stage-write");
      throw withSecondary(failure, [...secondary, ...cleanup]);
    }
    throw withSecondary(failure, secondary);
  }

  const owned = { path, identity, content, mode: actualMode ?? mode };
  try {
    await verifyOwnedFile(owned, context, fileSystem);
    return owned;
  } catch (error) {
    const primary = error instanceof GuideOperationError
      ? error
      : new GuideOperationError("stage-write", displayPath, errorDetail(error));
    const cleanup = await cleanupOwnedFiles([owned], context, fileSystem, "stage-write");
    throw withSecondary(primary, cleanup);
  }
}

async function readOwnedFile(
  path: string,
  displayPath: string,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<OwnedFile> {
  await guardTransaction(context, fileSystem);
  const snapshot = await readGuideTargetSnapshot(path, displayPath, fileSystem);
  await guardTransaction(context, fileSystem);
  if (!snapshot.exists || !snapshot.identity) {
    throw new GuideOperationError("rollback", displayPath, "private recovery entry is missing");
  }
  return {
    path,
    identity: nodeIdentityOfIdentity(snapshot.identity),
    content: snapshot.content,
    mode: snapshot.mode
  };
}

async function verifyOwnedFile(
  file: OwnedFile,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  const actual = await readOwnedFile(file.path, basename(file.path), context, fileSystem);
  if (!sameNodeIdentity(actual.identity, file.identity)
    || !actual.content.equals(file.content)
    || actual.mode !== file.mode) {
    throw new GuideOperationError(
      "concurrent-change",
      basename(file.path),
      "private transaction entry identity or content changed"
    );
  }
}

async function verifyTargetMatchesOwned(
  path: string,
  owned: OwnedFile,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  await guardTransaction(context, fileSystem);
  const snapshot = await readGuideTargetSnapshot(path, basename(path), fileSystem);
  await guardTransaction(context, fileSystem);
  if (!snapshot.exists
    || !snapshot.identity
    || !sameNodeIdentity(nodeIdentityOfIdentity(snapshot.identity), owned.identity)
    || !snapshot.content.equals(owned.content)
    || snapshot.mode !== owned.mode) {
    throw new GuideOperationError(
      "concurrent-change",
      basename(path),
      "committed target does not match the verified staged inode"
    );
  }
}

async function linkOwnedFile(
  source: OwnedFile,
  destination: string,
  context: TransactionContext,
  fileSystem: GuideFileSystem,
  onLinked?: () => void
): Promise<void> {
  await verifyOwnedFile(source, context, fileSystem);
  await guardTransaction(context, fileSystem);
  await fileSystem.link(source.path, destination);
  onLinked?.();
  await guardTransaction(context, fileSystem);
  let stats: GuideFileStat;
  try {
    stats = await fileSystem.lstat(destination);
  } catch (error) {
    throw new GuideOperationError("commit", basename(destination), errorDetail(error));
  }
  if (stats.isSymbolicLink()
    || !stats.isFile()
    || !sameNodeIdentity(nodeIdentityOf(stats), source.identity)) {
    throw new GuideOperationError(
      "concurrent-change",
      basename(destination),
      "conditional hard-link destination has an unexpected identity"
    );
  }
}

async function guardedRename(
  source: string,
  destination: string,
  context: TransactionContext,
  fileSystem: GuideFileSystem,
  onRenamed?: () => void
): Promise<void> {
  await guardTransaction(context, fileSystem);
  await fileSystem.rename(source, destination);
  onRenamed?.();
  await guardTransaction(context, fileSystem);
}

async function unlinkOwnedFile(
  file: OwnedFile,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  await verifyOwnedFile(file, context, fileSystem);
  await guardTransaction(context, fileSystem);
  await fileSystem.unlink(file.path);
  await guardTransaction(context, fileSystem);
}

async function assertMissingLockEntry(
  path: string,
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  await guardTransaction(context, fileSystem);
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }
  throw new GuideOperationError(
    "concurrent-change",
    basename(path),
    "private transaction destination already exists"
  );
}

async function guardTransaction(
  context: TransactionContext,
  fileSystem: GuideFileSystem
): Promise<void> {
  await assertGuideTargetDirectory(context.rootPlan, fileSystem);
  let stats: GuideFileStat;
  try {
    stats = await fileSystem.lstat(context.lockPath);
  } catch (error) {
    throw new GuideOperationError(
      "concurrent-change",
      LOCK_DIRECTORY_NAME,
      `transaction lock could not be rechecked: ${errorDetail(error)}`
    );
  }
  if (stats.isSymbolicLink()
    || !stats.isDirectory()
    || !sameNodeIdentity(nodeIdentityOf(stats), context.lockIdentity)
    || String(stats.dev) !== String(context.rootPlan.targetIdentity.dev)
    || !hasPrivateLockMode(stats.mode)) {
    throw new GuideOperationError(
      "concurrent-change",
      LOCK_DIRECTORY_NAME,
      "transaction lock identity, type, device, or mode changed"
    );
  }
}

async function revalidate(
  plans: readonly GuideTargetPlan[],
  fileSystem: GuideFileSystem,
  options: GuideTransactionOptions
): Promise<void> {
  await revalidateInputsOnly(options);
  await recheckGuideTargetPlans(plans, fileSystem);
  await revalidateInputsOnly(options);
}

async function revalidateInputsOnly(options: GuideTransactionOptions): Promise<void> {
  if (options.revalidateInputs) {
    await options.revalidateInputs();
  }
}

function lockEntryPath(context: TransactionContext, suffix: string): string {
  return join(context.lockPath, `${context.transactionId}-${suffix}`);
}

function nodeIdentityOfIdentity(identity: GuideFileIdentity): GuideNodeIdentity {
  return { dev: identity.dev, ino: identity.ino };
}

function normalizePrimary(error: unknown, phase: "commit", path: string): GuideOperationError {
  return error instanceof GuideOperationError
    ? error
    : new GuideOperationError(phase, path, errorDetail(error));
}

function withSecondary(
  primary: GuideOperationError,
  failures: readonly GuideSecondaryFailure[]
): GuideOperationError {
  if (failures.length === 0) {
    return primary;
  }
  return new GuideOperationError(
    primary.phase,
    primary.path,
    primary.detail,
    sortedFailures([...primary.secondaryFailures, ...failures])
  );
}

function sortedFailures(failures: readonly GuideSecondaryFailure[]): GuideSecondaryFailure[] {
  return [...failures].sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.phase.localeCompare(right.phase)
    || left.detail.localeCompare(right.detail)
  ));
}

function rollbackFailure(path: string, detail: string): GuideSecondaryFailure {
  return { phase: "rollback", path, detail };
}

function assertPlanSet(plans: readonly GuideTargetPlan[]): void {
  const expected = ["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"];
  if (plans.length !== expected.length
    || plans.some((plan, index) => plan.name !== expected[index])) {
    throw new TypeError("guide target plans must contain the four canonical targets in commit order");
  }
  const root = plans[0];
  if (plans.some((plan) => (
    plan.targetDir !== root.targetDir
    || !sameNodeIdentity(plan.targetIdentity, root.targetIdentity)
  ))) {
    throw new TypeError("guide target plans must share one target directory identity");
  }
}

function numericMode(value: number | bigint): number {
  return Number(value);
}

function hasPrivateLockMode(value: number | bigint): boolean {
  return process.platform === "win32" || (numericMode(value) & 0o777) === LOCK_DIRECTORY_MODE;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
