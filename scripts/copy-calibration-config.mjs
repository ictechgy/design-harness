import { SCHEMA_VERSION } from "../packages/core/dist/index.js";

export const desktopViewport = {
  name: "desktop",
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false
};

export const explicitRoleEvidence = "unknown-token SWITCH checkbox";
export const nonMatchingWebDomSelector = "[data-design-harness-never-match='role-smoke']";
export const directNodeSelector = "#direct-surface-copy";
export const nearestAncestorSelector = "#nearest-surface-wrapper";

const copyCalibrationStyle = {
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
    },
    {
      surface: "marketing",
      matchers: [{ kind: "adapter", adapter: "web-dom", value: directNodeSelector }]
    },
    {
      surface: "body",
      matchers: [{ kind: "adapter", adapter: "web-dom", value: nearestAncestorSelector }]
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

export function copyStyleForCalibration(josaHedgePolicy) {
  return { ...copyCalibrationStyle, josaHedgePolicy };
}
