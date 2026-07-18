import { describe, expect, it } from "vitest";
import {
  assertDesignGuideProfile,
  createExampleDesignGuide,
  DesignGuideProfileError,
  loadSchema,
  SCHEMA_VERSION,
  validateSchema
} from "./index.js";

describe("Design Guide Profile v0.5a-1", () => {
  it("keeps the additive closed schema and semantic fixture in lockstep", () => {
    const guide = createExampleDesignGuide();
    expect(SCHEMA_VERSION).toBe("0.2");
    expect(validateSchema("design-guide", guide)).toEqual({ valid: true, issues: [] });
    expect(() => assertDesignGuideProfile(guide)).not.toThrow();
    expect(loadSchema("design-guide")).toMatchObject({
      title: "DesignGuide",
      additionalProperties: false,
      properties: { schemaVersion: { const: "0.2" } }
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
