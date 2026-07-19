import {
  CSS_GENERIC_FONT_FAMILY_VALUES,
  classifyFontFamily,
  foldAsciiCase,
  fontFamilyComparisonIdentity,
  type FontFamilyAdherencePolicy,
  type FontFamilyKind
} from "@design-harness/core";

export interface ParsedFontFamily {
  value: string;
  kind: FontFamilyKind;
}

export type FontFamilyParseErrorCode =
  | "empty-list"
  | "empty-member"
  | "unterminated-string"
  | "empty-family"
  | "dangling-escape"
  | "newline-escape"
  | "invalid-token"
  | "unsupported-function";

export class FontFamilyParseError extends Error {
  constructor(
    public readonly code: FontFamilyParseErrorCode,
    public readonly index: number
  ) {
    super(parseErrorMessage(code, index));
    this.name = "FontFamilyParseError";
  }
}

export const MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS = 160;

const FUNCTIONAL_GENERIC_ARGUMENTS = new Set(
  CSS_GENERIC_FONT_FAMILY_VALUES.flatMap((value) => (
    value.startsWith("generic(") && value.endsWith(")") ? [value.slice(8, -1)] : []
  ))
);

const DIAGNOSTIC_ESCAPE_CODE_POINTS = new Set([
  0x00ad,
  0x034f,
  0x061c,
  0x180e,
  0xfeff
]);

/**
 * Parse a computed CSS font-family serialization without invoking a CSS engine.
 * The returned value is decoded for comparison, while quoted members remain
 * distinguishable from generic keywords through their `kind`.
 */
export function parseFontFamilyList(raw: string): ParsedFontFamily[] {
  const scanner = new FontFamilyScanner(raw);
  return scanner.parse();
}

/**
 * Return every list member that is outside the project policy. Order and
 * duplicates are retained so callers can decide how to group their evidence.
 */
export function unexpectedFontFamilies(
  raw: string,
  policy: FontFamilyAdherencePolicy
): ParsedFontFamily[] {
  const allowed = new Set(
    policy.allowedFamilies.map(({ value, kind }) => fontFamilyComparisonIdentity(value, kind))
  );

  return parseFontFamilyList(raw).filter(
    ({ value, kind }) => !allowed.has(fontFamilyComparisonIdentity(value, kind))
  );
}

/**
 * Produce a fixed-size, control-safe representation for report evidence.
 * Matching must always use the original parsed value, never this display form.
 */
export function fontFamilyDiagnosticValue(value: string): string {
  let output = "";
  let scalarCount = 0;
  let truncated = false;

  for (const character of value) {
    if (scalarCount === MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS) {
      truncated = true;
      break;
    }
    scalarCount += 1;
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\") {
      output += "\\\\";
    } else if (mustEscapeForDiagnostic(codePoint)) {
      output += `\\u{${codePoint.toString(16).padStart(4, "0")}}`;
    } else {
      output += character;
    }
  }

  return truncated ? `${output}…` : output;
}

class FontFamilyScanner {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): ParsedFontFamily[] {
    const members: ParsedFontFamily[] = [];
    this.skipWhitespace();
    if (this.atEnd()) {
      throw this.error("empty-list");
    }

    while (!this.atEnd()) {
      if (this.peek() === ",") {
        throw this.error("empty-member");
      }
      members.push(this.parseMember());
      this.skipWhitespace();

      if (this.atEnd()) {
        break;
      }
      if (this.peek() !== ",") {
        throw this.error("invalid-token");
      }
      this.index += 1;
      this.skipWhitespace();
      if (this.atEnd() || this.peek() === ",") {
        throw this.error("empty-member");
      }
    }

    return members;
  }

  private parseMember(): ParsedFontFamily {
    const character = this.peek();
    if (character === "\"" || character === "'") {
      const value = this.parseString(character);
      if (value.length === 0) {
        throw this.error("empty-family");
      }
      return { value, kind: "named" };
    }

    return this.parseUnquotedMember();
  }

  private parseUnquotedMember(): ParsedFontFamily {
    if (!this.wouldStartIdentifier()) {
      throw this.error("invalid-token");
    }

    const first = this.parseIdentifier();
    if (this.peek() === "(") {
      return this.parseFunctionalGeneric(first);
    }

    const parts = [first];
    while (!this.atEnd()) {
      const whitespaceStart = this.index;
      this.skipWhitespace();
      if (this.index === whitespaceStart) {
        break;
      }
      if (this.atEnd() || this.peek() === ",") {
        break;
      }
      if (!this.wouldStartIdentifier()) {
        throw this.error("invalid-token");
      }
      parts.push(this.parseIdentifier());
      if (this.peek() === "(") {
        throw this.error("unsupported-function");
      }
    }

    const value = parts.join(" ");
    return { value, kind: classifyFontFamily(value) };
  }

  private parseFunctionalGeneric(functionName: string): ParsedFontFamily {
    const functionStart = this.index;
    if (foldAsciiCase(functionName) !== "generic") {
      throw new FontFamilyParseError("unsupported-function", functionStart);
    }

    this.index += 1;
    this.skipWhitespace();
    if (!this.wouldStartIdentifier()) {
      throw this.error("unsupported-function");
    }
    const argument = this.parseIdentifier();
    this.skipWhitespace();
    if (this.peek() !== ")") {
      throw this.error("unsupported-function");
    }
    this.index += 1;

    if (!FUNCTIONAL_GENERIC_ARGUMENTS.has(foldAsciiCase(argument))) {
      throw new FontFamilyParseError("unsupported-function", functionStart);
    }

    const value = `${functionName}(${argument})`;
    return { value, kind: classifyFontFamily(value) };
  }

  private parseIdentifier(): string {
    const start = this.index;
    let decoded = "";

    if (this.peek() === "-") {
      decoded += "-";
      this.index += 1;
    }

    if (this.peek() === "\\") {
      decoded += this.parseEscape();
    } else if (isNameStart(this.peekCodePoint())) {
      decoded += this.consumeCodePoint();
    } else if (decoded === "-" && this.peek() === "-") {
      decoded += "-";
      this.index += 1;
    } else {
      throw new FontFamilyParseError("invalid-token", start);
    }

    while (!this.atEnd()) {
      if (this.peek() === "\\") {
        decoded += this.parseEscape();
      } else if (isNameCodePoint(this.peekCodePoint())) {
        decoded += this.consumeCodePoint();
      } else {
        break;
      }
    }

    return decoded;
  }

  private parseString(quote: "\"" | "'"): string {
    const openingIndex = this.index;
    this.index += 1;
    let decoded = "";

    while (!this.atEnd()) {
      const character = this.peek();
      if (character === quote) {
        this.index += 1;
        return decoded;
      }
      if (character === "\\") {
        decoded += this.parseEscape();
        continue;
      }
      if (isNewline(character)) {
        throw new FontFamilyParseError("unterminated-string", openingIndex);
      }
      decoded += this.consumeCodePoint();
    }

    throw new FontFamilyParseError("unterminated-string", openingIndex);
  }

  private parseEscape(): string {
    const escapeIndex = this.index;
    this.index += 1;
    if (this.atEnd()) {
      throw new FontFamilyParseError("dangling-escape", escapeIndex);
    }
    if (isNewline(this.peek())) {
      throw new FontFamilyParseError("newline-escape", escapeIndex);
    }

    if (isHexDigit(this.peek())) {
      let hexadecimal = "";
      while (hexadecimal.length < 6 && isHexDigit(this.peek())) {
        hexadecimal += this.peek();
        this.index += 1;
      }
      this.consumeEscapeTerminatorWhitespace();
      const codePoint = Number.parseInt(hexadecimal, 16);
      if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return "\ufffd";
      }
      return String.fromCodePoint(codePoint);
    }

    return this.consumeCodePoint();
  }

  private consumeEscapeTerminatorWhitespace(): void {
    if (!isCssWhitespace(this.peek())) {
      return;
    }
    if (this.peek() === "\r" && this.input[this.index + 1] === "\n") {
      this.index += 2;
    } else {
      this.index += 1;
    }
  }

  private wouldStartIdentifier(): boolean {
    const first = this.peek();
    if (first === "\\") {
      return this.validEscapeAt(this.index);
    }
    if (isNameStart(this.peekCodePoint())) {
      return true;
    }
    if (first !== "-") {
      return false;
    }

    const secondIndex = this.index + 1;
    const second = this.input[secondIndex] ?? "";
    return second === "-"
      || isNameStart(this.input.codePointAt(secondIndex))
      || (second === "\\" && this.validEscapeAt(secondIndex));
  }

  private validEscapeAt(index: number): boolean {
    if (this.input[index] !== "\\" || index + 1 >= this.input.length) {
      return false;
    }
    return !isNewline(this.input[index + 1] ?? "");
  }

  private skipWhitespace(): void {
    while (isCssWhitespace(this.peek())) {
      this.index += 1;
    }
  }

  private consumeCodePoint(): string {
    const codePoint = this.peekCodePoint();
    if (codePoint === undefined) {
      return "";
    }
    const character = String.fromCodePoint(codePoint);
    this.index += character.length;
    return character;
  }

  private peekCodePoint(): number | undefined {
    return this.input.codePointAt(this.index);
  }

  private peek(): string {
    return this.input[this.index] ?? "";
  }

  private atEnd(): boolean {
    return this.index >= this.input.length;
  }

  private error(code: FontFamilyParseErrorCode): FontFamilyParseError {
    return new FontFamilyParseError(code, this.index);
  }
}

function isCssWhitespace(character: string): boolean {
  return character === " "
    || character === "\t"
    || character === "\n"
    || character === "\r"
    || character === "\f";
}

function isNewline(character: string): boolean {
  return character === "\n" || character === "\r" || character === "\f";
}

function isHexDigit(character: string): boolean {
  return /^[0-9A-Fa-f]$/u.test(character);
}

function isNameStart(codePoint: number | undefined): boolean {
  return codePoint !== undefined
    && (codePoint === 0x5f
      || (codePoint >= 0x41 && codePoint <= 0x5a)
      || (codePoint >= 0x61 && codePoint <= 0x7a)
      || codePoint >= 0x80);
}

function isNameCodePoint(codePoint: number | undefined): boolean {
  return isNameStart(codePoint)
    || codePoint === 0x2d
    || (codePoint !== undefined && codePoint >= 0x30 && codePoint <= 0x39);
}

function mustEscapeForDiagnostic(codePoint: number): boolean {
  return codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || DIAGNOSTIC_ESCAPE_CODE_POINTS.has(codePoint)
    || (codePoint >= 0x200b && codePoint <= 0x200f)
    || (codePoint >= 0x2028 && codePoint <= 0x202e)
    || (codePoint >= 0x2060 && codePoint <= 0x2069);
}

function parseErrorMessage(code: FontFamilyParseErrorCode, index: number): string {
  const reason: Record<FontFamilyParseErrorCode, string> = {
    "empty-list": "font-family list is empty",
    "empty-member": "font-family list contains an empty member",
    "unterminated-string": "font-family string is unterminated",
    "empty-family": "font-family member decodes to an empty value",
    "dangling-escape": "font-family member ends with a dangling escape",
    "newline-escape": "font-family member contains a newline escape",
    "invalid-token": "font-family member contains an invalid token",
    "unsupported-function": "font-family member contains an unsupported function"
  };
  return `${reason[code]} at index ${index}`;
}
