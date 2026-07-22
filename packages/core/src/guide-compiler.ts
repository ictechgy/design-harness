import { createHash } from "node:crypto";
import copyStyleSchema from "../schemas/copy-style.schema.json" with { type: "json" };
import {
  assertDesignGuideProfile,
  DESIGN_GUIDE_PROFILE_ID,
  GUIDE_CATALOG_VERSION
} from "./design-guide.js";
import { SLOP_FINGERPRINT_CATALOG } from "./generated/slop-fingerprints.js";
import type { JsonSchema } from "./schema-registry.js";
import type {
  CopyStyle,
  CopyStyleBannedPhrase,
  CopyStyleGlossaryTerm,
  CopySurface,
  CopyRegister,
  DesignGuide,
  DesignGuideTokens
} from "./types.js";
import { SchemaValidationError, validateAgainstSchema } from "./validation.js";

export const GUIDE_TOKEN_ESTIMATE_METHOD = "guide-token-estimate-v1" as const;
export const GUIDE_TOKEN_HARD_CEILING = 2000 as const;

export type GuideRuleEffect = "require" | "avoid";
export type GuideCompilationPhase = "sanitize" | "contradiction" | "budget";

export interface GuideRule {
  id: string;
  name: string;
  effect: GuideRuleEffect;
  subject: string;
  description: string;
  badExample: string;
  goodExample: string;
}

export interface GuideTokenEstimate {
  method: typeof GUIDE_TOKEN_ESTIMATE_METHOD;
  estimated: number;
}

export interface DesignHarnessTokenProvenance {
  profile: typeof DESIGN_GUIDE_PROFILE_ID;
  catalogVersion: typeof GUIDE_CATALOG_VERSION;
  sourceHash: string;
}

export type CompiledDesignTokens = DesignGuideTokens & {
  $extensions: {
    "dev.design-harness": DesignHarnessTokenProvenance;
  };
};

export interface GuideCompilationResult {
  profileId: typeof DESIGN_GUIDE_PROFILE_ID;
  catalogVersion: typeof GUIDE_CATALOG_VERSION;
  sourceHash: string;
  rules: GuideRule[];
  markdown: string;
  designTokens: CompiledDesignTokens;
  designTokensJson: string;
  tokenEstimate: GuideTokenEstimate;
}

export class GuideCompileError extends Error {
  constructor(
    public readonly phase: GuideCompilationPhase,
    message: string,
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = "GuideCompileError";
  }
}

interface SafeCopyProjection {
  locale: string;
  surfaceRegisters?: Partial<Record<CopySurface, CopyRegister>>;
  glossary?: Array<{
    term: string;
    tier: CopyStyleGlossaryTerm["tier"];
    preferredTerm?: string;
    surfaces?: CopySurface[];
  }>;
  bannedPhrases?: Array<{
    phrase: string;
    suggestedReplacement?: string;
    surfaces?: CopySurface[];
  }>;
}

interface FingerprintEntry {
  id: string;
  name: string;
  description: string;
  badExample: string;
  goodExample: string;
  conflictsWith: readonly string[];
}

const COPY_SURFACE_ORDER: CopySurface[] = ["button", "error", "marketing", "body"];
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u;
const CATALOG_BY_ID = new Map<string, FingerprintEntry>(
  SLOP_FINGERPRINT_CATALOG.entries.map((entry) => [entry.id, entry])
);
const COPY_STYLE_SCHEMA = copyStyleSchema as unknown as JsonSchema;

export function compileDesignGuide(designGuide: DesignGuide, copyStyle?: CopyStyle): GuideCompilationResult {
  assertDesignGuideProfile(designGuide);
  if (copyStyle !== undefined) {
    assertValidCopyStyle(copyStyle);
  }
  const normalizedGuide = normalizeDesignGuide(designGuide);
  const safeCopy = copyStyle === undefined ? undefined : projectCopyStyle(copyStyle);
  const fingerprints = normalizedGuide.prohibitions.map((id) => {
    const entry = CATALOG_BY_ID.get(id);
    if (!entry) {
      throw new GuideCompileError("contradiction", `Unknown fingerprint catalog id ${id}.`);
    }
    return entry;
  });
  assertNoFingerprintConflicts(fingerprints);
  assertNoCopyContradictions(safeCopy);

  const sourceHash = hashCanonical({
    profile: DESIGN_GUIDE_PROFILE_ID,
    catalogVersion: GUIDE_CATALOG_VERSION,
    guide: normalizedGuide,
    copy: safeCopy ?? null,
    fingerprints
  });
  const rules = [
    ...buildTokenRules(normalizedGuide.tokens),
    buildSignatureRule(normalizedGuide.signatureElement),
    ...buildFingerprintRules(fingerprints),
    ...buildCopyRules(safeCopy)
  ];
  assertRuleIntegrity(rules);

  const markdown = renderGuideMarkdown(rules, sourceHash);
  const tokenEstimate = estimateGuideTokens(markdown);
  if (tokenEstimate.estimated > GUIDE_TOKEN_HARD_CEILING) {
    throw new GuideCompileError(
      "budget",
      `${GUIDE_TOKEN_ESTIMATE_METHOD} estimated ${tokenEstimate.estimated}, exceeding ceiling ${GUIDE_TOKEN_HARD_CEILING}.`,
      [`estimated=${tokenEstimate.estimated}`, `ceiling=${GUIDE_TOKEN_HARD_CEILING}`]
    );
  }

  const designTokens = canonicalize({
    ...normalizedGuide.tokens,
    $extensions: {
      "dev.design-harness": {
        profile: DESIGN_GUIDE_PROFILE_ID,
        catalogVersion: GUIDE_CATALOG_VERSION,
        sourceHash
      }
    }
  }) as CompiledDesignTokens;
  const designTokensJson = `${JSON.stringify(designTokens, null, 2)}\n`;

  return {
    profileId: DESIGN_GUIDE_PROFILE_ID,
    catalogVersion: GUIDE_CATALOG_VERSION,
    sourceHash,
    rules,
    markdown,
    designTokens,
    designTokensJson,
    tokenEstimate
  };
}

export function estimateGuideTokens(markdown: string): GuideTokenEstimate {
  const normalized = markdown.replace(/\r\n?/gu, "\n").normalize("NFC");
  const codePoints = [...normalized].length;
  const utf8Bytes = new TextEncoder().encode(normalized).byteLength;
  return {
    method: GUIDE_TOKEN_ESTIMATE_METHOD,
    estimated: Math.max(codePoints, Math.ceil(utf8Bytes / 2))
  };
}

export function assertGuideTokenCeiling(estimate: GuideTokenEstimate, ceiling: number): void {
  if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > GUIDE_TOKEN_HARD_CEILING) {
    throw new GuideCompileError(
      "budget",
      `Guide token ceiling must be an integer within 1..${GUIDE_TOKEN_HARD_CEILING}.`
    );
  }
  if (estimate.estimated > ceiling) {
    throw new GuideCompileError(
      "budget",
      `${GUIDE_TOKEN_ESTIMATE_METHOD} estimated ${estimate.estimated}, exceeding ceiling ${ceiling}.`,
      [`estimated=${estimate.estimated}`, `ceiling=${ceiling}`]
    );
  }
}

type GenerationGuideProjection = Pick<
  DesignGuide,
  "schemaVersion" | "tokens" | "prohibitions" | "signatureElement"
>;

function normalizeDesignGuide(guide: DesignGuide): GenerationGuideProjection {
  return {
    schemaVersion: "0.2",
    tokens: canonicalize(normalizeStrings(guide.tokens)) as DesignGuideTokens,
    prohibitions: [...guide.prohibitions].sort(codePointCompare),
    signatureElement: guide.signatureElement.normalize("NFC")
  };
}

function projectCopyStyle(copyStyle: CopyStyle): SafeCopyProjection {
  const locale = normalizeSafeText(copyStyle.locale, "copyStyle.locale");
  const surfaceRegisters: Partial<Record<CopySurface, CopyRegister>> = {};
  for (const surface of COPY_SURFACE_ORDER) {
    const register = copyStyle.surfaceRegisters?.[surface];
    if (register) {
      surfaceRegisters[surface] = register;
    }
  }

  const glossary = (copyStyle.glossary ?? [])
    .filter((term) => term.match !== "lemma")
    .map((term, index) => normalizeGlossaryTerm(term, index))
    .sort((left, right) => compareMany(
      [left.term, left.tier, left.preferredTerm ?? "", ...(left.surfaces ?? [])],
      [right.term, right.tier, right.preferredTerm ?? "", ...(right.surfaces ?? [])]
    ));
  const bannedPhrases = (copyStyle.bannedPhrases ?? [])
    .map((phrase, index) => normalizeBannedPhrase(phrase, index))
    .sort((left, right) => compareMany(
      [left.phrase, left.suggestedReplacement ?? "", ...(left.surfaces ?? [])],
      [right.phrase, right.suggestedReplacement ?? "", ...(right.surfaces ?? [])]
    ));

  return canonicalize({
    locale,
    ...(Object.keys(surfaceRegisters).length > 0 ? { surfaceRegisters } : {}),
    ...(glossary.length > 0 ? { glossary } : {}),
    ...(bannedPhrases.length > 0 ? { bannedPhrases } : {})
  }) as SafeCopyProjection;
}

function normalizeGlossaryTerm(term: CopyStyleGlossaryTerm, index: number): NonNullable<SafeCopyProjection["glossary"]>[number] {
  const path = `copyStyle.glossary[${index}]`;
  return {
    term: normalizeSafeText(term.term, `${path}.term`),
    tier: term.tier,
    ...(term.preferredTerm ? { preferredTerm: normalizeSafeText(term.preferredTerm, `${path}.preferredTerm`) } : {}),
    ...(term.surfaces ? { surfaces: [...term.surfaces].sort(codePointCompare) } : {})
  };
}

function normalizeBannedPhrase(
  phrase: CopyStyleBannedPhrase,
  index: number
): NonNullable<SafeCopyProjection["bannedPhrases"]>[number] {
  const path = `copyStyle.bannedPhrases[${index}]`;
  return {
    phrase: normalizeSafeText(phrase.phrase, `${path}.phrase`),
    ...(phrase.suggestedReplacement
      ? { suggestedReplacement: normalizeSafeText(phrase.suggestedReplacement, `${path}.suggestedReplacement`) }
      : {}),
    ...(phrase.surfaces ? { surfaces: [...phrase.surfaces].sort(codePointCompare) } : {})
  };
}

function buildTokenRules(tokens: DesignGuideTokens): GuideRule[] {
  const summary = [
    `color(${summarizeTokenGroup(tokens.color.semantic, formatColorLiteral)})`,
    `font(${summarizeTokenGroup(tokens.font.family, formatFontLiteral)})`,
    `spacing(${summarizeTokenGroup(tokens.spacing, formatDimensionLiteral)})`,
    `radius(${summarizeTokenGroup(tokens.radius, formatDimensionLiteral)})`
  ].join("; ");
  return [{
    id: "tokens.design-system",
    name: "Design tokens",
    effect: "require",
    subject: `tokens:${compactJson(tokens)}`,
    description: "Use configured semantic colors, font roles, spacing, and radii.",
    badExample: "Use arbitrary one-off visual values.",
    goodExample: summary
  }];
}

function buildSignatureRule(signatureElement: string): GuideRule {
  return {
    id: "signature-element",
    name: "Signature element",
    effect: "require",
    subject: `signature-element:${normalizeSubject(signatureElement)}`,
    description: "Carry this signature into relevant UI work.",
    badExample: "Use only interchangeable defaults.",
    goodExample: signatureElement
  };
}

function buildFingerprintRules(fingerprints: FingerprintEntry[]): GuideRule[] {
  return [...fingerprints]
    .sort((left, right) => codePointCompare(left.id, right.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      effect: "avoid" as const,
      subject: `fingerprint:${entry.id}`,
      description: entry.description,
      badExample: entry.badExample,
      goodExample: entry.goodExample
    }));
}

function buildCopyRules(copy: SafeCopyProjection | undefined): GuideRule[] {
  if (!copy) {
    return [];
  }
  const localeAndRegisters = {
    locale: copy.locale,
    ...(copy.surfaceRegisters ? { surfaceRegisters: copy.surfaceRegisters } : {})
  };
  const rules: GuideRule[] = [{
    id: "copy.locale-registers",
    name: "Copy locale and registers",
    effect: "require",
    subject: `copy-locale-registers:${compactJson(localeAndRegisters)}`,
    description: "Use configured locale and surface registers.",
    badExample: "Use an unrelated locale or register.",
    goodExample: summarizeLocaleAndRegisters(copy)
  }];

  const requiredTerms = (copy.glossary ?? []).filter((term) => term.tier !== "banned");
  if (requiredTerms.length > 0) {
    rules.push({
      id: "copy.glossary.required",
      name: "Preferred glossary",
      effect: "require",
      subject: `copy-glossary-required:${compactJson(requiredTerms)}`,
      description: "Follow literal glossary tiers and preferred terms.",
      badExample: "Replace configured terms with arbitrary synonyms.",
      goodExample: requiredTerms.map(summarizeGlossaryTerm).join("; ")
    });
  }

  const avoidedCopy = [
    ...(copy.glossary ?? [])
      .filter((term) => term.tier === "banned")
      .map((term) => ({
        phrase: term.term,
        replacement: term.preferredTerm ?? "Use an approved term.",
        ...(term.surfaces ? { surfaces: term.surfaces } : {})
      })),
    ...(copy.bannedPhrases ?? []).map((phrase) => ({
      phrase: phrase.phrase,
      replacement: phrase.suggestedReplacement ?? "Use specific product language instead.",
      ...(phrase.surfaces ? { surfaces: phrase.surfaces } : {})
    }))
  ].sort((left, right) => compareMany(
    [left.phrase, ...(left.surfaces ?? [])],
    [right.phrase, ...(right.surfaces ?? [])]
  ));
  if (avoidedCopy.length > 0) {
    rules.push({
      id: "copy.glossary.avoid",
      name: "Banned copy",
      effect: "avoid",
      subject: `copy-glossary-avoid:${compactJson(avoidedCopy)}`,
      description: "Avoid banned terms and phrases.",
      badExample: compactJson(avoidedCopy.map((item) => scopedCopyText(item.phrase, item.surfaces))),
      goodExample: avoidedCopy
        .map((item) => `${scopedCopyText(item.phrase, item.surfaces)}→${item.replacement}`)
        .join("; ")
    });
  }
  return rules;
}

function assertNoFingerprintConflicts(fingerprints: FingerprintEntry[]): void {
  const selected = new Set(fingerprints.map((entry) => entry.id));
  const conflicts: string[] = [];
  for (const entry of fingerprints) {
    for (const conflictId of entry.conflictsWith) {
      if (selected.has(conflictId) && codePointCompare(entry.id, conflictId) < 0) {
        conflicts.push(`${entry.id} conflicts with ${conflictId}`);
      }
    }
  }
  if (conflicts.length > 0) {
    throw new GuideCompileError("contradiction", "Selected fingerprint rules conflict.", conflicts.sort(codePointCompare));
  }
}

function assertNoCopyContradictions(copy: SafeCopyProjection | undefined): void {
  if (!copy) {
    return;
  }
  const declarations: ScopedCopySubject[] = [];
  const required: ScopedCopySubject[] = [];
  const banned: ScopedCopySubject[] = [];
  for (const [index, term] of (copy.glossary ?? []).entries()) {
    const scope = copyScope(term.surfaces);
    declarations.push(scopedSubject(term.term, `glossary[${index}]`, scope));
    if (term.tier === "banned") {
      banned.push(scopedSubject(term.term, `glossary[${index}]`, scope));
      if (term.preferredTerm) {
        required.push(scopedSubject(term.preferredTerm, `glossary[${index}].preferredTerm`, scope));
      }
    } else {
      required.push(scopedSubject(term.term, `glossary[${index}].term`, scope));
      if (term.preferredTerm) {
        required.push(scopedSubject(term.preferredTerm, `glossary[${index}].preferredTerm`, scope));
      }
    }
  }
  assertNoScopedDuplicates(declarations, "Duplicate glossary declaration");

  for (const [index, phrase] of (copy.bannedPhrases ?? []).entries()) {
    const scope = copyScope(phrase.surfaces);
    banned.push(scopedSubject(phrase.phrase, `bannedPhrases[${index}]`, scope));
    if (phrase.suggestedReplacement) {
      required.push(scopedSubject(
        phrase.suggestedReplacement,
        `bannedPhrases[${index}].suggestedReplacement`,
        scope
      ));
    }
  }
  assertNoScopedDuplicates(banned, "Duplicate banned copy declaration");

  for (const requiredEntry of required) {
    const bannedEntry = banned.find((candidate) => (
      candidate.subject === requiredEntry.subject
      && scopesOverlap(candidate.surfaces, requiredEntry.surfaces)
    ));
    if (bannedEntry) {
      throw new GuideCompileError(
        "contradiction",
        "A preferred or approved copy term is also banned.",
        [requiredEntry.path, bannedEntry.path]
      );
    }
  }
}

interface ScopedCopySubject {
  subject: string;
  path: string;
  surfaces: ReadonlySet<CopySurface>;
}

function scopedSubject(
  value: string,
  path: string,
  surfaces: ReadonlySet<CopySurface>
): ScopedCopySubject {
  return { subject: normalizeSubject(value), path, surfaces };
}

function copyScope(surfaces: readonly CopySurface[] | undefined): ReadonlySet<CopySurface> {
  return new Set(surfaces ?? COPY_SURFACE_ORDER);
}

function scopesOverlap(left: ReadonlySet<CopySurface>, right: ReadonlySet<CopySurface>): boolean {
  return COPY_SURFACE_ORDER.some((surface) => left.has(surface) && right.has(surface));
}

function assertNoScopedDuplicates(entries: readonly ScopedCopySubject[], label: string): void {
  for (let index = 0; index < entries.length; index += 1) {
    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const entry = entries[index];
      const previous = entries[previousIndex];
      if (entry.subject === previous.subject && scopesOverlap(entry.surfaces, previous.surfaces)) {
        throw new GuideCompileError(
          "contradiction",
          `${label} for ${renderLiteral(entry.subject)}.`,
          [previous.path, entry.path]
        );
      }
    }
  }
}

function assertRuleIntegrity(rules: GuideRule[]): void {
  const byId = new Map<string, string>();
  const effectsBySubject = new Map<string, GuideRuleEffect>();
  for (const rule of rules) {
    for (const [field, value] of Object.entries({
      id: rule.id,
      name: rule.name,
      subject: rule.subject,
      description: rule.description,
      badExample: rule.badExample,
      goodExample: rule.goodExample
    })) {
      normalizeSafeText(value, `rule.${rule.id}.${field}`);
    }
    const canonical = compactJson(rule);
    const previous = byId.get(rule.id);
    if (previous && previous !== canonical) {
      throw new GuideCompileError("contradiction", `Rule id ${rule.id} has conflicting content.`);
    }
    byId.set(rule.id, canonical);
    if (normalizeSubject(rule.badExample) === normalizeSubject(rule.goodExample)) {
      throw new GuideCompileError("contradiction", `Rule ${rule.id} has identical bad and good examples.`);
    }
    const subject = normalizeSubject(rule.subject);
    const previousEffect = effectsBySubject.get(subject);
    if (previousEffect && previousEffect !== rule.effect) {
      throw new GuideCompileError("contradiction", `Rule subject ${renderLiteral(subject)} is both required and avoided.`);
    }
    effectsBySubject.set(subject, rule.effect);
  }
}

function renderGuideMarkdown(rules: GuideRule[], sourceHash: string): string {
  const lines = [
    "## UI work: follow all rules",
    "",
    `Profile=${DESIGN_GUIDE_PROFILE_ID}; catalog=${GUIDE_CATALOG_VERSION}; source=sha256:${sourceHash}`,
    ""
  ];
  rules.forEach((rule, index) => {
    lines.push(
      `${index + 1}. ${rule.effect === "require" ? "Require" : "Avoid"} ${renderLiteral(rule.name)}: ${renderLiteral(rule.description)} ${renderLiteral(rule.badExample)} → ${renderLiteral(rule.goodExample)}`
    );
  });
  return `${lines.join("\n")}\n`;
}

function assertValidCopyStyle(value: unknown): asserts value is CopyStyle {
  const result = validateAgainstSchema(COPY_STYLE_SCHEMA, value);
  if (!result.valid) {
    throw new SchemaValidationError("copy-style", result.issues);
  }
}

function normalizeSafeText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new GuideCompileError("sanitize", `${path} must be a nonblank trim-stable string.`);
  }
  const normalized = value.normalize("NFC");
  if (hasUnpairedSurrogate(normalized)) {
    throw new GuideCompileError("sanitize", `${path} contains an unpaired UTF-16 surrogate.`);
  }
  if (CONTROL_OR_BIDI_PATTERN.test(normalized)) {
    throw new GuideCompileError("sanitize", `${path} contains a control, zero-width, or bidi character.`);
  }
  if (
    normalized.includes("<!--") ||
    normalized.includes("-->") ||
    normalized.includes("design-harness:guide:begin") ||
    normalized.includes("design-harness:guide:end") ||
    normalized.includes("```") ||
    normalized.includes("~~~")
  ) {
    throw new GuideCompileError("sanitize", `${path} contains a reserved structural delimiter.`);
  }
  return normalized;
}

function normalizeSubject(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function renderLiteral(value: string): string {
  return JSON.stringify(value.normalize("NFC")).replace(/[<>&`~]/gu, (character) => {
    return `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`;
  });
}

function compactJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(compactJson(value), "utf8").digest("hex");
}

function normalizeStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.normalize("NFC");
  }
  if (Array.isArray(value)) {
    return value.map(normalizeStrings);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).map((key) => [key, normalizeStrings(value[key])]));
  }
  return value;
}

function summarizeTokenGroup(
  group: object,
  formatValue: (value: unknown) => string = compactJson
): string {
  const record = group as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => key !== "$type")
    .sort(codePointCompare)
    .map((key) => {
      const token = record[key];
      const value = isRecord(token) && Object.prototype.hasOwnProperty.call(token, "$value")
        ? token.$value
        : token;
      return `${key}=${formatValue(value)}`;
    })
    .join("; ");
}

// Emit srgb DTCG colors to the model as CSS-usable hex literals (#RRGGBB / #RRGGBBAA) rather than
// the normalized float triplet the DTCG token file stores. Only the generation guide is rewritten;
// the token file (designTokensJson) and sourceHash keep the raw components. Falls back to compact
// JSON for any non-srgb or malformed shape so the formatter stays total.
function formatColorLiteral(value: unknown): string {
  if (
    isRecord(value) &&
    value.colorSpace === "srgb" &&
    Array.isArray(value.components) &&
    value.components.length === 3 &&
    value.components.every((component): component is number => Number.isFinite(component))
  ) {
    const [red, green, blue] = value.components;
    const hex = `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
    const { alpha } = value;
    return typeof alpha === "number" && alpha < 1 ? `${hex}${toHexByte(alpha)}` : hex;
  }
  return compactJson(value);
}

function toHexByte(component: number): string {
  const clamped = Math.min(1, Math.max(0, component));
  return Math.round(clamped * 255).toString(16).padStart(2, "0").toUpperCase();
}

// Emit DTCG dimension tokens to the model as CSS lengths (`8px`, `0.5rem`) rather than the
// `{"unit":"px","value":8}` object the token file stores. Falls back to compact JSON for any
// shape that is not a literal { value: finite number, unit: px|rem } so the formatter stays total.
function formatDimensionLiteral(value: unknown): string {
  if (
    isRecord(value) &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    (value.unit === "px" || value.unit === "rem")
  ) {
    return `${value.value}${value.unit}`;
  }
  return compactJson(value);
}

// A font family name that is a single CSS identifier (letters, digits, hyphens) — this covers every
// CSS generic (sans-serif, ui-monospace, …) and single-word named family, all of which must stay
// unquoted. Anything else (multi-word names like `Helvetica Neue`) is single-quoted below.
const SAFE_FONT_IDENTIFIER = /^[A-Za-z][A-Za-z0-9-]*$/u;

// Emit a font family token to the model as a CSS font-family list (`'Helvetica Neue', Inter,
// sans-serif`) rather than the JSON array the token file stores, preserving stack order. Multi-word
// names are single-quoted (single quotes render cleanly through renderLiteral, unlike double). Any
// non-string member, or a name already containing a single quote, falls back to compact JSON.
function formatFontLiteral(value: unknown): string {
  const members =
    typeof value === "string"
      ? [value]
      : Array.isArray(value) && value.every((member): member is string => typeof member === "string")
        ? value
        : null;
  if (members === null) {
    return compactJson(value);
  }
  const rendered: string[] = [];
  for (const name of members) {
    if (SAFE_FONT_IDENTIFIER.test(name)) {
      rendered.push(name);
    } else if (name.includes("'")) {
      return compactJson(value);
    } else {
      rendered.push(`'${name}'`);
    }
  }
  return rendered.join(", ");
}

function summarizeLocaleAndRegisters(copy: SafeCopyProjection): string {
  const registers = COPY_SURFACE_ORDER.flatMap((surface) => {
    const register = copy.surfaceRegisters?.[surface];
    return register ? [`${surface}=${register}`] : [];
  });
  return [copy.locale, ...registers].join("; ");
}

function summarizeGlossaryTerm(term: NonNullable<SafeCopyProjection["glossary"]>[number]): string {
  const replacement = term.preferredTerm ? `→${term.preferredTerm}` : "";
  const scope = term.surfaces ? `@${term.surfaces.join(",")}` : "";
  return `${term.tier}:${term.term}${replacement}${scope}`;
}

function scopedCopyText(value: string, surfaces: readonly CopySurface[] | undefined): string {
  return surfaces ? `${value}@${surfaces.join(",")}` : value;
}

function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(codePointCompare)
        .map((key) => [key, canonicalize(value[key])])
    ) as T;
  }
  return value;
}

function compareMany(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const compared = codePointCompare(left[index] ?? "", right[index] ?? "");
    if (compared !== 0) {
      return compared;
    }
  }
  return 0;
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const leftPoint = leftPoints[index].codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index].codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1;
    }
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
