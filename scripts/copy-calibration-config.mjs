import { SCHEMA_VERSION } from "../packages/core/dist/index.js";

/** @typedef {import("../packages/core/dist/index.js").CopyStyle} CopyStyle */
/** @typedef {import("../packages/core/dist/index.js").CopyStyleSurfaceRule} CopyStyleSurfaceRule */
/** @typedef {import("../packages/core/dist/index.js").JosaHedgePolicy} JosaHedgePolicy */
/** @typedef {import("../packages/core/dist/index.js").ViewportPreset} ViewportPreset */

/** @type {ViewportPreset} */
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

/** @type {CopyStyleSurfaceRule} */
const buttonSurfaceRule = {
  surface: "button",
  matchers: [
    { kind: "role", value: "switch" },
    { kind: "role", value: "button" },
    { kind: "adapter", adapter: "web-dom", value: "button" }
  ]
};

/** @type {CopyStyleSurfaceRule} */
const bodySurfaceRule = {
  surface: "body",
  matchers: [
    { kind: "adapter", adapter: "web-dom", value: "main p" },
    { kind: "adapter", adapter: "web-dom", value: "p" }
  ]
};

/** @type {Pick<CopyStyle, "schemaVersion" | "locale" | "glossary" | "bannedPhrases">} */
const sharedCopyStyle = {
  schemaVersion: SCHEMA_VERSION,
  locale: "ko-KR",
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

/**
 * @param {JosaHedgePolicy} josaHedgePolicy
 * @returns {CopyStyle}
 */
export function copyStyleForCalibration(josaHedgePolicy) {
  return {
    ...sharedCopyStyle,
    josaHedgePolicy,
    surfaceMapping: [buttonSurfaceRule, bodySurfaceRule]
  };
}

/**
 * Adds deliberate unsupported/invalid bindings used only by the surface-materializer smoke.
 * @param {JosaHedgePolicy} josaHedgePolicy
 * @returns {CopyStyle}
 */
export function copyStyleForSmoke(josaHedgePolicy) {
  return {
    ...sharedCopyStyle,
    josaHedgePolicy,
    surfaceMapping: [
      buttonSurfaceRule,
      {
        surface: "error",
        matchers: [{ kind: "adapter", adapter: "native-ui", value: "status" }]
      },
      {
        surface: "marketing",
        matchers: [{ kind: "adapter", adapter: "web-dom", value: "[" }]
      },
      bodySurfaceRule,
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
    ]
  };
}
