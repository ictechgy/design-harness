import { createReadStream, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
  SCHEMA_VERSION,
  renderMarkdownReport
} from "../packages/core/dist/index.js";
import { auditUrl } from "../packages/visual-audit/dist/index.js";

const fixtureRoot = resolve("examples/ui-quality-fixtures/korean");
const outRoot = resolve("runs/copy-smoke");
const desktop = {
  name: "desktop",
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false
};
const explicitRoleEvidence = "unknown-token SWITCH checkbox";
const nonMatchingWebDomSelector = "[data-design-harness-never-match='role-smoke']";
const copyStyle = {
  schemaVersion: SCHEMA_VERSION,
  locale: "ko-KR",
  surfaceMapping: [
    {
      surface: "button",
      matchers: [
        { kind: "role", value: "switch" },
        { kind: "role", value: "button" },
        { kind: "adapter", adapter: "web-dom", value: "button" }
      ]
    },
    {
      surface: "error",
      matchers: [{ kind: "adapter", adapter: "native-ui", value: "status" }]
    },
    {
      surface: "marketing",
      matchers: [{ kind: "adapter", adapter: "web-dom", value: "[" }]
    },
    {
      surface: "body",
      matchers: [
        { kind: "adapter", adapter: "web-dom", value: "main p" },
        { kind: "adapter", adapter: "web-dom", value: "p" }
      ]
    },
    {
      surface: "marketing",
      matchers: [{ kind: "adapter", adapter: "web-dom", value: "p" }]
    },
    {
      surface: "marketing",
      matchers: [{ kind: "adapter", adapter: "web-dom", value: "h1" }]
    },
    {
      surface: "marketing",
      matchers: [{ kind: "adapter", adapter: "web-dom", value: nonMatchingWebDomSelector }]
    }
  ],
  glossary: [
    {
      term: "해지",
      tier: "banned",
      preferredTerm: "탈퇴",
      match: "literal",
      surfaces: ["body"]
    },
    {
      term: "혁신적인",
      tier: "use-carefully",
      preferredTerm: "새",
      match: "literal",
      surfaces: ["body"]
    }
  ],
  bannedPhrases: [
    {
      phrase: "무조건 성공",
      suggestedReplacement: "예상 결과를 확인할 수 있습니다",
      surfaces: ["body"]
    }
  ]
};

rmSync(outRoot, { recursive: true, force: true });

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodePathname(requestUrl.pathname, response);
  if (!pathname) {
    return;
  }
  const candidate = safeJoin(fixtureRoot, pathname);
  if (!candidate || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": mimeType(candidate) });
  createReadStream(candidate).pipe(response);
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Copy smoke server did not expose a TCP port.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const bad = await auditFixture("bad", `${baseUrl}/copy-bad.html`, copyStyle);
  const good = await auditFixture("good", `${baseUrl}/copy-good.html`, {
    ...copyStyle,
    josaHedgePolicy: "allow"
  });
  const noCopy = await auditFixture("no-copy", `${baseUrl}/copy-good.html`);

  assertBadResult(bad.auditResult);
  assertGoodResult(good.auditResult);
  assertNoCopyResult(noCopy.auditResult);
  console.log("Copy smoke passed: bad=5 findings/63.2, good=0 findings/100, role evidence and surface provenance verified.");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function auditFixture(name, url, style) {
  const outDir = join(outRoot, name);
  const result = await auditUrl({
    url,
    outDir,
    viewportPresets: [desktop],
    copyStyle: style
  });
  writeFileSync(join(outDir, "audit.json"), `${JSON.stringify(result.auditResult, null, 2)}\n`);
  writeFileSync(join(outDir, "metadata.json"), `${JSON.stringify(result.metadata, null, 2)}\n`);
  writeFileSync(join(outDir, "report.md"), renderMarkdownReport({ auditResult: result.auditResult }));
  return result;
}

function assertBadResult(auditResult) {
  const expectedChecks = [
    "placeholder-leak",
    "josa-hedge",
    "glossary-banned-term",
    "glossary-use-carefully-term",
    "banned-phrase"
  ];
  assert(auditResult.status === "success", `bad fixture status was ${auditResult.status}`);
  assert(auditResult.failedChecks.length === 0, "bad fixture recorded failed checks");
  assert(auditResult.findings.length === 5, `bad fixture emitted ${auditResult.findings.length} findings`);
  assert(
    JSON.stringify(auditResult.findings.map((finding) => finding.checkName)) === JSON.stringify(expectedChecks),
    `bad fixture check order was ${auditResult.findings.map((finding) => finding.checkName).join(", ")}`
  );
  assert(auditResult.advisoryScore.value === 63.2, `bad fixture score was ${auditResult.advisoryScore.value}`);
  assert(auditResult.advisoryScore.band === "needs-work", `bad fixture band was ${auditResult.advisoryScore.band}`);
  assert(
    sum(auditResult.advisoryScore.deductions.map((deduction) => deduction.points)) === 36.8,
    "bad fixture deduction was not 36.8"
  );
  assert(
    auditResult.findings.every((finding) => (
      finding.viewport === "desktop" &&
      finding.evidenceRefs.length === 1 &&
      finding.evidenceRefs[0] === "text-inventory-desktop"
    )),
    "bad fixture findings did not use the exact desktop text-inventory evidence"
  );
  assertNoticeAndSurfaceContract(auditResult);
}

function assertGoodResult(auditResult) {
  assert(auditResult.status === "success", `good fixture status was ${auditResult.status}`);
  assert(auditResult.failedChecks.length === 0, "good fixture recorded failed checks");
  assert(auditResult.findings.length === 0, `good fixture emitted ${auditResult.findings.length} findings`);
  assert(auditResult.advisoryScore.value === 100, `good fixture score was ${auditResult.advisoryScore.value}`);
  assert(auditResult.advisoryScore.band === "strong", `good fixture band was ${auditResult.advisoryScore.band}`);
  assertNoticeAndSurfaceContract(auditResult);
}

function assertNoCopyResult(auditResult) {
  assert(auditResult.status === "success", `no-copy fixture status was ${auditResult.status}`);
  assert((auditResult.notices?.length ?? 0) === 0, "no-copy audit emitted notices");
  const items = textInventoryItems(auditResult);
  const multiRoleItem = items.find((item) => item.selector === "#multi-role-copy");
  assert(multiRoleItem?.role === explicitRoleEvidence, `no-copy evidence role was ${multiRoleItem?.role}`);
  assert(items.every((item) => item.copySurface === undefined), "no-copy audit materialized a copy surface");
}

function assertNoticeAndSurfaceContract(auditResult) {
  const noticeCodes = auditResult.notices?.map((notice) => notice.code).sort() ?? [];
  assert(
    JSON.stringify(noticeCodes) === JSON.stringify([
      "copy-surface-invalid-query",
      "copy-surface-unsupported-adapter"
    ]),
    `notice codes were ${noticeCodes.join(", ")}`
  );
  assert(auditResult.notices?.every((notice) => notice.viewport === undefined), "configuration notices retained viewport");

  const items = textInventoryItems(auditResult);
  const bodyItem = items.find((item) => item.copySurface?.surface === "body");
  assert(bodyItem?.copySurface?.surface === "body", "body copy surface was not materialized");
  assert(bodyItem.copySurface.ruleIndex === 3, `body copy surface rule index was ${bodyItem.copySurface.ruleIndex}`);
  assert(bodyItem.copySurface.matcher?.value === "main p", "first matching web-dom matcher provenance was not retained");

  const buttonItem = items.find((item) => item.tag === "button" && item.role === "button");
  assert(buttonItem?.copySurface?.surface === "button", "native button role was not materialized");
  assert(buttonItem.copySurface.ruleIndex === 0, `button copy surface rule index was ${buttonItem.copySurface.ruleIndex}`);
  assert(buttonItem.copySurface.matcher?.kind === "role", "role matcher did not win before the matching adapter binding");
  assert(buttonItem.copySurface.matcher?.value === "button", "native button did not use the button role matcher");

  const multiRoleItem = items.find((item) => item.selector === "#multi-role-copy");
  assert(multiRoleItem?.role === explicitRoleEvidence, `serialized explicit role was ${multiRoleItem?.role}`);
  assert(multiRoleItem.copySurface?.surface === "button", "multi-token explicit role did not resolve a copy surface");
  assert(multiRoleItem.copySurface.ruleIndex === 0, `multi-token role rule index was ${multiRoleItem.copySurface.ruleIndex}`);
  assert(multiRoleItem.copySurface.matcher?.kind === "role", "multi-token role did not use a role matcher");
  assert(multiRoleItem.copySurface.matcher?.value === "switch", "multi-token role did not resolve to the first concrete role");

  const unmatchedItem = items.find((item) => item.text === "매핑되지 않은 참고 문구");
  assert(unmatchedItem !== undefined, "unmatched reference copy was not captured");
  assert(unmatchedItem.copySurface === undefined, "unmatched reference copy received an implicit surface");
  assert(
    items.every((item) => item.copySurface?.matcher?.value !== nonMatchingWebDomSelector),
    "valid non-matching web-dom selector assigned a copy surface"
  );
}

function textInventoryItems(auditResult) {
  const textEvidence = auditResult.evidenceAssets.find((asset) => asset.id === "text-inventory-desktop");
  const items = textEvidence?.data?.items;
  assert(Array.isArray(items), "desktop text inventory items were not recorded");
  return items;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sum(values) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 10) / 10;
}

function decodePathname(pathname, response) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return null;
  }
}

function safeJoin(rootDir, pathname) {
  const fullPath = normalize(join(rootDir, pathname));
  return fullPath === rootDir || fullPath.startsWith(`${rootDir}${sep}`) ? fullPath : null;
}

function mimeType(filePath) {
  return extname(filePath) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
}
