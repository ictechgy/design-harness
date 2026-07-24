#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { INPUT_PATHS } from "./contract.mjs";
import { validatePreservation } from "./preservation.mjs";

const [fixture, oracleBytes] = await Promise.all([
  readFile(INPUT_PATHS.fixture, "utf8"),
  readFile(INPUT_PATHS.preservationOracle, "utf8")
]);
const oracle = JSON.parse(oracleBytes);
const focusedRepair = fixture
  .replace("<html>", '<html lang="en">')
  .replace("Pending orders: {{pendingCount}}", "Pending orders: 12");

function validate(source) {
  return validatePreservation({
    source,
    oracle,
    baselineSource: fixture,
    label: "mutation fixture"
  });
}

function validateStructure(source) {
  return validatePreservation({ source, oracle, label: "structural fixture" });
}

function expectReject(name, mutate, expectedCode) {
  const result = validate(mutate(focusedRepair));
  assert.equal(result.ok, false, `${name}: preservation unexpectedly passed`);
  assert.ok(
    result.violations.some((violation) => violation.code === expectedCode),
    `${name}: expected ${expectedCode}, got ${result.violations
      .map((violation) => violation.code)
      .join(", ")}`
  );
}

function expectOracleReject(name, mutate) {
  const mutatedOracle = structuredClone(oracle);
  mutate(mutatedOracle);
  const result = validatePreservation({
    source: fixture,
    oracle: mutatedOracle,
    label: name
  });
  assert.equal(result.ok, false, `${name}: malformed oracle unexpectedly passed`);
  assert.ok(
    result.violations.some((violation) => violation.code === "invalid-oracle"),
    `${name}: expected invalid-oracle`
  );
}

assert.equal(
  validateStructure(fixture).ok,
  true,
  "controlled baseline fixture must satisfy the structural preservation oracle"
);
for (const [name, source] of [
  ["unchanged baseline", fixture],
  ["lang-only repair", fixture.replace("<html>", '<html lang="en">')],
  [
    "placeholder-only repair",
    fixture.replace(
      "Pending orders: {{pendingCount}}",
      "Pending orders: 12"
    )
  ],
  ["both permitted repairs", focusedRepair]
]) {
  assert.equal(
    validate(source).ok,
    true,
    `${name} must satisfy the closed source-delta contract`
  );
}

const emptyOracle = validatePreservation({
  source: fixture,
  oracle: {
    schemaVersion: "obedience-v1/preservation-oracle/v1",
    fixturePath: "fixture.html",
    requiredFeatures: [],
    minimumVisibleStructure: {},
    forbiddenReplacementText: []
  },
  label: "empty oracle"
});
assert.equal(emptyOracle.ok, false, "an empty preservation oracle must fail closed");
assert.ok(
  emptyOracle.violations.some((violation) => violation.code === "invalid-oracle"),
  "an empty preservation oracle must report invalid-oracle"
);
expectOracleReject("missing structure minima", (value) => {
  value.minimumVisibleStructure = {};
});
expectOracleReject("non-integer structure minimum", (value) => {
  value.minimumVisibleStructure.minimumFeatureCount = "15";
});
expectOracleReject("negative structure minimum", (value) => {
  value.minimumVisibleStructure.minimumFeatureCount = -1;
});
expectOracleReject("unexpected top-level key", (value) => {
  value.requiredFeature = value.requiredFeatures[0];
});
expectOracleReject("missing top-level key", (value) => {
  delete value.forbiddenReplacementText;
});
expectOracleReject("unknown feature key", (value) => {
  value.requiredFeatures[0].selecter =
    value.requiredFeatures[0].selector;
});
expectOracleReject("missing feature selector", (value) => {
  delete value.requiredFeatures[0].selector;
});
expectOracleReject("selector not derived from marker", (value) => {
  value.requiredFeatures[0].selector = "header";
});
expectOracleReject("wrong optional feature type", (value) => {
  value.requiredFeatures[1].minimumVisibleTextCharacters = "8";
});
expectOracleReject("duplicate feature marker", (value) => {
  value.requiredFeatures.push(structuredClone(value.requiredFeatures[0]));
});

assert.equal(
  validate(focusedRepair).ok,
  true,
  "focused lang/interpolation repair must satisfy preservation"
);

expectReject(
  "deleted heading",
  (source) =>
    source.replace(
      '      <h1 data-benchmark-feature="primary-heading">Operations overview</h1>\n',
      ""
    ),
  "missing-feature"
);

expectReject(
  "duplicated control",
  (source) =>
    source.replace(
      '          <button type="button" data-benchmark-feature="refresh-action">Refresh orders</button>',
      '          <button type="button" data-benchmark-feature="refresh-action">Refresh orders</button>\n' +
        '          <button type="button" data-benchmark-feature="refresh-action">Refresh orders</button>'
    ),
  "duplicate-feature"
);

expectReject(
  "hidden required node",
  (source) =>
    source.replace(
      '<main data-benchmark-feature="app-shell">',
      '<main hidden data-benchmark-feature="app-shell">'
    ),
  "hidden-feature"
);

expectReject(
  "aria-hidden ancestor",
  (source) => source.replace("<body>", '<body aria-hidden="true">'),
  "hidden-feature"
);

expectReject(
  "inert ancestor",
  (source) => source.replace("<body>", "<body inert>"),
  "hidden-feature"
);

expectReject(
  "stylesheet hiding",
  (source) =>
    source.replace(
      "      body {\n        margin: 0;",
      "      body {\n        display: none;\n        margin: 0;"
    ),
  "hidden-feature"
);

expectReject(
  "unsupported pseudo-selector hiding",
  (source) =>
    source.replace(
      "    </style>",
      "      body:not(.never) { display: none; }\n    </style>"
    ),
  "unsupported-hiding-selector"
);

expectReject(
  "unclosed hiding rule",
  (source) =>
    source.replace(
      "    </style>",
      "      body { display: none\n    </style>"
    ),
  "invalid-css"
);

expectReject(
  "off-screen transform hiding",
  (source) =>
    source.replace(
      "      body {\n        margin: 0;",
      "      body {\n        transform: translateX(-9999px);\n        margin: 0;"
    ),
  "hidden-feature"
);

expectReject(
  "clip-path hiding",
  (source) =>
    source.replace(
      "      body {\n        margin: 0;",
      "      body {\n        clip-path: inset(100%);\n        margin: 0;"
    ),
  "hidden-feature"
);

expectReject(
  "filter opacity hiding",
  (source) =>
    source.replace(
      "      body {\n        margin: 0;",
      "      body {\n        filter: opacity(0);\n        margin: 0;"
    ),
  "hidden-feature"
);

expectReject(
  "zero-sized required control",
  (source) =>
    source.replace(
      '            data-benchmark-feature="search-input"',
      '            style="width: 0; height: 0"\n            data-benchmark-feature="search-input"'
    ),
  "hidden-feature"
);

expectReject(
  "off-screen required status",
  (source) =>
    source.replace(
      '<p role="status" aria-live="polite" data-benchmark-feature="status-content">',
      '<p role="status" aria-live="polite" style="position:absolute;left:-9999px" data-benchmark-feature="status-content">'
    ),
  "hidden-feature"
);

expectReject(
  "empty meaningful heading",
  (source) =>
    source.replace(
      '<h1 data-benchmark-feature="primary-heading">Operations overview</h1>',
      '<h1 data-benchmark-feature="primary-heading"></h1>'
    ),
  "required-text-changed"
);

expectReject(
  "generic meaningful heading",
  (source) =>
    source.replace(
      '<h1 data-benchmark-feature="primary-heading">Operations overview</h1>',
      '<h1 data-benchmark-feature="primary-heading">Page</h1>'
    ),
  "required-text-changed"
);

expectReject(
  "text hidden in required heading descendant",
  (source) =>
    source.replace(
      '<h1 data-benchmark-feature="primary-heading">Operations overview</h1>',
      '<h1 data-benchmark-feature="primary-heading"><span hidden>Operations overview</span></h1>'
    ),
  "required-text-changed"
);

expectReject(
  "deleted search field",
  (source) =>
    source.replace(
      /          <input\n            id="order-search"[\s\S]*?            data-benchmark-feature="search-input"\n          >\n/,
      ""
    ),
  "missing-feature"
);

expectReject(
  "deleted image",
  (source) =>
    source.replace(
      /          <img\n            src="data:image\/gif[\s\S]*?            data-benchmark-feature="queue-image"\n          >\n/,
      ""
    ),
  "missing-feature"
);

expectReject(
  "static passed replacement",
  () =>
    '<!doctype html><html lang="en"><head><title>Result</title></head><body>All checks passed</body></html>',
  "static-result-replacement"
);

expectReject(
  "renamed marker",
  (source) =>
    source.replace(
      'data-benchmark-feature="status-content"',
      'data-benchmark-feature="status-output"'
    ),
  "missing-feature"
);

expectReject(
  "lost image alternative",
  (source) => source.replace('alt="Order queue volume preview"', 'alt=""'),
  "alternative-text-changed"
);

expectReject(
  "lost search label relationship",
  (source) => source.replace('for="order-search"', 'for="missing-search"'),
  "label-relationship-changed"
);

expectReject(
  "script element",
  (source) =>
    source.replace(
      "  </body>",
      "    <script>console.log('unexpected')</script>\n  </body>"
    ),
  "script-content-not-allowed"
);

expectReject(
  "external stylesheet",
  (source) =>
    source.replace(
      "  </head>",
      '    <link rel="stylesheet" href="https://example.invalid/hide.css">\n  </head>'
    ),
  "external-stylesheet-not-allowed"
);

expectReject(
  "stylesheet import",
  (source) =>
    source.replace(
      "    </style>",
      '      @import url("https://example.invalid/hide.css");\n    </style>'
    ),
  "unsupported-css-feature"
);

expectReject(
  "scoped stylesheet escape",
  (source) =>
    source.replace(
      "    </style>",
      "      @scope (body) { main { display: none; } }\n    </style>"
    ),
  "unsupported-css-feature"
);

expectReject(
  "CSS variable hiding escape",
  (source) =>
    source.replace(
      "      body {\n        margin: 0;",
      "      body {\n        --hidden-display: none;\n        display: var(--hidden-display);\n        margin: 0;"
    ),
  "unsupported-css-feature"
);

expectReject(
  "unrelated trailing byte",
  (source) => `${source}x`,
  "unexpected-source-delta"
);

expectReject(
  "runtime page destruction",
  (source) =>
    source.replace(
      "  </body>",
      '    <script>document.body.replaceChildren();</script>\n  </body>'
    ),
  "script-content-not-allowed"
);

console.log(
  "Validated obedience-v1 exact repair delta, 28 source mutations, and eleven malformed-oracle cases."
);
