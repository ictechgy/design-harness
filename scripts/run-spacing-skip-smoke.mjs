// Live gate: the spacing check must not scold the standard screen-reader-only idiom.
//
// Accessible markup hides text from sight while keeping it readable by assistive
// technology using a 1x1 px box pushed out of the way (position:absolute; width:1px;
// height:1px; margin:-1px; clip). Tailwind ships it as `sr-only`. Those -1px margins
// are not a spacing-scale decision, and flagging them means the check complains most
// where the markup is most correct.
//
// Measured 2026-07-27 on two real pages: 12 of 20 off-scale findings were this one
// idiom, four sides times two viewports. Because findings are capped at five groups per
// viewport, the noise was also crowding out genuine violations — removing it surfaced
// seven real ones that had been truncated away.
//
// The committed ui-quality fixtures cannot host this case: all five spacing fixtures sit
// inside the pinned closure of examples/ui-quality-fixtures/visual-metrics-calibration.json,
// so editing them would change corpus hashes. This fixture is therefore temporary.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const cliPath = resolve(repoRoot, "packages/cli/dist/index.js");
const outRoot = resolve(repoRoot, "runs/spacing-skip-smoke");
const tempRoot = await mkdtemp(join(tmpdir(), "design-harness-spacing-skip-smoke-"));
const fixturePath = join(tempRoot, "sr-only.html");
const guidePath = join(tempRoot, "design-guide.yaml");

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });
await writeFile(fixturePath, srOnlyFixture());
await writeFile(guidePath, guide());

const server = createServer(async (request, response) => {
  try {
    const source = await readFile(fixturePath);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
    response.end(source);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8", connection: "close" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

let failure;
try {
  await listen(server);
  const address = server.address();
  assert(address && typeof address === "object", "Spacing skip smoke server did not expose a TCP address");
  const url = `http://127.0.0.1:${address.port}/`;
  const outDir = join(outRoot, "audit");

  const exitCode = await run(process.execPath, [
    cliPath,
    "audit",
    "--url",
    url,
    "--out",
    outDir,
    "--guide",
    guidePath
  ], { cwd: repoRoot });
  assert(exitCode === 0, `Audit exited ${exitCode}; expected 0`);

  const audit = JSON.parse(await readFile(join(outDir, "audit.json"), "utf8"));
  const spacingFindings = (audit.findings ?? []).filter(
    (finding) => finding.checkName === "off-scale-spacing"
  );

  // The sr-only span carries margin:-1px on all four sides. The declared scale holds
  // only 8px and 16px, so an unskipped -1px would be reported.
  const negative = spacingFindings.filter(
    (finding) => Number(finding.observed?.unexpectedValuePx) === -1
  );
  if (negative.length > 0) {
    throw new Error(
      `${negative.length} off-scale finding(s) reported the screen-reader-only -1px margin: `
      + JSON.stringify(negative.map((finding) => finding.observed?.property))
    );
  }

  // The skip must be disclosed, not silent, and must be attributed to this exact reason.
  const skipNotices = (audit.notices ?? []).filter(
    (notice) => notice.code === "spacing-adherence-slots-skipped"
  );
  const hiddenSkips = skipNotices.reduce(
    (total, notice) => total + Number(notice.details?.skippedByReason?.["visually-hidden-box"] ?? 0),
    0
  );
  assert(
    hiddenSkips > 0,
    "No visually-hidden-box skip was recorded; the fixture no longer exercises the idiom "
    + "and this gate would pass vacuously"
  );

  // The check must still work: the deliberately off-scale 5px padding has to be found.
  const offScale = spacingFindings.filter(
    (finding) => Number(finding.observed?.unexpectedValuePx) === 5
  );
  assert(
    offScale.length > 0,
    "The 5px off-scale padding was not reported; the skip is suppressing real violations"
  );

  console.log(
    `Spacing skip smoke passed: ${hiddenSkips} slot(s) skipped as visually-hidden-box, `
    + `0 screen-reader-only margins reported, ${offScale.length} genuine off-scale finding(s) retained.`
  );
} catch (error) {
  failure = error;
} finally {
  await close(server);
  await rm(tempRoot, { recursive: true, force: true });
}

if (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}

function srOnlyFixture() {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>Screen-reader-only spacing smoke</title>",
    "  <style>",
    "    body{margin:0;background:#ffffff;color:#111111;font:16px/1.5 sans-serif}",
    "    main{padding:16px}",
    "    .stack{display:flex;flex-direction:column;gap:8px}",
    "    .card{padding:8px;background:#ffffff}",
    "    /* deliberately outside the declared scale */",
    "    .off-scale{padding:5px}",
    "    /* the standard screen-reader-only idiom */",
    "    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;",
    "      overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    '    <div class="stack">',
    '      <div class="card">Readable card</div>',
    '      <div class="off-scale">Off-scale padding</div>',
    "    </div>",
    '    <span class="sr-only" aria-live="polite">Language changed to English</span>',
    "  </main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

function guide() {
  return [
    'schemaVersion: "0.2"',
    "tokens:",
    "  color:",
    "    semantic:",
    "      $type: color",
    "      background:",
    "        $value: { colorSpace: srgb, components: [1, 1, 1], alpha: 1 }",
    "      surface:",
    "        $value: { colorSpace: srgb, components: [1, 1, 1], alpha: 1 }",
    "      text:",
    "        $value: { colorSpace: srgb, components: [0.066666667, 0.066666667, 0.066666667], alpha: 1 }",
    "      accent:",
    "        $value: { colorSpace: srgb, components: [0.066666667, 0.066666667, 0.066666667], alpha: 1 }",
    "  font:",
    "    family:",
    "      $type: fontFamily",
    "      heading:",
    '        $value: ["sans-serif"]',
    "      body:",
    '        $value: ["sans-serif"]',
    "  spacing:",
    "    $type: dimension",
    "    sm:",
    "      $value: { value: 8, unit: px }",
    "    md:",
    "      $value: { value: 16, unit: px }",
    "  radius:",
    "    $type: dimension",
    "    none:",
    "      $value: { value: 0, unit: px }",
    "    md:",
    "      $value: { value: 8, unit: px }",
    "prohibitions:",
    "  - generic-card-grid",
    'signatureElement: "Use a single restrained card treatment as the recurring product signature."',
    ""
  ].join("\n");
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
