import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const exactTriggerBlock = [
  "on:",
  "  workflow_dispatch:",
  "  push:",
  "    branches:",
  "      - main",
  "  pull_request:"
].join("\n");

function extractTriggerBlock(source, label) {
  const lines = source.split(/\r?\n/);
  const onIndexes = lines.flatMap((line, index) =>
    /^on:[ \t]*(?:#.*)?$/.test(line) ? [index] : []
  );
  if (onIndexes.length !== 1) {
    throw new Error(`${label} must contain exactly one top-level on: block.`);
  }

  const block = [];
  for (let index = onIndexes[0]; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > onIndexes[0] && !/^\s*(?:#.*)?$/.test(line) && /^\S/.test(line)) {
      break;
    }
    const normalized = line.replace(/\s+#.*$/, "").trimEnd();
    if (normalized !== "" && !/^\s*#/.test(normalized)) {
      block.push(normalized);
    }
  }
  return block.join("\n");
}

function assertExactTriggerPolicy(source, label) {
  const actualTriggerBlock = extractTriggerBlock(source, label);
  if (actualTriggerBlock !== exactTriggerBlock) {
    throw new Error(
      `${label} must trigger only on workflow_dispatch, pull_request, and pushes to main.\n` +
        `Expected:\n${exactTriggerBlock}\nFound:\n${actualTriggerBlock}`
    );
  }
}

function runTriggerPolicyGuardRegressions() {
  const fixture = `${exactTriggerBlock}\n\npermissions:\n  contents: read\n`;
  assertExactTriggerPolicy(fixture, "Trigger policy guard fixture");

  const mutations = [
    ["an extra push branch", (source) => source.replace("      - main", "      - main\n      - codex/**")],
    ["an extra event", (source) => source.replace("  pull_request:", "  pull_request:\n  schedule:")],
    [
      "a pull-request branch filter",
      (source) => source.replace("  pull_request:", "  pull_request:\n    branches:\n      - main")
    ],
    ["a missing manual trigger", (source) => source.replace("  workflow_dispatch:\n", "")]
  ];

  for (const [label, mutate] of mutations) {
    const mutated = mutate(fixture);
    try {
      assertExactTriggerPolicy(mutated, `Mutation fixture with ${label}`);
    } catch {
      continue;
    }
    throw new Error(`Trigger policy guard regression: accepted ${label}.`);
  }
}

runTriggerPolicyGuardRegressions();

const EXPECTED_JOB_ACTIONS = Object.freeze({
  verify: Object.freeze([
    Object.freeze({ kind: "uses", value: "actions/checkout@v4" }),
    Object.freeze({ kind: "uses", value: "pnpm/action-setup@v4" }),
    Object.freeze({ kind: "uses", value: "actions/setup-node@v4" }),
    Object.freeze({ kind: "run", value: "pnpm install --frozen-lockfile" }),
    Object.freeze({ kind: "run", value: "pnpm release:check" })
  ]),
  "example-smoke": Object.freeze([
    Object.freeze({ kind: "uses", value: "actions/checkout@v4" }),
    Object.freeze({ kind: "uses", value: "pnpm/action-setup@v4" }),
    Object.freeze({ kind: "uses", value: "actions/setup-node@v4" }),
    Object.freeze({ kind: "run", value: "pnpm install --frozen-lockfile" }),
    Object.freeze({
      kind: "run",
      value:
        "pnpm --filter @design-harness/visual-audit exec playwright install --with-deps chromium"
    }),
    Object.freeze({ kind: "run", value: "pnpm build" }),
    Object.freeze({ kind: "run", value: "pnpm smoke:example" }),
    Object.freeze({ kind: "run", value: "pnpm smoke:copy" }),
    Object.freeze({ kind: "run", value: "pnpm smoke:loop" }),
    Object.freeze({ kind: "run", value: "pnpm smoke:packed-loop" }),
    Object.freeze({ kind: "run", value: "pnpm calibrate:fixtures" }),
    Object.freeze({
      kind: "uses",
      value: "actions/upload-artifact@v4",
      condition: "always()"
    })
  ])
});

function uncommentedYamlLine(line) {
  if (/^\s*#/.test(line)) {
    return "";
  }
  return line.replace(/\s+#.*$/, "").trimEnd();
}

function extractJobActions(source, label) {
  const lines = source.split(/\r?\n/).map(uncommentedYamlLine);
  const jobsIndexes = lines.flatMap((line, index) =>
    line === "jobs:" ? [index] : []
  );
  if (jobsIndexes.length !== 1) {
    throw new Error(`${label} must contain exactly one top-level jobs: block.`);
  }

  const actionsByJob = new Map();
  const stepsByJob = new Map();
  const conditionsByJob = new Map();
  const continueOnErrorByJob = new Map();
  const stepsBlocksByJob = new Map();
  let currentJob = null;
  let currentStep = null;
  let inSteps = false;

  function recordAction(kind, value, lineNumber) {
    if (currentStep?.action !== undefined) {
      throw new Error(
        `${label} job ${currentJob} step at line ${currentStep.lineNumber} has more than one run/uses action.`
      );
    }
    if (value === "") {
      throw new Error(
        `${label} job ${currentJob} has an empty ${kind} action at line ${lineNumber}.`
      );
    }
    const action = {
      kind,
      value,
      lineNumber,
      condition: currentStep.condition,
      continueOnError: currentStep.continueOnError
    };
    currentStep.action = action;
    actionsByJob.get(currentJob).push(action);
  }

  function recordStepMetadata(key, value, lineNumber) {
    if (currentStep === null) {
      throw new Error(
        `${label} job ${currentJob} has ${key} outside a step at line ${lineNumber}.`
      );
    }
    if (value === "") {
      throw new Error(
        `${label} job ${currentJob} has an empty ${key} at line ${lineNumber}.`
      );
    }
    if (key === "if") {
      if (currentStep.condition !== null) {
        throw new Error(
          `${label} job ${currentJob} step at line ${currentStep.lineNumber} has duplicate if metadata.`
        );
      }
      currentStep.condition = value;
      if (currentStep.action) {
        currentStep.action.condition = value;
      }
      return;
    }
    if (currentStep.continueOnError !== null) {
      throw new Error(
        `${label} job ${currentJob} step at line ${currentStep.lineNumber} has duplicate continue-on-error metadata.`
      );
    }
    currentStep.continueOnError = value;
    if (currentStep.action) {
      currentStep.action.continueOnError = value;
    }
  }

  for (let index = jobsIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "") {
      continue;
    }
    if (/^\S/.test(line)) {
      break;
    }

    const jobMatch = /^  ([A-Za-z0-9_-]+):$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      if (actionsByJob.has(currentJob)) {
        throw new Error(`${label} contains duplicate job ${currentJob}.`);
      }
      actionsByJob.set(currentJob, []);
      stepsByJob.set(currentJob, []);
      conditionsByJob.set(currentJob, null);
      continueOnErrorByJob.set(currentJob, null);
      stepsBlocksByJob.set(currentJob, 0);
      currentStep = null;
      inSteps = false;
      continue;
    }
    if (currentJob === null) {
      continue;
    }
    if (line === "    steps:") {
      const blockCount = stepsBlocksByJob.get(currentJob) + 1;
      stepsBlocksByJob.set(currentJob, blockCount);
      if (blockCount !== 1) {
        throw new Error(`${label} job ${currentJob} must contain exactly one steps: block.`);
      }
      currentStep = null;
      inSteps = true;
      continue;
    }
    const jobControl =
      /^    (if|continue-on-error):\s*(.*?)\s*$/.exec(line);
    if (jobControl) {
      const [, key, value] = jobControl;
      const target =
        key === "if" ? conditionsByJob : continueOnErrorByJob;
      if (target.get(currentJob) !== null) {
        throw new Error(
          `${label} job ${currentJob} has duplicate ${key} metadata.`
        );
      }
      if (value === "") {
        throw new Error(
          `${label} job ${currentJob} has empty ${key} metadata.`
        );
      }
      target.set(currentJob, value);
      currentStep = null;
      inSteps = false;
      continue;
    }
    if (/^    \S/.test(line)) {
      currentStep = null;
      inSteps = false;
      continue;
    }
    if (!inSteps) {
      continue;
    }

    const stepMatch = /^      -(?:\s+(.*))?$/.exec(line);
    if (stepMatch) {
      currentStep = {
        lineNumber: index + 1,
        action: undefined,
        condition: null,
        continueOnError: null
      };
      stepsByJob.get(currentJob).push(currentStep);
      const directAction = /^(run|uses):\s*(.*?)\s*$/.exec(
        stepMatch[1] ?? ""
      );
      if (directAction) {
        recordAction(directAction[1], directAction[2], index + 1);
      } else {
        const directMetadata = /^(if|continue-on-error):\s*(.*?)\s*$/.exec(
          stepMatch[1] ?? ""
        );
        if (directMetadata) {
          recordStepMetadata(
            directMetadata[1],
            directMetadata[2],
            index + 1
          );
        }
      }
      continue;
    }
    if (currentStep !== null) {
      const nestedAction = /^        (run|uses):\s*(.*?)\s*$/.exec(line);
      if (nestedAction) {
        recordAction(nestedAction[1], nestedAction[2], index + 1);
        continue;
      }
      const nestedMetadata =
        /^        (if|continue-on-error):\s*(.*?)\s*$/.exec(line);
      if (nestedMetadata) {
        recordStepMetadata(
          nestedMetadata[1],
          nestedMetadata[2],
          index + 1
        );
      }
    }
  }

  for (const [job, steps] of stepsByJob) {
    for (const step of steps) {
      if (step.action === undefined) {
        throw new Error(
          `${label} job ${job} step at line ${step.lineNumber} has no run/uses action.`
        );
      }
    }
  }

  return { actionsByJob, conditionsByJob, continueOnErrorByJob };
}

function formatActions(actions) {
  return actions
    .map(({ kind, value, condition, continueOnError }) => {
      const metadata = [
        condition === null || condition === undefined
          ? null
          : `if: ${condition}`,
        continueOnError === null || continueOnError === undefined
          ? null
          : `continue-on-error: ${continueOnError}`
      ].filter(Boolean);
      return `${kind}: ${value}${metadata.length === 0 ? "" : ` (${metadata.join(", ")})`}`;
    })
    .join("\n");
}

function assertExactJobActions(source, label) {
  const {
    actionsByJob,
    conditionsByJob,
    continueOnErrorByJob
  } = extractJobActions(source, label);
  const expectedJobs = Object.keys(EXPECTED_JOB_ACTIONS).sort();
  const actualJobs = [...actionsByJob.keys()].sort();
  if (JSON.stringify(actualJobs) !== JSON.stringify(expectedJobs)) {
    throw new Error(
      `${label} must contain exactly jobs ${expectedJobs.join(", ")}; found ${actualJobs.join(", ")}.`
    );
  }
  for (const [job, expected] of Object.entries(EXPECTED_JOB_ACTIONS)) {
    const actual = actionsByJob.get(job);
    if (actual === undefined) {
      throw new Error(`${label} is missing required job ${job}.`);
    }
    if (conditionsByJob.get(job) !== null) {
      throw new Error(`${label} job ${job} must not have an if condition.`);
    }
    if (continueOnErrorByJob.get(job) !== null) {
      throw new Error(
        `${label} job ${job} must not have continue-on-error metadata.`
      );
    }
    const matches =
      actual.length === expected.length &&
      expected.every(
        (action, index) =>
          actual[index].kind === action.kind &&
          actual[index].value === action.value &&
          actual[index].condition === (action.condition ?? null) &&
          actual[index].continueOnError === null
      );
    if (!matches) {
      throw new Error(
        `${label} job ${job} must contain the exact uncommented run/uses sequence.\n` +
          `Expected:\n${formatActions(expected)}\nFound:\n${formatActions(actual)}`
      );
    }
  }
}

function runJobActionGuardRegressions() {
  const fixture = `${exactTriggerBlock}

jobs:
  verify:
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm release:check
  example-smoke:
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @design-harness/visual-audit exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm smoke:example
      - run: pnpm smoke:copy
      - run: pnpm smoke:loop
      - run: pnpm smoke:packed-loop
      - run: pnpm calibrate:fixtures
      - name: Upload Design Harness example artifacts
        if: always()
        uses: actions/upload-artifact@v4
`;
  assertExactJobActions(fixture, "Job action guard fixture");

  const mutations = [
    [
      "a commented required step",
      (source) =>
        source.replace(
          "      - run: pnpm smoke:packed-loop",
          "      # - run: pnpm smoke:packed-loop"
        )
    ],
    [
      "a required step in the wrong job",
      (source) =>
        source
          .replace("      - run: pnpm smoke:packed-loop\n", "")
          .replace(
            "      - run: pnpm release:check\n",
            "      - run: pnpm release:check\n      - run: pnpm smoke:packed-loop\n"
          )
    ],
    [
      "required steps in the wrong order",
      (source) =>
        source.replace(
          "      - run: pnpm build\n      - run: pnpm smoke:example",
          "      - run: pnpm smoke:example\n      - run: pnpm build"
        )
    ],
    [
      "an unexpected release job",
      (source) =>
        `${source}  release:\n    steps:\n      - run: npm publish\n`
    ],
    [
      "a disabled required smoke step",
      (source) =>
        source.replace(
          "      - run: pnpm smoke:packed-loop",
          "      - run: pnpm smoke:packed-loop\n        if: false"
        )
    ],
    [
      "a disabled required job",
      (source) =>
        source.replace(
          "  example-smoke:\n    steps:",
          "  example-smoke:\n    if: false\n    steps:"
        )
    ],
    [
      "a non-blocking required smoke step",
      (source) =>
        source.replace(
          "      - run: pnpm smoke:packed-loop",
          "      - run: pnpm smoke:packed-loop\n        continue-on-error: true"
        )
    ],
    [
      "a non-blocking required smoke job",
      (source) =>
        source.replace(
          "  example-smoke:\n    steps:",
          "  example-smoke:\n    continue-on-error: true\n    steps:"
        )
    ]
  ];

  for (const [mutationLabel, mutate] of mutations) {
    const mutated = mutate(fixture);
    if (mutated === fixture) {
      throw new Error(`Job action guard regression could not create ${mutationLabel}.`);
    }
    try {
      assertExactJobActions(mutated, `Mutation fixture with ${mutationLabel}`);
    } catch {
      continue;
    }
    throw new Error(`Job action guard regression: accepted ${mutationLabel}.`);
  }
}

runJobActionGuardRegressions();

const workflowPath = resolve(".github/workflows/ci.yml");
const workflow = await readFile(workflowPath, "utf8");
assertExactTriggerPolicy(workflow, "GitHub Actions CI workflow");
assertExactJobActions(workflow, "GitHub Actions CI workflow");

const rootManifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const packedLoopScript = rootManifest.scripts?.["smoke:packed-loop"];
const releaseCheckScript = rootManifest.scripts?.["release:check"];
if (packedLoopScript !== "node scripts/verify-packed-cli.mjs --positive-loop") {
  throw new Error("smoke:packed-loop must select the explicit positive verifier mode.");
}
if (typeof releaseCheckScript !== "string" || releaseCheckScript.includes("smoke:packed-loop")) {
  throw new Error("release:check must remain browserless and exclude smoke:packed-loop.");
}

const requiredFragments = [
  "if: always()",
  "name: design-harness-example-smoke",
  "runs/example-smoke",
  "runs/copy-smoke",
  "runs/loop-smoke",
  "runs/packed-loop",
  "runs/calibration",
  "if-no-files-found: warn"
];

const missing = requiredFragments.filter((fragment) => !workflow.includes(fragment));
if (missing.length > 0) {
  throw new Error(`Missing required GitHub Actions artifact fragment(s): ${missing.join(", ")}`);
}

console.log("Validated GitHub Actions artifact upload scaffold.");
