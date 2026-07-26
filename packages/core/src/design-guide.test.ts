import { describe, expect, it } from "vitest";
import {
  assertDesignGuideProfile,
  classifyFontFamily,
  createExampleDesignGuide,
  CSS_GENERIC_FONT_FAMILY_VALUES,
  DesignGuideProfileError,
  dtcgColorToRgba8,
  foldAsciiCase,
  fontFamilyComparisonIdentity,
  loadSchema,
  projectColorAdherencePolicy,
  projectDensityComplexityBudgetPolicy,
  projectFontFamilyAdherencePolicy,
  projectPaletteDisciplineBudgetPolicy,
  projectSpacingAdherencePolicy,
  projectTypographyVariantBudgetPolicy,
  projectVisualMetricsGenerationPolicies,
  projectVisualMetricsRuntimePolicies,
  rgba8ColorIdentity,
  SCHEMA_VERSION,
  validateSchema
} from "./index.js";

describe("Design Guide Profile v0.5a-2", () => {
  it("keeps the additive closed schema and semantic fixture in lockstep", () => {
    const guide = createExampleDesignGuide();
    expect(SCHEMA_VERSION).toBe("0.2");
    expect(validateSchema("design-guide", guide)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(guide)).not.toThrow();
    expect(loadSchema("design-guide")).toMatchObject({
      title: "DesignGuide",
      additionalProperties: false,
      properties: {
        schemaVersion: { const: "0.2" },
        audit: {
          additionalProperties: false,
          minProperties: 1,
          properties: {
            color: {
              additionalProperties: false,
              required: ["ignoreSelectors"],
              properties: {
                ignoreSelectors: { minItems: 1, maxItems: 32, uniqueItems: true }
              }
            },
            spacing: {
              additionalProperties: false,
              required: ["ignoreSelectors"],
              properties: {
                ignoreSelectors: { minItems: 1, maxItems: 32, uniqueItems: true }
              }
            },
            fontFamily: {
              additionalProperties: false,
              minProperties: 1,
              properties: {
                additionalAllowedFamilies: {
                  minItems: 1,
                  maxItems: 32,
                  uniqueItems: true,
                  items: {
                    additionalProperties: false,
                    required: ["value", "kind"],
                    properties: {
                      value: { minLength: 1, maxLength: 128 },
                      kind: { enum: ["named", "generic"] }
                    }
                  }
                },
                ignoreSelectors: { minItems: 1, maxItems: 32, uniqueItems: true }
              }
            },
            typographyVariants: {
              additionalProperties: false,
              required: ["maxDistinctVariants"],
              properties: {
                maxDistinctVariants: { type: "integer", minimum: 1, maximum: 2000 },
                ignoreSelectors: { minItems: 1, maxItems: 32, uniqueItems: true }
              }
            },
            paletteDiscipline: {
              anyOf: expect.arrayContaining([
                expect.objectContaining({ required: ["maxDistinctColors"] }),
                expect.objectContaining({ required: ["maxChromaticHueFamilies"] })
              ])
            },
            densityComplexity: {
              anyOf: expect.arrayContaining([
                expect.objectContaining({ required: ["maxVisibleElements"] }),
                expect.objectContaining({ required: ["maxTextClusters"] })
              ])
            }
          }
        }
      }
    });
  });

  it("accepts only the frozen closed visual-budget sections and exact safety bounds", () => {
    const validSections = [
      { typographyVariants: { maxDistinctVariants: 1 } },
      { paletteDiscipline: { maxDistinctColors: 1 } },
      { paletteDiscipline: { maxChromaticHueFamilies: 1 } },
      { paletteDiscipline: { maxDistinctColors: 5_000, maxChromaticHueFamilies: 12 } },
      { densityComplexity: { maxVisibleElements: 1 } },
      { densityComplexity: { maxTextClusters: 1 } },
      { densityComplexity: { maxVisibleElements: 10_000, maxTextClusters: 20_000 } }
    ];
    for (const audit of validSections) {
      const guide = { ...createExampleDesignGuide(), audit };
      expect(validateSchema("design-guide", guide)).toEqual({ valid: true, issues: [] });
      expect(() => assertDesignGuideProfile(guide)).not.toThrow();
    }

    const maximum = createExampleDesignGuide();
    maximum.audit = {
      typographyVariants: {
        maxDistinctVariants: 2_000,
        ignoreSelectors: Array.from({ length: 32 }, (_, index) => `[data-type-${index}]`)
      },
      paletteDiscipline: {
        maxDistinctColors: 5_000,
        maxChromaticHueFamilies: 12,
        ignoreSelectors: Array.from({ length: 32 }, (_, index) => `[data-paint-${index}]`)
      },
      densityComplexity: {
        maxVisibleElements: 10_000,
        maxTextClusters: 20_000,
        ignoreSelectors: Array.from({ length: 32 }, (_, index) => `[data-density-${index}]`)
      }
    };
    expect(validateSchema("design-guide", maximum)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(maximum)).not.toThrow();

    const invalidBudgets: Array<[string, unknown, string]> = [
      ["typographyVariants", {}, "$.audit.typographyVariants.maxDistinctVariants"],
      [
        "typographyVariants",
        { ignoreSelectors: [".vendor"] },
        "$.audit.typographyVariants.maxDistinctVariants"
      ],
      ["paletteDiscipline", {}, "$.audit.paletteDiscipline"],
      ["paletteDiscipline", { ignoreSelectors: [".vendor"] }, "$.audit.paletteDiscipline"],
      ["densityComplexity", {}, "$.audit.densityComplexity"],
      ["densityComplexity", { ignoreSelectors: [".vendor"] }, "$.audit.densityComplexity"]
    ];
    for (const [section, value, path] of invalidBudgets) {
      const guide = {
        ...createExampleDesignGuide(),
        audit: { [section]: value }
      };
      expect(validateSchema("design-guide", guide).valid).toBe(false);
      expectProfileIssue(guide, path, "invalid-profile");
    }

    const invalidValues = [0, -1, 1.5, Number.NaN, Infinity, "1", true];
    const budgetCases = [
      ["typographyVariants", "maxDistinctVariants", 2_001],
      ["paletteDiscipline", "maxDistinctColors", 5_001],
      ["paletteDiscipline", "maxChromaticHueFamilies", 13],
      ["densityComplexity", "maxVisibleElements", 10_001],
      ["densityComplexity", "maxTextClusters", 20_001]
    ] as const;
    for (const [section, key, overBound] of budgetCases) {
      for (const invalidValue of [...invalidValues, overBound]) {
        const guide = {
          ...createExampleDesignGuide(),
          audit: { [section]: { [key]: invalidValue } }
        };
        expect(validateSchema("design-guide", guide).valid).toBe(false);
        expectProfileIssue(guide, `$.audit.${section}.${key}`, "invalid-profile");
      }
    }

    for (const [section, validBudget] of [
      ["typographyVariants", { maxDistinctVariants: 8 }],
      ["paletteDiscipline", { maxDistinctColors: 24 }],
      ["densityComplexity", { maxVisibleElements: 120 }]
    ] as const) {
      const guide = {
        ...createExampleDesignGuide(),
        audit: { [section]: { ...validBudget, extra: true } }
      };
      expect(validateSchema("design-guide", guide).valid).toBe(false);
      expectProfileIssue(guide, `$.audit.${section}.extra`, "invalid-profile");
    }
  });

  it("applies the existing exact selector policy independently to every visual metric", () => {
    const sections = [
      ["typographyVariants", { maxDistinctVariants: 8 }],
      ["paletteDiscipline", { maxDistinctColors: 24 }],
      ["densityComplexity", { maxVisibleElements: 120 }]
    ] as const;
    const invalidSelectors: Array<[unknown, string]> = [
      [[], "ignoreSelectors"],
      [[".vendor", ".vendor"], "ignoreSelectors[1]"],
      [[" x"], "ignoreSelectors[0]"],
      [["x".repeat(257)], "ignoreSelectors[0]"],
      [[".safe\nbody"], "ignoreSelectors[0]"],
      [[".safe\u202ebody"], "ignoreSelectors[0]"],
      [["\ud800"], "ignoreSelectors[0]"],
      [Array.from({ length: 33 }, (_, index) => `.x-${index}`), "ignoreSelectors"]
    ];

    for (const [section, budget] of sections) {
      const browserInvalid = {
        ...createExampleDesignGuide(),
        audit: { [section]: { ...budget, ignoreSelectors: ["["] } }
      };
      expect(() => assertDesignGuideProfile(browserInvalid)).not.toThrow();

      for (const [ignoreSelectors, suffix] of invalidSelectors) {
        const guide = {
          ...createExampleDesignGuide(),
          audit: { [section]: { ...budget, ignoreSelectors } }
        };
        expectProfileIssue(guide, `$.audit.${section}.${suffix}`, "invalid-profile");
      }
    }
  });

  it("projects frozen runtime policies and selector-free generation policies without absent keys", () => {
    const noConfig = createExampleDesignGuide();
    expect(projectVisualMetricsRuntimePolicies(noConfig)).toEqual({});
    expect(projectVisualMetricsGenerationPolicies(noConfig)).toEqual({});
    expect(projectTypographyVariantBudgetPolicy(noConfig)).toBeUndefined();
    expect(projectPaletteDisciplineBudgetPolicy(noConfig)).toBeUndefined();
    expect(projectDensityComplexityBudgetPolicy(noConfig)).toBeUndefined();

    const guide = createExampleDesignGuide();
    guide.audit = {
      fontFamily: { ignoreSelectors: [".font-vendor"] },
      color: { ignoreSelectors: [".paint-vendor"] },
      spacing: { ignoreSelectors: [".spacing-vendor"] },
      typographyVariants: {
        maxDistinctVariants: 8,
        ignoreSelectors: [".type-vendor"]
      },
      paletteDiscipline: {
        maxDistinctColors: 24,
        maxChromaticHueFamilies: 4,
        ignoreSelectors: [".palette-vendor"]
      },
      densityComplexity: {
        maxVisibleElements: 120,
        maxTextClusters: 48,
        ignoreSelectors: [".density-vendor"]
      }
    };

    const runtime = projectVisualMetricsRuntimePolicies(guide);
    expect(runtime).toEqual({
      typographyVariants: {
        maxDistinctVariants: 8,
        ignoreSelectors: [".type-vendor"],
        policyId: "typography-variant-budget-v1",
        methodId: "rendered-typography-variants-v1"
      },
      paletteDiscipline: {
        maxDistinctColors: 24,
        maxChromaticHueFamilies: 4,
        ignoreSelectors: [".palette-vendor"],
        policyId: "palette-discipline-budget-v1",
        methodId: "rendered-rgba8-oklch-cover30-v1"
      },
      densityComplexity: {
        maxVisibleElements: 120,
        maxTextClusters: 48,
        ignoreSelectors: [".density-vendor"],
        policyId: "density-complexity-budget-v1",
        methodId: "viewport-dom-density-v1",
        visibleElementMethodId: "visible-content-elements-v1",
        textClusterMethodId: "text-flow-connectivity-v1"
      }
    });
    expect(projectTypographyVariantBudgetPolicy(guide)).toEqual(runtime.typographyVariants);
    expect(projectPaletteDisciplineBudgetPolicy(guide)).toEqual(runtime.paletteDiscipline);
    expect(projectDensityComplexityBudgetPolicy(guide)).toEqual(runtime.densityComplexity);

    const generation = projectVisualMetricsGenerationPolicies(guide);
    expect(generation).toEqual({
      typographyVariants: {
        maxDistinctVariants: 8,
        policyId: "typography-variant-budget-v1",
        methodId: "rendered-typography-variants-v1"
      },
      paletteDiscipline: {
        maxDistinctColors: 24,
        maxChromaticHueFamilies: 4,
        policyId: "palette-discipline-budget-v1",
        methodId: "rendered-rgba8-oklch-cover30-v1"
      },
      densityComplexity: {
        maxVisibleElements: 120,
        maxTextClusters: 48,
        policyId: "density-complexity-budget-v1",
        methodId: "viewport-dom-density-v1",
        visibleElementMethodId: "visible-content-elements-v1",
        textClusterMethodId: "text-flow-connectivity-v1"
      }
    });
    expect(JSON.stringify(generation)).not.toMatch(
      /ignoreSelectors|font-vendor|paint-vendor|spacing-vendor|type-vendor|palette-vendor|density-vendor/u
    );
  });

  it("accepts the optional closed audit overlay and enforces its semantic bounds", () => {
    const selectorOnly = createExampleDesignGuide();
    selectorOnly.audit = {
      fontFamily: { ignoreSelectors: [".third-party-widget", "[data-vendor-shell]"] }
    };
    expect(validateSchema("design-guide", selectorOnly)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(selectorOnly)).not.toThrow();

    const additionalOnly = createExampleDesignGuide();
    additionalOnly.audit = {
      fontFamily: {
        additionalAllowedFamilies: [{ value: "Pretendard Fallback", kind: "named" }]
      }
    };
    expect(validateSchema("design-guide", additionalOnly)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(additionalOnly)).not.toThrow();

    const maximum = createExampleDesignGuide();
    maximum.audit = {
      fontFamily: {
        additionalAllowedFamilies: Array.from(
          { length: 32 },
          (_, index) => ({ value: `Runtime Family ${index}`, kind: "named" as const })
        ),
        ignoreSelectors: Array.from({ length: 32 }, (_, index) => `[data-vendor-${index}]`)
      }
    };
    expect(validateSchema("design-guide", maximum)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(maximum)).not.toThrow();

    const invalidCases: Array<[unknown, string]> = [];
    invalidCases.push([{ ...createExampleDesignGuide(), audit: null }, "$.audit"]);
    invalidCases.push([{ ...createExampleDesignGuide(), audit: {} }, "$.audit"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: {} }
    }, "$.audit.fontFamily"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: [] } }
    }, "$.audit.fontFamily.ignoreSelectors"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: [".vendor", ".vendor"] } }
    }, "$.audit.fontFamily.ignoreSelectors[1]"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: [" x"] } }
    }, "$.audit.fontFamily.ignoreSelectors[0]"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: ["x".repeat(257)] } }
    }, "$.audit.fontFamily.ignoreSelectors[0]"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: [".safe\nbody"] } }
    }, "$.audit.fontFamily.ignoreSelectors[0]"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: [".safe\u202ebody"] } }
    }, "$.audit.fontFamily.ignoreSelectors[0]"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: ["\ud800"] } }
    }, "$.audit.fontFamily.ignoreSelectors[0]"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: Array(1) as string[] } }
    }, "$.audit.fontFamily.ignoreSelectors[0]"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: Array.from({ length: 33 }, (_, index) => `.x-${index}`) } }
    }, "$.audit.fontFamily.ignoreSelectors"]);
    invalidCases.push([{
      ...createExampleDesignGuide(),
      audit: { fontFamily: { ignoreSelectors: [".vendor"], extra: true } }
    }, "$.audit.fontFamily.extra"]);

    for (const [value, path] of invalidCases) {
      expectProfileIssue(value, path, "invalid-profile");
    }

    const browserInvalidSelector = createExampleDesignGuide();
    browserInvalidSelector.audit = { fontFamily: { ignoreSelectors: ["["] } };
    expect(() => assertDesignGuideProfile(browserInvalidSelector)).not.toThrow();
  });

  it("accepts the separate selector-only color audit overlay and enforces its closed bounds", () => {
    const colorOnly = createExampleDesignGuide();
    colorOnly.audit = {
      color: { ignoreSelectors: [".third-party-widget", "[data-vendor-shell]"] }
    };
    expect(validateSchema("design-guide", colorOnly)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(colorOnly)).not.toThrow();

    const combined = createExampleDesignGuide();
    combined.audit = {
      fontFamily: { ignoreSelectors: [".font-vendor"] },
      color: { ignoreSelectors: [".paint-vendor"] }
    };
    expect(validateSchema("design-guide", combined)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(combined)).not.toThrow();

    const browserInvalid = createExampleDesignGuide();
    browserInvalid.audit = { color: { ignoreSelectors: ["["] } };
    expect(() => assertDesignGuideProfile(browserInvalid)).not.toThrow();

    const invalidCases: Array<[unknown, string]> = [
      [{ ...createExampleDesignGuide(), audit: { color: {} } }, "$.audit.color.ignoreSelectors"],
      [{
        ...createExampleDesignGuide(),
        audit: { color: { ignoreSelectors: [], extra: true } }
      }, "$.audit.color.extra"],
      [{
        ...createExampleDesignGuide(),
        audit: { color: { ignoreSelectors: [".vendor", ".vendor"] } }
      }, "$.audit.color.ignoreSelectors[1]"],
      [{
        ...createExampleDesignGuide(),
        audit: { color: { ignoreSelectors: [".safe\u202ebody"] } }
      }, "$.audit.color.ignoreSelectors[0]"],
      [{
        ...createExampleDesignGuide(),
        audit: { color: { ignoreSelectors: Array.from({ length: 33 }, (_, index) => `.x-${index}`) } }
      }, "$.audit.color.ignoreSelectors"]
    ];
    for (const [value, path] of invalidCases) {
      expectProfileIssue(value, path, "invalid-profile");
    }
  });

  it("accepts the separate selector-only spacing audit overlay and enforces its closed bounds", () => {
    const spacingOnly = createExampleDesignGuide();
    spacingOnly.audit = {
      spacing: { ignoreSelectors: [".third-party-widget", "[data-vendor-shell]"] }
    };
    expect(validateSchema("design-guide", spacingOnly)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(spacingOnly)).not.toThrow();

    const combined = createExampleDesignGuide();
    combined.audit = {
      fontFamily: { ignoreSelectors: [".font-vendor"] },
      color: { ignoreSelectors: [".paint-vendor"] },
      spacing: { ignoreSelectors: [".spacing-vendor"] }
    };
    expect(validateSchema("design-guide", combined)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(combined)).not.toThrow();

    const browserInvalid = createExampleDesignGuide();
    browserInvalid.audit = { spacing: { ignoreSelectors: ["["] } };
    expect(() => assertDesignGuideProfile(browserInvalid)).not.toThrow();

    const invalidCases: Array<[unknown, string]> = [
      [{ ...createExampleDesignGuide(), audit: { spacing: {} } }, "$.audit.spacing.ignoreSelectors"],
      [{
        ...createExampleDesignGuide(),
        audit: { spacing: { ignoreSelectors: [], extra: true } }
      }, "$.audit.spacing.extra"],
      [{
        ...createExampleDesignGuide(),
        audit: { spacing: { ignoreSelectors: [".vendor", ".vendor"] } }
      }, "$.audit.spacing.ignoreSelectors[1]"],
      [{
        ...createExampleDesignGuide(),
        audit: { spacing: { ignoreSelectors: [".safe\u202ebody"] } }
      }, "$.audit.spacing.ignoreSelectors[0]"],
      [{
        ...createExampleDesignGuide(),
        audit: { spacing: { ignoreSelectors: Array.from({ length: 33 }, (_, index) => `.x-${index}`) } }
      }, "$.audit.spacing.ignoreSelectors"]
    ];
    for (const [value, path] of invalidCases) {
      expectProfileIssue(value, path, "invalid-profile");
    }
  });

  it("enforces exact bounded additional-family entries with safe decoded values", () => {
    const boundaryValues = createExampleDesignGuide();
    boundaryValues.audit = {
      fontFamily: {
        additionalAllowedFamilies: [
          { value: "🧭", kind: "named" },
          { value: "🧭".repeat(128), kind: "named" },
          { value: "Font, With Comma", kind: "named" },
          { value: "system-ui", kind: "named" },
          { value: "SYSTEM-UI", kind: "generic" },
          { value: "École", kind: "named" },
          { value: "école", kind: "named" },
          { value: "Å", kind: "named" },
          { value: "A\u030a", kind: "named" }
        ]
      }
    };
    expect(() => assertDesignGuideProfile(boundaryValues)).not.toThrow();

    const everyGeneric = createExampleDesignGuide();
    everyGeneric.audit = {
      fontFamily: {
        additionalAllowedFamilies: CSS_GENERIC_FONT_FAMILY_VALUES.map((value) => ({
          value: value.toUpperCase(),
          kind: "generic" as const
        }))
      }
    };
    expect(() => assertDesignGuideProfile(everyGeneric)).not.toThrow();

    const inheritedSlot = Array(1) as unknown[];
    Object.setPrototypeOf(
      inheritedSlot,
      Object.assign(Object.create(Array.prototype) as Record<number, unknown>, {
        0: { value: "Inherited", kind: "named" }
      })
    );
    const inheritedEntry = Object.create({ value: "Inherited", kind: "named" }) as unknown;
    const prototypeNamedEntry: Record<string, unknown> = { value: "Inter", kind: "named" };
    Object.defineProperty(prototypeNamedEntry, "constructor", { value: true, enumerable: true });

    const invalidValues = [
      "",
      " leading",
      "trailing ",
      "x".repeat(129),
      "unsafe\ud800font",
      "unsafe\nfont",
      "unsafe\tfont",
      "unsafe\u202efont",
      "https://example.test/font.woff2",
      "url(https://example.test/font.woff2)",
      "@import url(font.css)"
    ];
    const invalidCases: Array<[unknown, string]> = [
      [guideWithAdditionalFamilies([]), "$.audit.fontFamily.additionalAllowedFamilies"],
      [guideWithAdditionalFamilies("Inter"), "$.audit.fontFamily.additionalAllowedFamilies"],
      [guideWithAdditionalFamilies(Array.from(
        { length: 33 },
        (_, index) => ({ value: `Family ${index}`, kind: "named" })
      )), "$.audit.fontFamily.additionalAllowedFamilies"],
      [guideWithAdditionalFamilies(Array(1)), "$.audit.fontFamily.additionalAllowedFamilies[0]"],
      [guideWithAdditionalFamilies(inheritedSlot), "$.audit.fontFamily.additionalAllowedFamilies[0]"],
      [guideWithAdditionalFamilies([null]), "$.audit.fontFamily.additionalAllowedFamilies[0]"],
      [guideWithAdditionalFamilies(["Inter"]), "$.audit.fontFamily.additionalAllowedFamilies[0]"],
      [guideWithAdditionalFamilies([inheritedEntry]), "$.audit.fontFamily.additionalAllowedFamilies[0].value"],
      [guideWithAdditionalFamilies([prototypeNamedEntry]), "$.audit.fontFamily.additionalAllowedFamilies[0].constructor"],
      [guideWithAdditionalFamilies([{ kind: "named" }]), "$.audit.fontFamily.additionalAllowedFamilies[0].value"],
      [guideWithAdditionalFamilies([{ value: "Inter" }]), "$.audit.fontFamily.additionalAllowedFamilies[0].kind"],
      [guideWithAdditionalFamilies([
        { value: "Inter", kind: "named", extra: true }
      ]), "$.audit.fontFamily.additionalAllowedFamilies[0].extra"],
      [guideWithAdditionalFamilies([
        { value: "Inter", kind: "other" }
      ]), "$.audit.fontFamily.additionalAllowedFamilies[0].kind"],
      [guideWithAdditionalFamilies([
        { value: "Inter", kind: "generic" }
      ]), "$.audit.fontFamily.additionalAllowedFamilies[0].value"],
      [guideWithAdditionalFamilies([
        { value: "Inter", kind: "named" },
        { value: "INTER", kind: "named" }
      ]), "$.audit.fontFamily.additionalAllowedFamilies[1]"],
      [guideWithAdditionalFamilies([
        { value: "system-ui", kind: "generic" },
        { value: "SYSTEM-UI", kind: "generic" }
      ]), "$.audit.fontFamily.additionalAllowedFamilies[1]"]
    ];
    for (const value of invalidValues) {
      invalidCases.push([
        guideWithAdditionalFamilies([{ value, kind: "named" }]),
        "$.audit.fontFamily.additionalAllowedFamilies[0].value"
      ]);
    }
    for (const [value, path] of invalidCases) {
      expectProfileIssue(value, path, "invalid-profile");
    }
  });

  it("projects a raw-string font policy with the bounded v1 comparison identity", () => {
    const guide = createExampleDesignGuide();
    guide.tokens.font.family.heading.$value = ["INTER", "sans-serif", "École"];
    guide.tokens.font.family.body.$value = ["inter", "GENERIC(FANGSONG)", "école", "맑은 고딕"];
    guide.audit = {
      fontFamily: {
        additionalAllowedFamilies: [
          { value: "inter", kind: "named" },
          { value: "Pretendard Fallback", kind: "named" },
          { value: "SYSTEM-UI", kind: "named" },
          { value: "system-ui", kind: "generic" },
          { value: "맑은 고딕", kind: "named" }
        ],
        ignoreSelectors: [".third-party-widget"]
      }
    };

    expect(projectFontFamilyAdherencePolicy(guide)).toEqual({
      allowedFamilies: [
        { value: "INTER", kind: "named" },
        { value: "sans-serif", kind: "generic" },
        { value: "École", kind: "named" },
        { value: "GENERIC(FANGSONG)", kind: "generic" },
        { value: "école", kind: "named" },
        { value: "맑은 고딕", kind: "named" },
        { value: "Pretendard Fallback", kind: "named" },
        { value: "SYSTEM-UI", kind: "named" },
        { value: "system-ui", kind: "generic" }
      ],
      ignoreSelectors: [".third-party-widget"],
      policyId: "font-family-adherence-v1"
    });
    expect(foldAsciiCase("AÉZé맑")).toBe("aÉzé맑");
    expect(fontFamilyComparisonIdentity("Inter", "named")).toBe(
      fontFamilyComparisonIdentity("INTER", "named")
    );
    expect(fontFamilyComparisonIdentity("École", "named")).not.toBe(
      fontFamilyComparisonIdentity("école", "named")
    );
    expect(fontFamilyComparisonIdentity("Å", "named")).not.toBe(
      fontFamilyComparisonIdentity("A\u030a", "named")
    );
    expect(classifyFontFamily("UI-SANS-SERIF")).toBe("generic");
    expect(classifyFontFamily("generic(kai)")).toBe("generic");
    expect(classifyFontFamily("emoji")).toBe("named");
    expect(new Set(CSS_GENERIC_FONT_FAMILY_VALUES).size).toBe(CSS_GENERIC_FONT_FAMILY_VALUES.length);

    const additionalOnly = createExampleDesignGuide();
    additionalOnly.audit = {
      fontFamily: {
        additionalAllowedFamilies: [{ value: "JetBrains Mono", kind: "named" }]
      }
    };
    expect(projectFontFamilyAdherencePolicy(additionalOnly)).toMatchObject({
      allowedFamilies: expect.arrayContaining([{ value: "JetBrains Mono", kind: "named" }]),
      ignoreSelectors: [],
      policyId: "font-family-adherence-v1"
    });
  });

  it("projects an exact deduplicated RGBA8 color policy from semantic generation tokens", () => {
    const guide = createExampleDesignGuide();
    guide.tokens.color.semantic.background = {
      $value: {
        colorSpace: "srgb",
        components: [1, 0.5, 0],
        alpha: 0.501
      }
    };
    guide.tokens.color.semantic["background-muted"] = {
      $value: {
        colorSpace: "srgb",
        components: [1, 0.5, 0],
        alpha: 0.501
      }
    };
    guide.audit = { color: { ignoreSelectors: [".third-party-widget"] } };

    expect(projectColorAdherencePolicy(guide)).toEqual({
      allowedColors: [
        { red: 255, green: 128, blue: 0, alpha: 128 },
        { red: 20, green: 20, blue: 26, alpha: 255 },
        { red: 26, green: 89, blue: 242, alpha: 255 }
      ],
      ignoreSelectors: [".third-party-widget"],
      policyId: "color-adherence-v1"
    });
    expect(rgba8ColorIdentity({ red: 255, green: 128, blue: 0, alpha: 128 })).toBe(
      "255,128,0,128"
    );
    expect(dtcgColorToRgba8({
      colorSpace: "srgb",
      components: [-0.1, 0.5, 1.1],
      alpha: 0.501
    })).toEqual({ red: 0, green: 128, blue: 255, alpha: 128 });

    const withoutOverlay = createExampleDesignGuide();
    expect(projectColorAdherencePolicy(withoutOverlay)).toMatchObject({
      allowedColors: expect.arrayContaining([
        { red: 255, green: 255, blue: 255, alpha: 255 },
        { red: 20, green: 20, blue: 26, alpha: 255 }
      ]),
      ignoreSelectors: [],
      policyId: "color-adherence-v1"
    });
  });

  it("projects a unit-preserving deduplicated spacing policy from spacing tokens", () => {
    const guide = createExampleDesignGuide();
    guide.tokens.spacing = {
      $type: "dimension",
      "px-zero": { $value: { value: 0, unit: "px" } },
      "rem-zero": { $value: { value: 0, unit: "rem" } },
      "rem-half": { $value: { value: 0.5, unit: "rem" } },
      "rem-half-duplicate": { $value: { value: 0.5, unit: "rem" } },
      "px-eight": { $value: { value: 8, unit: "px" } },
      "px-eight-duplicate": { $value: { value: 8, unit: "px" } }
    };
    guide.audit = { spacing: { ignoreSelectors: [".third-party-widget"] } };

    expect(projectSpacingAdherencePolicy(guide)).toEqual({
      allowedValues: [
        { value: 0, unit: "px" },
        { value: 0, unit: "rem" },
        { value: 0.5, unit: "rem" },
        { value: 8, unit: "px" }
      ],
      ignoreSelectors: [".third-party-widget"],
      policyId: "spacing-adherence-v1"
    });

    const withoutOverlay = createExampleDesignGuide();
    expect(projectSpacingAdherencePolicy(withoutOverlay)).toEqual({
      allowedValues: [
        { value: 0.5, unit: "rem" },
        { value: 1, unit: "rem" }
      ],
      ignoreSelectors: [],
      policyId: "spacing-adherence-v1"
    });
  });

  it("accepts the exact minimum and maximum profile bounds", () => {
    const minimum = createExampleDesignGuide();
    minimum.prohibitions = ["generic-card-grid"];
    expect(() => assertDesignGuideProfile(minimum)).not.toThrow();

    const maximum = createExampleDesignGuide();
    maximum.tokens.color.semantic["border"] = {
      $value: { colorSpace: "srgb", components: [0, 0.5, 1], alpha: 0 }
    };
    maximum.tokens.color.semantic["focus-ring"] = {
      $value: { colorSpace: "srgb", components: [1, 0.5, 0], alpha: 1 }
    };
    for (let index = 3; index <= 12; index += 1) {
      maximum.tokens.spacing[`step-${index}`] = { $value: { value: index / 4, unit: "rem" } };
      maximum.tokens.radius[`step-${index}`] = { $value: { value: index, unit: "px" } };
    }
    maximum.signatureElement = "가".repeat(280);
    expect(() => assertDesignGuideProfile(maximum)).not.toThrow();
  });

  it("rejects non-object, inherited, prototype-named, missing, and unknown envelope fields", () => {
    for (const value of [null, [], "guide", 42]) {
      expectProfileIssue(value, "$", "invalid-profile");
    }

    const inherited = Object.create(createExampleDesignGuide()) as Record<string, unknown>;
    expectProfileIssue(inherited, "$.schemaVersion", "invalid-profile");

    for (const key of ["constructor", "toString", "__proto__"]) {
      const guide = createExampleDesignGuide() as unknown as Record<string, unknown>;
      Object.defineProperty(guide, key, { value: true, enumerable: true });
      expectProfileIssue(guide, `$.${key}`, "invalid-profile");
    }

    const missing = structuredClone(createExampleDesignGuide()) as unknown as Record<string, unknown>;
    delete missing.signatureElement;
    expectProfileIssue(missing, "$.signatureElement", "invalid-profile");

    expectProfileIssue({ ...createExampleDesignGuide(), extra: true }, "$.extra", "invalid-profile");
  });

  it("enforces semantic color count, names, type, and literal srgb bounds", () => {
    const tooFew = createExampleDesignGuide();
    delete tooFew.tokens.color.semantic.accent;
    expectProfileIssue(tooFew, "$.tokens.color.semantic", "invalid-profile");

    const wrongName = createExampleDesignGuide();
    wrongName.tokens.color.semantic["Focus.Ring"] = wrongName.tokens.color.semantic.accent;
    delete wrongName.tokens.color.semantic.accent;
    expectProfileIssue(wrongName, '$.tokens.color.semantic["Focus.Ring"]', "invalid-profile");

    const wrongSpace = createExampleDesignGuide();
    wrongSpace.tokens.color.semantic.accent = {
      $value: { colorSpace: "display-p3" as "srgb", components: [0, 0, 0] }
    };
    expectProfileIssue(wrongSpace, "$.tokens.color.semantic.accent.$value.colorSpace", "unsupported-profile");

    const outOfRange = createExampleDesignGuide();
    outOfRange.tokens.color.semantic.accent = {
      $value: { colorSpace: "srgb", components: [0, Number.NaN, 1.1], alpha: Infinity }
    };
    expectProfileIssue(outOfRange, "$.tokens.color.semantic.accent.$value.components[1]", "invalid-profile");
    expectProfileIssue(outOfRange, "$.tokens.color.semantic.accent.$value.alpha", "invalid-profile");

    const sparse = createExampleDesignGuide();
    sparse.tokens.color.semantic.accent = {
      $value: { colorSpace: "srgb", components: Array(3) as [number, number, number] }
    };
    expectProfileIssue(sparse, "$.tokens.color.semantic.accent.$value.components[0]", "invalid-profile");

    const hostileType = createExampleDesignGuide() as unknown as {
      tokens: { color: { semantic: { $type: unknown } } };
    };
    hostileType.tokens.color.semantic.$type = { toString: null, valueOf: null };
    expectProfileIssue(hostileType, "$.tokens.color.semantic.$type", "invalid-profile");
  });

  it("enforces exact font roles and plain family values", () => {
    const extraRole = createExampleDesignGuide();
    Object.assign(extraRole.tokens.font.family, { mono: { $value: "Mono" } });
    expectProfileIssue(extraRole, "$.tokens.font.family.mono", "invalid-profile");

    const tooMany = createExampleDesignGuide();
    tooMany.tokens.font.family.heading.$value = ["A", "B", "C", "D", "E"];
    expectProfileIssue(tooMany, "$.tokens.font.family.heading.$value", "invalid-profile");

    const importValue = createExampleDesignGuide();
    importValue.tokens.font.family.body.$value = "url(https://example.test/font.woff2)";
    expectProfileIssue(importValue, "$.tokens.font.family.body.$value", "invalid-profile");

    const sparse = createExampleDesignGuide();
    sparse.tokens.font.family.heading.$value = Array(2) as string[];
    expectProfileIssue(sparse, "$.tokens.font.family.heading.$value[0]", "invalid-profile");
  });

  it("enforces dimension scale counts, values, units, and token envelopes", () => {
    const oneToken = createExampleDesignGuide();
    delete oneToken.tokens.spacing.md;
    expectProfileIssue(oneToken, "$.tokens.spacing", "invalid-profile");

    const negative = createExampleDesignGuide();
    negative.tokens.radius.sm = { $value: { value: -1, unit: "px" } };
    expectProfileIssue(negative, "$.tokens.radius.sm.$value.value", "invalid-profile");

    const alias = createExampleDesignGuide();
    alias.tokens.spacing.sm = { $value: "{spacing.base}" } as never;
    expectProfileIssue(alias, "$.tokens.spacing.sm.$value", "unsupported-profile");
  });

  it("rejects deferred DTCG features with exact unsupported-profile paths", () => {
    const cases: Array<[Record<string, unknown>, string]> = [];

    const extension = structuredClone(createExampleDesignGuide()) as unknown as Record<string, unknown>;
    extension.$extensions = {};
    cases.push([extension, "$.$extensions"]);

    const extendsGuide = structuredClone(createExampleDesignGuide()) as unknown as {
      tokens: { spacing: Record<string, unknown> };
    };
    extendsGuide.tokens.spacing.$extends = "base";
    cases.push([extendsGuide as unknown as Record<string, unknown>, "$.tokens.spacing.$extends"]);

    const metadata = structuredClone(createExampleDesignGuide()) as unknown as {
      tokens: { spacing: { sm: Record<string, unknown> } };
    };
    metadata.tokens.spacing.sm.$description = "small";
    cases.push([metadata as unknown as Record<string, unknown>, "$.tokens.spacing.sm.$description"]);

    const colorReference = structuredClone(createExampleDesignGuide()) as unknown as {
      tokens: { color: { semantic: { accent: { $value: { components: unknown[] } } } } };
    };
    colorReference.tokens.color.semantic.accent.$value.components[0] = { $ref: "#/tokens/color/base" };
    cases.push([
      colorReference as unknown as Record<string, unknown>,
      "$.tokens.color.semantic.accent.$value.components[0].$ref"
    ]);

    const dimensionReference = structuredClone(createExampleDesignGuide()) as unknown as {
      tokens: { spacing: { sm: { $value: { value: unknown } } } };
    };
    dimensionReference.tokens.spacing.sm.$value.value = { $ref: "#/tokens/spacing/base" };
    cases.push([
      dimensionReference as unknown as Record<string, unknown>,
      "$.tokens.spacing.sm.$value.value.$ref"
    ]);

    for (const [guide, path] of cases) {
      expectProfileIssue(guide, path, "unsupported-profile");
    }
  });

  it("enforces catalog membership, uniqueness, and signature structural safety", () => {
    expectProfileIssue({ ...createExampleDesignGuide(), prohibitions: [] }, "$.prohibitions", "invalid-profile");
    expectProfileIssue(
      { ...createExampleDesignGuide(), prohibitions: ["generic-card-grid", "generic-card-grid"] },
      "$.prohibitions[1]",
      "invalid-profile"
    );
    expectProfileIssue(
      { ...createExampleDesignGuide(), prohibitions: ["not-in-catalog"] },
      "$.prohibitions[0]",
      "invalid-profile"
    );
    expectProfileIssue(
      { ...createExampleDesignGuide(), prohibitions: Array(1) },
      "$.prohibitions[0]",
      "invalid-profile"
    );

    for (const signatureElement of [
      "",
      "x".repeat(281),
      "line one\nline two",
      "unsafe <!-- marker",
      "unsafe --> marker",
      "unsafe ``` fence",
      "unsafe ~~~ fence",
      "@AGENTS.md",
      "\u202eoverride",
      "unsafe\u200cjoiner",
      "unsafe\u200djoiner",
      "unsafe\u2028separator",
      "unsafe\u2029separator",
      "unsafe\u2060joiner",
      "\ud800"
    ]) {
      expect(() => assertDesignGuideProfile({ ...createExampleDesignGuide(), signatureElement })).toThrow(
        DesignGuideProfileError
      );
    }

    const loneSurrogateFont = createExampleDesignGuide();
    loneSurrogateFont.tokens.font.family.body.$value = "Unsafe\ud800Font";
    expectProfileIssue(loneSurrogateFont, "$.tokens.font.family.body.$value", "invalid-profile");
  });

  it("escapes untrusted property names in structured issues and aggregate diagnostics", () => {
    const guide = createExampleDesignGuide() as unknown as {
      tokens: { color: { semantic: Record<string, unknown> } };
    };
    guide.tokens.color.semantic["bad\nname"] = { $value: { colorSpace: "srgb", components: [0, 0, 0] } };
    guide.tokens.color.semantic["bad\u001b[31mname"] = { $value: { colorSpace: "srgb", components: [0, 0, 0] } };

    try {
      assertDesignGuideProfile(guide);
      throw new Error("Expected profile validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignGuideProfileError);
      const profileError = error as DesignGuideProfileError;
      expect(profileError.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        '$.tokens.color.semantic["bad\\nname"]',
        '$.tokens.color.semantic["bad\\u001b[31mname"]'
      ]));
      expect(profileError.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    }
  });
});

function expectProfileIssue(value: unknown, path: string, code: string): void {
  try {
    assertDesignGuideProfile(value);
    throw new Error("Expected profile validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(DesignGuideProfileError);
    expect((error as DesignGuideProfileError).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path, code })])
    );
  }
}

function guideWithAdditionalFamilies(value: unknown): unknown {
  return {
    ...createExampleDesignGuide(),
    audit: { fontFamily: { additionalAllowedFamilies: value } }
  };
}
