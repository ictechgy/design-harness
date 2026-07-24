import { SLOP_FINGERPRINT_CATALOG } from "./generated/slop-fingerprints.js";
import type {
  AllowedFontFamily,
  ColorAdherencePolicy,
  DesignGuide,
  DtcgColorValue,
  DtcgColorSemanticGroup,
  DtcgDimensionGroup,
  DtcgFontFamilyGroup,
  FontFamilyAdherencePolicy,
  FontFamilyKind,
  Rgba8Color
} from "./types.js";

export const DESIGN_GUIDE_PROFILE_ID = "design-guide-v0.5a-1" as const;
export const FONT_FAMILY_ADHERENCE_POLICY_ID = "font-family-adherence-v1" as const;
export const COLOR_ADHERENCE_POLICY_ID = "color-adherence-v1" as const;
export const GUIDE_CATALOG_VERSION = SLOP_FINGERPRINT_CATALOG.catalogVersion;

export const CSS_GENERIC_FONT_FAMILY_VALUES = [
  "serif",
  "sans-serif",
  "system-ui",
  "cursive",
  "fantasy",
  "math",
  "monospace",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "generic(fangsong)",
  "generic(kai)",
  "generic(khmer-mul)",
  "generic(nastaliq)"
] as const;

export type DesignGuideProfileIssueCode = "invalid-profile" | "unsupported-profile" | "sanitize";

export interface DesignGuideProfileIssue {
  path: string;
  code: DesignGuideProfileIssueCode;
  message: string;
}

export class DesignGuideProfileError extends Error {
  constructor(public readonly issues: DesignGuideProfileIssue[]) {
    super(`Design guide profile validation failed: ${issues.map(formatIssue).join("; ")}`);
    this.name = "DesignGuideProfileError";
  }
}

const LOWER_KEBAB_PATTERN = /^[a-z][a-z0-9-]*$/u;
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u;
const DIAGNOSTIC_PATH_SEGMENT_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/u;
const IMPORT_LIKE_PATTERN = /^\s*@(?:AGENTS|CLAUDE)\.md\b/iu;
const URL_OR_IMPORT_PATTERN = /(?:^[a-z][a-z0-9+.-]*:|\burl\s*\(|^\s*@import\b)/iu;
const UNSUPPORTED_KEYS = new Set([
  "$extensions",
  "$extends",
  "$root",
  "$description",
  "imports",
  "sources",
  "sourcePath",
  "tokenFile"
]);
const CATALOG_IDS = new Set<string>(SLOP_FINGERPRINT_CATALOG.entries.map((entry) => entry.id));
const CSS_GENERIC_FONT_FAMILY_VALUE_SET = new Set<string>(CSS_GENERIC_FONT_FAMILY_VALUES);

export function assertDesignGuideProfile(value: unknown): asserts value is DesignGuide {
  const issues: DesignGuideProfileIssue[] = [];
  if (!isRecord(value)) {
    throw new DesignGuideProfileError([invalid("$", "must be an object")]);
  }

  checkExactKeys(
    value,
    ["schemaVersion", "tokens", "prohibitions", "signatureElement", "audit"],
    "$",
    issues,
    ["audit"]
  );
  if (!hasOwn(value, "schemaVersion") || value.schemaVersion !== "0.2") {
    issues.push(invalid("$.schemaVersion", "must equal 0.2"));
  }

  validateTokens(hasOwn(value, "tokens") ? value.tokens : undefined, "$.tokens", issues);
  validateProhibitions(
    hasOwn(value, "prohibitions") ? value.prohibitions : undefined,
    "$.prohibitions",
    issues
  );
  validateSignature(
    hasOwn(value, "signatureElement") ? value.signatureElement : undefined,
    "$.signatureElement",
    issues
  );
  if (hasOwn(value, "audit")) {
    validateAudit(value.audit, "$.audit", issues);
  }

  if (issues.length > 0) {
    throw new DesignGuideProfileError(issues);
  }
}

export function projectFontFamilyAdherencePolicy(designGuide: DesignGuide): FontFamilyAdherencePolicy {
  assertDesignGuideProfile(designGuide);
  const allowedFamilies: AllowedFontFamily[] = [];
  const seen = new Set<string>();

  for (const role of ["heading", "body"] as const) {
    const tokenValue = designGuide.tokens.font.family[role].$value;
    const families = typeof tokenValue === "string" ? [tokenValue] : tokenValue;
    for (const value of families) {
      const kind = classifyFontFamily(value);
      const identity = fontFamilyComparisonIdentity(value, kind);
      if (!seen.has(identity)) {
        seen.add(identity);
        allowedFamilies.push({ value, kind });
      }
    }
  }

  for (const family of designGuide.audit?.fontFamily?.additionalAllowedFamilies ?? []) {
    const identity = fontFamilyComparisonIdentity(family.value, family.kind);
    if (!seen.has(identity)) {
      seen.add(identity);
      allowedFamilies.push({ value: family.value, kind: family.kind });
    }
  }

  return {
    allowedFamilies,
    ignoreSelectors: [...(designGuide.audit?.fontFamily?.ignoreSelectors ?? [])],
    policyId: FONT_FAMILY_ADHERENCE_POLICY_ID
  };
}

export function projectColorAdherencePolicy(designGuide: DesignGuide): ColorAdherencePolicy {
  assertDesignGuideProfile(designGuide);
  const allowedColors: Rgba8Color[] = [];
  const seen = new Set<string>();

  for (const [name, token] of Object.entries(designGuide.tokens.color.semantic)) {
    if (name === "$type" || typeof token === "string") {
      continue;
    }
    const color = dtcgColorToRgba8(token.$value);
    const identity = rgba8ColorIdentity(color);
    if (!seen.has(identity)) {
      seen.add(identity);
      allowedColors.push(color);
    }
  }

  return {
    allowedColors,
    ignoreSelectors: [...(designGuide.audit?.color?.ignoreSelectors ?? [])],
    policyId: COLOR_ADHERENCE_POLICY_ID
  };
}

export function dtcgColorToRgba8(value: DtcgColorValue): Rgba8Color {
  return {
    red: normalizedColorComponentToByte(value.components[0]),
    green: normalizedColorComponentToByte(value.components[1]),
    blue: normalizedColorComponentToByte(value.components[2]),
    alpha: normalizedColorComponentToByte(value.alpha ?? 1)
  };
}

export function rgba8ColorIdentity(value: Rgba8Color): string {
  return `${value.red},${value.green},${value.blue},${value.alpha}`;
}

function normalizedColorComponentToByte(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

export function classifyFontFamily(value: string): FontFamilyKind {
  return CSS_GENERIC_FONT_FAMILY_VALUE_SET.has(foldAsciiCase(value)) ? "generic" : "named";
}

export function fontFamilyComparisonIdentity(value: string, kind: FontFamilyKind): string {
  return `${kind}\u0000${foldAsciiCase(value)}`;
}

export function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}

function validateAudit(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (!isRecord(value)) {
    issues.push(invalid(path, "must be an object"));
    return;
  }
  checkExactKeys(value, ["fontFamily", "color"], path, issues, ["fontFamily", "color"]);
  if (!hasOwn(value, "fontFamily") && !hasOwn(value, "color")) {
    issues.push(invalid(path, "must contain fontFamily or color"));
  }
  if (hasOwn(value, "fontFamily")) {
    validateFontFamilyAudit(value.fontFamily, `${path}.fontFamily`, issues);
  }
  if (hasOwn(value, "color")) {
    validateColorAudit(value.color, `${path}.color`, issues);
  }
}

function validateFontFamilyAudit(
  fontFamily: unknown,
  fontFamilyPath: string,
  issues: DesignGuideProfileIssue[]
): void {
  if (!isRecord(fontFamily)) {
    issues.push(invalid(fontFamilyPath, "must be an object"));
    return;
  }
  checkExactKeys(
    fontFamily,
    ["additionalAllowedFamilies", "ignoreSelectors"],
    fontFamilyPath,
    issues,
    ["additionalAllowedFamilies", "ignoreSelectors"]
  );
  if (!hasOwn(fontFamily, "additionalAllowedFamilies") && !hasOwn(fontFamily, "ignoreSelectors")) {
    issues.push(invalid(fontFamilyPath, "must contain additionalAllowedFamilies or ignoreSelectors"));
  }
  if (hasOwn(fontFamily, "additionalAllowedFamilies")) {
    validateAdditionalAllowedFamilies(
      fontFamily.additionalAllowedFamilies,
      `${fontFamilyPath}.additionalAllowedFamilies`,
      issues
    );
  }
  if (hasOwn(fontFamily, "ignoreSelectors")) {
    validateIgnoreSelectors(fontFamily.ignoreSelectors, `${fontFamilyPath}.ignoreSelectors`, issues);
  }
}

function validateColorAudit(
  color: unknown,
  colorPath: string,
  issues: DesignGuideProfileIssue[]
): void {
  if (!isRecord(color)) {
    issues.push(invalid(colorPath, "must be an object"));
    return;
  }
  checkExactKeys(color, ["ignoreSelectors"], colorPath, issues);
  if (!hasOwn(color, "ignoreSelectors")) {
    issues.push(invalid(`${colorPath}.ignoreSelectors`, "must contain 1..32 unique selectors"));
    return;
  }
  validateIgnoreSelectors(color.ignoreSelectors, `${colorPath}.ignoreSelectors`, issues);
}

function validateAdditionalAllowedFamilies(
  value: unknown,
  path: string,
  issues: DesignGuideProfileIssue[]
): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    issues.push(invalid(path, "must contain 1..32 unique allowed font families"));
    return;
  }

  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    if (!hasOwn(value, index)) {
      issues.push(invalid(itemPath, "must be an allowed font family object"));
      continue;
    }

    const family = value[index];
    if (!isRecord(family)) {
      issues.push(invalid(itemPath, "must be an allowed font family object"));
      continue;
    }

    checkExactKeys(family, ["value", "kind"], itemPath, issues);
    const familyValue = hasOwn(family, "value") ? family.value : undefined;
    const kind = hasOwn(family, "kind") ? family.kind : undefined;
    const valuePath = `${itemPath}.value`;
    const kindPath = `${itemPath}.kind`;
    const validValue = typeof familyValue === "string"
      && [...familyValue].length >= 1
      && [...familyValue].length <= 128
      && familyValue === familyValue.trim()
      && !hasUnpairedSurrogate(familyValue)
      && !CONTROL_OR_BIDI_PATTERN.test(familyValue)
      && !URL_OR_IMPORT_PATTERN.test(familyValue);

    if (!validValue) {
      issues.push(invalid(
        valuePath,
        "must be a trim-stable plain local font family name of 1..128 safe Unicode scalar values"
      ));
    }
    if (kind !== "named" && kind !== "generic") {
      issues.push(invalid(kindPath, "must equal named or generic"));
    } else if (
      kind === "generic"
      && typeof familyValue === "string"
      && !CSS_GENERIC_FONT_FAMILY_VALUE_SET.has(foldAsciiCase(familyValue))
    ) {
      issues.push(invalid(valuePath, "must be a supported CSS generic font family when kind is generic"));
    }

    if (validValue && (kind === "named" || kind === "generic")) {
      const identity = fontFamilyComparisonIdentity(familyValue, kind);
      if (seen.has(identity)) {
        issues.push(invalid(itemPath, "duplicates an earlier allowed font family"));
      } else {
        seen.add(identity);
      }
    }
  }
}

function validateIgnoreSelectors(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    issues.push(invalid(path, "must contain 1..32 unique selectors"));
    return;
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const selector = value[index];
    const itemPath = `${path}[${index}]`;
    if (
      typeof selector !== "string"
      || [...selector].length < 1
      || [...selector].length > 256
      || selector !== selector.trim()
      || hasUnpairedSurrogate(selector)
      || CONTROL_OR_BIDI_PATTERN.test(selector)
    ) {
      issues.push(invalid(itemPath, "must be a trim-stable selector of 1..256 safe Unicode scalar values"));
    } else if (seen.has(selector)) {
      issues.push(invalid(itemPath, "duplicates an earlier selector"));
    }
    if (typeof selector === "string") {
      seen.add(selector);
    }
  }
}

function validateTokens(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (!isRecord(value)) {
    issues.push(invalid(path, "must be an object"));
    return;
  }
  checkExactKeys(value, ["color", "font", "spacing", "radius"], path, issues);
  validateColor(hasOwn(value, "color") ? value.color : undefined, `${path}.color`, issues);
  validateFont(hasOwn(value, "font") ? value.font : undefined, `${path}.font`, issues);
  validateDimensionGroup(hasOwn(value, "spacing") ? value.spacing : undefined, `${path}.spacing`, issues);
  validateDimensionGroup(hasOwn(value, "radius") ? value.radius : undefined, `${path}.radius`, issues);
}

function validateColor(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (!isRecord(value)) {
    issues.push(invalid(path, "must be an object"));
    return;
  }
  checkExactKeys(value, ["semantic"], path, issues);
  const semantic = hasOwn(value, "semantic") ? value.semantic : undefined;
  if (!isRecord(semantic)) {
    issues.push(invalid(`${path}.semantic`, "must be an object"));
    return;
  }

  const semanticPath = `${path}.semantic`;
  validateGroupType(semantic, "color", semanticPath, issues);
  const names = dynamicTokenNames(semantic, semanticPath, issues);
  if (names.length < 4 || names.length > 6) {
    issues.push(invalid(semanticPath, "must contain 4..6 semantic color tokens"));
  }
  validateTokenNames(names, semanticPath, issues);
  for (const name of names) {
    validateColorToken(semantic[name], appendDiagnosticPath(semanticPath, name), issues);
  }
}

function validateColorToken(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  const tokenValue = validateTokenEnvelope(value, path, issues);
  if (tokenValue === INVALID) {
    return;
  }
  if (typeof tokenValue === "string" && looksLikeAlias(tokenValue)) {
    issues.push(unsupported(`${path}.$value`, "aliases and references are not supported"));
    return;
  }
  if (!isRecord(tokenValue)) {
    issues.push(invalid(`${path}.$value`, "must be an srgb color object"));
    return;
  }
  checkExactKeys(tokenValue, ["colorSpace", "components", "alpha"], `${path}.$value`, issues, ["alpha"]);
  if (!hasOwn(tokenValue, "colorSpace") || tokenValue.colorSpace !== "srgb") {
    issues.push(unsupported(`${path}.$value.colorSpace`, "only literal srgb colors are supported"));
  }
  const components = hasOwn(tokenValue, "components") ? tokenValue.components : undefined;
  if (!Array.isArray(components) || components.length !== 3) {
    issues.push(invalid(`${path}.$value.components`, "must contain exactly three components"));
  } else {
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (isReferenceObject(component)) {
        issues.push(unsupported(`${path}.$value.components[${index}].$ref`, "references are not supported"));
      } else if (!isUnitNumber(component)) {
        issues.push(invalid(`${path}.$value.components[${index}]`, "must be finite and within 0..1"));
      }
    }
  }
  if (hasOwn(tokenValue, "alpha")) {
    if (isReferenceObject(tokenValue.alpha)) {
      issues.push(unsupported(`${path}.$value.alpha.$ref`, "references are not supported"));
    } else if (!isUnitNumber(tokenValue.alpha)) {
      issues.push(invalid(`${path}.$value.alpha`, "must be finite and within 0..1"));
    }
  }
}

function validateFont(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (!isRecord(value)) {
    issues.push(invalid(path, "must be an object"));
    return;
  }
  checkExactKeys(value, ["family"], path, issues);
  const family = hasOwn(value, "family") ? value.family : undefined;
  if (!isRecord(family)) {
    issues.push(invalid(`${path}.family`, "must be an object"));
    return;
  }
  const familyPath = `${path}.family`;
  checkExactKeys(family, ["$type", "heading", "body"], familyPath, issues);
  validateGroupType(family, "fontFamily", familyPath, issues);
  for (const role of ["heading", "body"] as const) {
    const tokenPath = `${familyPath}.${role}`;
    const tokenValue = validateTokenEnvelope(hasOwn(family, role) ? family[role] : undefined, tokenPath, issues);
    if (tokenValue === INVALID) {
      continue;
    }
    if (typeof tokenValue === "string" && looksLikeAlias(tokenValue)) {
      issues.push(unsupported(`${tokenPath}.$value`, "aliases and references are not supported"));
      continue;
    }
    const values = typeof tokenValue === "string" ? [tokenValue] : tokenValue;
    if (!Array.isArray(values) || values.length < 1 || values.length > 4) {
      issues.push(invalid(`${tokenPath}.$value`, "must be a string or an array of 1..4 strings"));
      continue;
    }
    for (let index = 0; index < values.length; index += 1) {
      const font = values[index];
      const itemPath = Array.isArray(tokenValue) ? `${tokenPath}.$value[${index}]` : `${tokenPath}.$value`;
      if (isReferenceObject(font)) {
        issues.push(unsupported(`${itemPath}.$ref`, "references are not supported"));
      } else if (typeof font !== "string" || font.length === 0 || font !== font.trim()) {
        issues.push(invalid(itemPath, "must be a nonblank trim-stable font family"));
      } else if (
        hasUnpairedSurrogate(font)
        || CONTROL_OR_BIDI_PATTERN.test(font)
        || URL_OR_IMPORT_PATTERN.test(font)
      ) {
        issues.push(invalid(itemPath, "must be a plain local font family name"));
      }
    }
  }
}

function validateDimensionGroup(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (!isRecord(value)) {
    issues.push(invalid(path, "must be an object"));
    return;
  }
  validateGroupType(value, "dimension", path, issues);
  const names = dynamicTokenNames(value, path, issues);
  if (names.length < 2 || names.length > 12) {
    issues.push(invalid(path, "must contain 2..12 dimension tokens"));
  }
  validateTokenNames(names, path, issues);
  for (const name of names) {
    const tokenPath = appendDiagnosticPath(path, name);
    const tokenValue = validateTokenEnvelope(value[name], tokenPath, issues);
    if (tokenValue === INVALID) {
      continue;
    }
    if (typeof tokenValue === "string" && looksLikeAlias(tokenValue)) {
      issues.push(unsupported(`${tokenPath}.$value`, "aliases and references are not supported"));
      continue;
    }
    if (!isRecord(tokenValue)) {
      issues.push(invalid(`${tokenPath}.$value`, "must be a literal dimension object"));
      continue;
    }
    checkExactKeys(tokenValue, ["value", "unit"], `${tokenPath}.$value`, issues);
    if (!hasOwn(tokenValue, "value")) {
      issues.push(invalid(`${tokenPath}.$value.value`, "must be a finite number >= 0"));
    } else if (isReferenceObject(tokenValue.value)) {
      issues.push(unsupported(`${tokenPath}.$value.value.$ref`, "references are not supported"));
    } else if (!isNonNegativeFiniteNumber(tokenValue.value)) {
      issues.push(invalid(`${tokenPath}.$value.value`, "must be a finite number >= 0"));
    }
    if (hasOwn(tokenValue, "unit") && isReferenceObject(tokenValue.unit)) {
      issues.push(unsupported(`${tokenPath}.$value.unit.$ref`, "references are not supported"));
    } else if (!hasOwn(tokenValue, "unit") || (tokenValue.unit !== "px" && tokenValue.unit !== "rem")) {
      issues.push(invalid(`${tokenPath}.$value.unit`, "must equal px or rem"));
    }
  }
}

function validateTokenEnvelope(
  value: unknown,
  path: string,
  issues: DesignGuideProfileIssue[]
): unknown | typeof INVALID {
  if (!isRecord(value)) {
    issues.push(invalid(path, "must be a token object"));
    return INVALID;
  }
  if (hasOwn(value, "$type") && !hasOwn(value, "$value")) {
    issues.push(unsupported(path, "nested token groups are not supported"));
  }
  checkExactKeys(value, ["$value"], path, issues);
  if (!hasOwn(value, "$value")) {
    return INVALID;
  }
  if (isReferenceObject(value.$value)) {
    issues.push(unsupported(`${path}.$value.$ref`, "references are not supported"));
    return INVALID;
  }
  return value.$value;
}

function validateGroupType(
  group: Record<string, unknown>,
  expected: string,
  path: string,
  issues: DesignGuideProfileIssue[]
): void {
  if (!hasOwn(group, "$type")) {
    issues.push(invalid(`${path}.$type`, `must equal ${expected}`));
    return;
  }
  if (group.$type === expected) {
    return;
  }
  if (typeof group.$type === "string"
    && ["gradient", "shadow", "typography", "border", "transition", "strokeStyle"].includes(group.$type)) {
    issues.push(unsupported(`${path}.$type`, `token type ${diagnosticLiteral(group.$type)} is not supported`));
  } else {
    issues.push(invalid(`${path}.$type`, `must equal ${expected}`));
  }
}

function validateTokenNames(names: string[], path: string, issues: DesignGuideProfileIssue[]): void {
  for (const name of names) {
    if (!LOWER_KEBAB_PATTERN.test(name)) {
      issues.push(invalid(appendDiagnosticPath(path, name), "token names must be ASCII lower-kebab"));
    }
  }
}

function dynamicTokenNames(
  group: Record<string, unknown>,
  path: string,
  issues: DesignGuideProfileIssue[]
): string[] {
  const names: string[] = [];
  for (const key of Object.keys(group)) {
    if (key === "$type") {
      continue;
    }
    if (isUnsupportedKey(key)) {
      issues.push(unsupported(appendDiagnosticPath(path, key), "is outside the supported profile"));
      continue;
    }
    names.push(key);
  }
  return names;
}

function validateProhibitions(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    issues.push(invalid(path, "must contain 1..8 catalog ids"));
    return;
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    const itemPath = `${path}[${index}]`;
    if (typeof id !== "string" || !LOWER_KEBAB_PATTERN.test(id)) {
      issues.push(invalid(itemPath, "must be a lower-kebab catalog id"));
    } else if (seen.has(id)) {
      issues.push(invalid(itemPath, `duplicates catalog id ${id}`));
    } else if (!CATALOG_IDS.has(id)) {
      issues.push(invalid(itemPath, `unknown fingerprint catalog id ${id}`));
    }
    if (typeof id === "string") {
      seen.add(id);
    }
  }
}

function validateSignature(value: unknown, path: string, issues: DesignGuideProfileIssue[]): void {
  if (typeof value !== "string") {
    issues.push(invalid(path, "must be a string"));
    return;
  }
  const normalized = value.normalize("NFC");
  const length = [...normalized].length;
  if (hasUnpairedSurrogate(normalized) || length < 1 || length > 280) {
    issues.push(invalid(path, "must contain 1..280 Unicode scalar values"));
  }
  if (normalized !== normalized.trim()) {
    issues.push(invalid(path, "must not have leading or trailing whitespace"));
  }
  if (CONTROL_OR_BIDI_PATTERN.test(normalized)) {
    issues.push(sanitize(path, "must be one line without control, zero-width, or bidi characters"));
  }
  if (
    normalized.includes("<!--") ||
    normalized.includes("-->") ||
    normalized.includes("design-harness:guide:begin") ||
    normalized.includes("design-harness:guide:end") ||
    normalized.includes("```") ||
    normalized.includes("~~~")
  ) {
    issues.push(sanitize(path, "contains a reserved guide or Markdown structural delimiter"));
  }
  if (IMPORT_LIKE_PATTERN.test(normalized) || normalized.trimStart().startsWith("@")) {
    issues.push(sanitize(path, "must not begin with an agent import directive"));
  }
}

function checkExactKeys(
  value: Record<string, unknown>,
  requiredAndAllowed: string[],
  path: string,
  issues: DesignGuideProfileIssue[],
  optional: string[] = []
): void {
  const allowed = new Set(requiredAndAllowed);
  const optionalSet = new Set(optional);
  for (const required of requiredAndAllowed) {
    if (!optionalSet.has(required) && !hasOwn(value, required)) {
      issues.push(invalid(`${path}.${required}`, "is required"));
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      const issuePath = appendDiagnosticPath(path, key);
      issues.push(isUnsupportedKey(key) ? unsupported(issuePath, "is outside the supported profile") : invalid(issuePath, "is not allowed"));
    }
  }
}

function isUnsupportedKey(key: string): boolean {
  return key.startsWith("$") || UNSUPPORTED_KEYS.has(key);
}

function looksLikeAlias(value: string): boolean {
  return /^\{[^{}]+\}$/u.test(value.trim());
}

function isReferenceObject(value: unknown): value is Record<"$ref", unknown> {
  return isRecord(value) && hasOwn(value, "$ref");
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function appendDiagnosticPath(path: string, segment: string): string {
  return DIAGNOSTIC_PATH_SEGMENT_PATTERN.test(segment)
    ? `${path}.${segment}`
    : `${path}[${diagnosticLiteral(segment)}]`;
}

function diagnosticLiteral(value: unknown): string {
  return JSON.stringify(diagnosticText(value)).replace(/[\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/gu, (character) => (
    `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`
  ));
}

function diagnosticText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (["number", "boolean", "bigint", "undefined", "symbol"].includes(typeof value)) {
    return String(value);
  }
  return Array.isArray(value) ? "[array]" : "[object]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function invalid(path: string, message: string): DesignGuideProfileIssue {
  return { path, code: "invalid-profile", message };
}

function unsupported(path: string, message: string): DesignGuideProfileIssue {
  return { path, code: "unsupported-profile", message };
}

function sanitize(path: string, message: string): DesignGuideProfileIssue {
  return { path, code: "sanitize", message };
}

function formatIssue(issue: DesignGuideProfileIssue): string {
  return `${issue.code} ${issue.path} ${issue.message}`;
}

const INVALID = Symbol("invalid-design-guide-profile-value");

export type NormalizedDesignGuide = DesignGuide & {
  tokens: {
    color: { semantic: DtcgColorSemanticGroup };
    font: { family: DtcgFontFamilyGroup };
    spacing: DtcgDimensionGroup;
    radius: DtcgDimensionGroup;
  };
};
