import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { parserFreeCopyCheckNames } from "./copy-calibration-config.mjs";

const root = resolve("examples/merchant-dashboard");
const outDir = resolve("runs/example-smoke");
const port = 4174;

rmSync(outDir, { recursive: true, force: true });

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodePathname(requestUrl.pathname, response);
  if (!pathname) {
    return;
  }
  const candidate = safeJoin(root, pathname === "/" ? "/index.html" : pathname);
  if (!candidate || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": mimeType(candidate) });
  createReadStream(candidate).pipe(response);
});

function decodePathname(pathname, response) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return null;
  }
}

await new Promise((resolveListen) => {
  server.listen(port, "127.0.0.1", resolveListen);
});

try {
  const cliPath = resolve("packages/cli/dist/index.js");
  const exitCode = await run(process.execPath, [
    cliPath,
    "audit",
    "--url",
    `http://127.0.0.1:${port}`,
    "--out",
    outDir
  ]);
  if (exitCode !== 0) {
    throw new Error(`No-copy example CLI exited ${exitCode}`);
  }
  assertNoCopyArtifacts();
  console.log("Example smoke passed: built CLI no-copy artifacts contain no copy-derived behavior or metadata.");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function assertNoCopyArtifacts() {
  const auditResult = JSON.parse(readFileSync(join(outDir, "audit.json"), "utf8"));
  const metadata = JSON.parse(readFileSync(join(outDir, "metadata.json"), "utf8"));
  const copyCheckNames = new Set(parserFreeCopyCheckNames);
  const copyNoticeCodes = new Set([
    "copy-analysis-capability-unavailable",
    "copy-surface-unsupported-adapter",
    "copy-surface-invalid-query"
  ]);
  if (auditResult.findings.some((finding) => copyCheckNames.has(finding.checkName))) {
    throw new Error("No-copy example emitted parser-free copy findings");
  }
  if ((auditResult.notices ?? []).some((notice) => copyNoticeCodes.has(notice.code))) {
    throw new Error("No-copy example emitted copy-derived notices");
  }
  const textItems = auditResult.evidenceAssets
    .filter((asset) => asset.type === "text-inventory")
    .flatMap((asset) => Array.isArray(asset.data?.items) ? asset.data.items : []);
  if (textItems.some((item) => item.copySurface !== undefined)) {
    throw new Error("No-copy example materialized copy surfaces");
  }
  if (metadata.toolVersions?.["@design-harness/copy-audit"] !== undefined) {
    throw new Error("No-copy example recorded copy-audit metadata");
  }
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

function safeJoin(rootDir, pathname) {
  const fullPath = normalize(join(rootDir, pathname));
  return fullPath === rootDir || fullPath.startsWith(`${rootDir}${sep}`) ? fullPath : null;
}

function mimeType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
