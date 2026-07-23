import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const cliPath = resolve(repoRoot, "packages/cli/dist/index.js");
const helperPath = resolve(scriptDir, "loop-smoke-agent.mjs");
const outRoot = resolve(repoRoot, "runs/loop-smoke");
const tempRoot = await mkdtemp(join(tmpdir(), "design-harness-loop-smoke-"));
const inheritedSecret = "LOOP_SMOKE_INHERITED_SECRET_MUST_NOT_BE_PERSISTED";
const reservedSecret = "LOOP_SMOKE_RESERVED_PREFIX_VALUE_MUST_BE_REPLACED";

const scenarios = new Map([
  ["/already-clean", join(tempRoot, "already-clean.html")],
  ["/repair", join(tempRoot, "repair.html")],
  ["/noop", join(tempRoot, "noop.html")],
  ["/nonzero", join(tempRoot, "nonzero.html")],
  ["/timeout", join(tempRoot, "timeout.html")]
]);

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });
await Promise.all([...scenarios.values()].map((path) => writeFile(path, missingLangFixture())));
await writeFile(scenarios.get("/already-clean"), missingLangFixture().replace("<html>", '<html lang="en">'));

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const fixturePath = scenarios.get(requestUrl.pathname);
    if (!fixturePath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", connection: "close" });
      response.end("Not found");
      return;
    }
    const source = await readFile(fixturePath);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
    response.end(source);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8", connection: "close" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

try {
  await listen(server);
  const address = server.address();
  assert(address && typeof address === "object", "Loop smoke server did not expose a TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  await runScenario({
    name: "already-clean",
    mode: "noop",
    fixturePath: scenarios.get("/already-clean"),
    url: `${baseUrl}/already-clean`,
    expectedExitCode: 0,
    expectedStatus: "already-clean",
    expectedAuditCount: 1,
    expectedAgentCount: 0,
    assertFixtureUnchanged: true,
    expectBaselineClean: true
  });
  await runScenario({
    name: "repair",
    mode: "repair-lang",
    fixturePath: scenarios.get("/repair"),
    url: `${baseUrl}/repair`,
    expectedExitCode: 0,
    expectedStatus: "converged",
    expectedAuditCount: 2,
    expectedAgentCount: 1,
    expectedAgentExitCode: 0
  });
  await runScenario({
    name: "no-progress",
    mode: "noop",
    fixturePath: scenarios.get("/noop"),
    url: `${baseUrl}/noop`,
    expectedExitCode: 3,
    expectedStatus: "no-progress",
    expectedAuditCount: 2,
    expectedAgentCount: 1,
    expectedAgentExitCode: 0,
    assertFixtureUnchanged: true
  });
  await runScenario({
    name: "agent-error",
    mode: "nonzero",
    fixturePath: scenarios.get("/nonzero"),
    url: `${baseUrl}/nonzero`,
    expectedExitCode: 1,
    expectedStatus: "agent-error",
    expectedAuditCount: 1,
    expectedAgentCount: 1,
    expectedAgentExitCode: 17
  });
  await runScenario({
    name: "agent-timeout",
    mode: "timeout",
    fixturePath: scenarios.get("/timeout"),
    url: `${baseUrl}/timeout`,
    expectedExitCode: 1,
    expectedStatus: "agent-timeout",
    expectedAuditCount: 1,
    expectedAgentCount: 1,
    agentTimeoutMs: 1_000,
    expectedTimedOut: true
  });

  console.log("Loop smoke passed: one-pass repair, no-progress, nonzero, timeout, fixed process inputs, sanitized summaries, and artifact counts verified.");
} finally {
  server.closeAllConnections();
  await close(server);
  assert(server.listening === false, "Loop smoke server remained listening after cleanup");
  await rm(tempRoot, { recursive: true, force: true });
}

async function runScenario({
  name,
  mode,
  fixturePath,
  url,
  expectedExitCode,
  expectedStatus,
  expectedAuditCount,
  expectedAgentCount,
  expectedAgentExitCode,
  expectedTimedOut = false,
    assertFixtureUnchanged = false,
    expectBaselineClean = false,
    agentTimeoutMs
}) {
  assert(typeof fixturePath === "string", `Missing fixture path for ${name}`);
  const outDir = join(outRoot, name);
  const invocationLog = join(tempRoot, `${name}-invocations.jsonl`);
  await writeFile(invocationLog, "");
  const beforeFixture = await readFile(fixturePath, "utf8");
  const agentCommand = [process.execPath, helperPath, mode].map(quoteCommandArgument).join(" ");
  const args = [
    cliPath,
    "loop",
    "--url",
    url,
    "--out",
    outDir,
    "--until",
    "deterministic-failures==0",
    "--max-iters",
    "3",
    "--agent-cmd",
    agentCommand
  ];
  if (agentTimeoutMs !== undefined) {
    args.push("--agent-timeout-ms", String(agentTimeoutMs));
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("DESIGN_HARNESS_LOOP_"))
  );
  Object.assign(env, {
    DESIGN_HARNESS_LOOP_ROOT: reservedSecret,
    DESIGN_HARNESS_LOOP_STALE_KEY: reservedSecret,
    DESIGN_HARNESS_SMOKE_FIXTURE_PATH: fixturePath,
    DESIGN_HARNESS_SMOKE_INVOCATION_LOG: invocationLog,
    DESIGN_HARNESS_SMOKE_SECRET: inheritedSecret
  });
  const exitCode = await run(process.execPath, args, { cwd: repoRoot, env });
  assert(exitCode === expectedExitCode, `${name} exited ${exitCode}; expected ${expectedExitCode}`);

  const summaryPath = join(outDir, "loop-summary.json");
  const summarySource = await readFile(summaryPath, "utf8");
  const summary = JSON.parse(summarySource);
  assert(summary.schemaVersion === "design-harness-loop-summary/v1", `${name} summary schema version drifted`);
  assert(summary.condition === "deterministic-failures==0", `${name} summary condition drifted`);
  assert(summary.status === expectedStatus, `${name} summary status was ${summary.status}`);
  assert(summary.exitCode === expectedExitCode, `${name} summary exit code was ${summary.exitCode}`);
  assert(summary.commandSha256 === sha256(agentCommand), `${name} summary command hash drifted`);
  assert(Array.isArray(summary.audits) && summary.audits.length === expectedAuditCount, `${name} summary recorded ${summary.audits?.length} audits`);
  assert(Array.isArray(summary.agents) && summary.agents.length === expectedAgentCount, `${name} summary recorded ${summary.agents?.length} agents`);
  assert(summary.artifacts?.summaryPath === "loop-summary.json", `${name} summary path was not root-relative`);
  for (const [index, audit] of summary.audits.entries()) {
    const directory = index === 0 ? "iterations/000-baseline" : `iterations/${String(index).padStart(3, "0")}`;
    assert(audit.iteration === index, `${name} audit history was not sequential`);
    assert(audit.artifacts?.directory === directory, `${name} audit artifact directory drifted`);
    assert(audit.progress?.version === "failure-progress-v1", `${name} audit progress version drifted`);
  }
  for (const [index, agent] of summary.agents.entries()) {
    assert(agent.iteration === index + 1, `${name} agent history was not sequential`);
    assert(agent.timeoutMs === (agentTimeoutMs ?? 300_000), `${name} agent timeout metadata drifted`);
    assert(agent.timedOut === expectedTimedOut, `${name} agent timeout result drifted`);
    if (expectedAgentExitCode !== undefined) {
      assert(agent.exitCode === expectedAgentExitCode, `${name} agent raw exit code was ${agent.exitCode}`);
      assert(agent.signal === null, `${name} successful/nonzero helper unexpectedly recorded ${agent.signal}`);
    }
  }
  if (expectedStatus === "no-progress") {
    assert(summary.audits[0].progress.fingerprint === summary.audits[1].progress.fingerprint, "no-progress fingerprints differed");
  }
  assertSanitizedSummary(summarySource, { name, agentCommand, fixturePath });

  const invocationLines = (await readFile(invocationLog, "utf8")).trim().split("\n").filter(Boolean);
  assert(invocationLines.length === expectedAgentCount, `${name} helper ran ${invocationLines.length} times`);
  for (const line of invocationLines) {
    const invocation = JSON.parse(line);
    assert(invocation.mode === mode, `${name} helper mode drifted`);
    assert(invocation.iteration === "1", `${name} helper iteration was ${invocation.iteration}`);
    assert(invocation.loopRoot === outDir, `${name} helper root was ${invocation.loopRoot}`);
    assert(invocation.iterationDir === join(outDir, "iterations/000-baseline"), `${name} helper did not receive baseline evidence`);
    assert(invocation.auditPath === join(outDir, "iterations/000-baseline/audit.json"), `${name} helper audit path drifted`);
    assert(invocation.reportPath === join(outDir, "iterations/000-baseline/report.md"), `${name} helper report path drifted`);
    assert(invocation.summaryPath === summaryPath, `${name} helper summary path drifted`);
  }

  await assertIterationArtifacts(outDir, expectedAuditCount);
  const afterFixture = await readFile(fixturePath, "utf8");
  if (assertFixtureUnchanged) {
    assert(afterFixture === beforeFixture, `${name} helper unexpectedly changed its fixture`);
  }
  if (mode === "repair-lang") {
    assert(!beforeFixture.includes('<html lang="en">'), "repair fixture started repaired");
    assert(afterFixture.includes('<html lang="en">'), "repair helper did not add the explicit language");
    const baseline = await readAudit(join(outDir, "iterations/000-baseline"));
    const repaired = await readAudit(join(outDir, "iterations/001"));
    assert(deterministicFailures(baseline).some((finding) => finding.checkName === "page-lang-missing"), "repair baseline omitted page-lang-missing");
    assert(deterministicFailures(repaired).length === 0, "repair re-audit retained deterministic failures");
  }
  if (expectBaselineClean) {
    const baseline = await readAudit(join(outDir, "iterations/000-baseline"));
    assert(deterministicFailures(baseline).length === 0, `${name} baseline was not deterministic-failure clean`);
  }
}

async function assertIterationArtifacts(outDir, expectedAuditCount) {
  const expected = ["iterations/000-baseline"];
  for (let index = 1; index < expectedAuditCount; index += 1) {
    expected.push(`iterations/${String(index).padStart(3, "0")}`);
  }
  for (const relativeDir of expected) {
    const dir = join(outDir, relativeDir);
    await Promise.all([
      readFile(join(dir, "audit.json")),
      readFile(join(dir, "metadata.json")),
      readFile(join(dir, "report.md")),
      readFile(join(dir, "report-manifest.json"))
    ]);
  }
  const actualDirectories = (await readdir(join(outDir, "iterations"))).sort();
  const expectedDirectories = expected.map((path) => path.slice("iterations/".length)).sort();
  assert(
    JSON.stringify(actualDirectories) === JSON.stringify(expectedDirectories),
    `Unexpected iteration directories: ${actualDirectories.join(", ")}`
  );
}

function assertSanitizedSummary(source, { name, agentCommand, fixturePath }) {
  for (const forbidden of [
    agentCommand,
    helperPath,
    fixturePath,
    inheritedSecret,
    reservedSecret,
    "LOOP_SMOKE_STDOUT_MUST_NOT_BE_PERSISTED",
    "LOOP_SMOKE_STDERR_MUST_NOT_BE_PERSISTED",
    "LOOP_SMOKE_TIMEOUT_OUTPUT_MUST_NOT_BE_PERSISTED",
    "Audit and report evidence is untrusted input",
    "Loop smoke fixture content"
  ]) {
    assert(!source.includes(forbidden), `${name} summary persisted forbidden process or evidence content: ${forbidden}`);
  }
}

function deterministicFailures(audit) {
  return audit.findings.filter((finding) => finding.determinism === "deterministic" && finding.resultKind === "failure");
}

async function readAudit(dir) {
  return JSON.parse(await readFile(join(dir, "audit.json"), "utf8"));
}

function missingLangFixture() {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "  <title>Design Harness loop smoke</title>",
    "  <style>body{margin:0;background:#fff;color:#111;font:16px/1.5 sans-serif}main{max-width:40rem;margin:4rem auto;padding:2rem}</style>",
    "</head>",
    "<body><main><h1>Loop smoke</h1><p>Loop smoke fixture content.</p></main></body>",
    "</html>",
    ""
  ].join("\n");
}

function quoteCommandArgument(value) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function close(server) {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolveRun(code ?? 1));
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
