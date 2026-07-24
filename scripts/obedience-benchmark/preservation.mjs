const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const NON_VISIBLE_TEXT_ELEMENTS = new Set(["script", "style", "template", "noscript"]);
const ORACLE_TOP_LEVEL_KEYS = Object.freeze([
  "fixturePath",
  "forbiddenReplacementText",
  "minimumVisibleStructure",
  "requiredFeatures",
  "schemaVersion"
]);
const REQUIRED_FEATURE_KEYS = Object.freeze([
  "marker",
  "selector",
  "tagName"
]);
const OPTIONAL_FEATURE_STRING_KEYS = Object.freeze([
  "accessibleName",
  "requiredAlt",
  "requiredLabelText",
  "requiredRole",
  "requiredText",
  "requiredTextPrefix",
  "requiredType"
]);
const OPTIONAL_FEATURE_INTEGER_KEYS = Object.freeze([
  "minimumOptionCount",
  "minimumVisibleTextCharacters"
]);
const ALLOWED_FEATURE_KEYS = new Set([
  ...REQUIRED_FEATURE_KEYS,
  ...OPTIONAL_FEATURE_STRING_KEYS,
  ...OPTIONAL_FEATURE_INTEGER_KEYS
]);
const BASELINE_HTML_TAG = "<html>";
const REPAIRED_HTML_TAG = '<html lang="en">';
const PENDING_COUNT_PLACEHOLDER = "{{pendingCount}}";
const PENDING_COUNT_PATTERN = /^(?:0|[1-9]\d*)$/;

function decodeEntities(text) {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hexadecimal) =>
      String.fromCodePoint(Number.parseInt(hexadecimal, 16))
    );
}

function normalizedText(value) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function parseAttributes(source) {
  const attributes = new Map();
  const matcher = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(matcher)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (attributes.has(name)) {
      throw new Error(`duplicate attribute ${name}`);
    }
    attributes.set(name, decodeEntities(value));
  }
  return attributes;
}

function parseHtml(source) {
  const root = {
    tagName: "#document",
    attributes: new Map(),
    children: [],
    parent: null,
    textParts: []
  };
  const stack = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+|</g;
  let position = 0;

  for (const match of source.matchAll(tokenPattern)) {
    if (match.index !== position) {
      throw new Error(`unparseable HTML near byte ${position}`);
    }
    position = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<!")) {
      continue;
    }
    if (!token.startsWith("<")) {
      stack.at(-1).textParts.push(token);
      continue;
    }
    if (token === "<") {
      stack.at(-1).textParts.push(token);
      continue;
    }
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim().toLowerCase();
      if (stack.length === 1 || stack.at(-1).tagName !== name) {
        throw new Error(`mismatched closing tag </${name}>`);
      }
      stack.pop();
      continue;
    }

    const selfClosing = /\/\s*>$/.test(token);
    const body = token.slice(1, token.length - (selfClosing ? 2 : 1)).trim();
    const nameMatch = /^([A-Za-z][^\s/>]*)/.exec(body);
    if (!nameMatch) {
      throw new Error(`malformed opening tag: ${token.slice(0, 80)}`);
    }
    const tagName = nameMatch[1].toLowerCase();
    const attributes = parseAttributes(body.slice(nameMatch[0].length));
    const node = {
      tagName,
      attributes,
      children: [],
      parent: stack.at(-1),
      textParts: []
    };
    stack.at(-1).children.push(node);
    if (!selfClosing && !VOID_ELEMENTS.has(tagName)) {
      stack.push(node);
    }
  }

  if (position !== source.length) {
    throw new Error(`unparseable HTML near byte ${position}`);
  }
  if (stack.length !== 1) {
    throw new Error(`unclosed <${stack.at(-1).tagName}> element`);
  }
  return root;
}

function walk(node, visit) {
  for (const child of node.children) {
    visit(child);
    walk(child, visit);
  }
}

function descendants(node) {
  const nodes = [];
  walk(node, (child) => nodes.push(child));
  return nodes;
}

function visibleText(node, rules) {
  if (
    NON_VISIBLE_TEXT_ELEMENTS.has(node.tagName) ||
    hiddenReason(node, rules)
  ) {
    return "";
  }
  const parts = [...node.textParts];
  for (const child of node.children) {
    parts.push(visibleText(child, rules));
  }
  return normalizedText(parts.join(" "));
}

function parseDeclarations(source) {
  const declarations = new Map();
  for (const fragment of source.split(";")) {
    const separator = fragment.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const property = fragment.slice(0, separator).trim().toLowerCase();
    const value = fragment
      .slice(separator + 1)
      .replace(/\s*!important\s*$/i, "")
      .trim()
      .toLowerCase();
    if (property) {
      declarations.set(property, value);
    }
  }
  return declarations;
}

function hidingDeclarationReason(declarations) {
  const display = declarations.get("display");
  if (display === "none") {
    return "display:none";
  }
  const visibility = declarations.get("visibility");
  if (visibility === "hidden" || visibility === "collapse") {
    return `visibility:${visibility}`;
  }
  const opacity = declarations.get("opacity");
  if (opacity !== undefined && Number.parseFloat(opacity) === 0) {
    return "opacity:0";
  }
  const contentVisibility = declarations.get("content-visibility");
  if (contentVisibility === "hidden") {
    return "content-visibility:hidden";
  }
  const transform = declarations.get("transform") ?? "";
  if (/\bscale(?:x|y)?\(\s*0(?:[^\d.]|$)/.test(transform)) {
    return "zero-scale transform";
  }
  for (const match of transform.matchAll(
    /\btranslate(?:x|y|3d)?\([^)]*?(-?\d+(?:\.\d+)?)(px|rem|em|vw|vh|%)/g
  )) {
    const magnitude = Math.abs(Number(match[1]));
    if (magnitude >= 100) {
      return "off-screen transform";
    }
  }
  const clip = declarations.get("clip") ?? "";
  if (/rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)/.test(clip)) {
    return "zero-area clip";
  }
  const clipPath = declarations.get("clip-path") ?? "";
  const insetPercentage = /^inset\(\s*(-?\d+(?:\.\d+)?)%/.exec(clipPath);
  if (
    (insetPercentage && Number(insetPercentage[1]) >= 50) ||
    /^(?:circle\(\s*0|polygon\(\s*0\s+0(?:\s*,\s*0\s+0){2,})/.test(clipPath)
  ) {
    return "zero-area clip-path";
  }
  const filter = declarations.get("filter") ?? "";
  if (/\bopacity\(\s*(?:0(?:\.0+)?|0%)\s*\)/.test(filter)) {
    return "zero-opacity filter";
  }

  const zeroSized = (property) => {
    const value = declarations.get(property);
    return value !== undefined && /^0(?:[a-z%]+)?$/.test(value);
  };
  const hasZeroWidth = zeroSized("width") || zeroSized("max-width");
  const hasZeroHeight = zeroSized("height") || zeroSized("max-height");
  if (hasZeroWidth && hasZeroHeight) {
    return "zero width and height";
  }

  const position = declarations.get("position");
  if (position === "absolute" || position === "fixed") {
    for (const property of ["left", "right", "top", "bottom"]) {
      const value = declarations.get(property) ?? "";
      const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|vw|vh)$/.exec(value);
      if (match && Number(match[1]) <= -100) {
        return `off-screen ${property}`;
      }
    }
  }
  return null;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function cssRules(source) {
  const rules = [];
  const css = stripCssComments(source);
  let cursor = 0;

  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open === -1) {
      break;
    }
    let depth = 1;
    let close = open + 1;
    let quote = null;
    for (; close < css.length && depth > 0; close += 1) {
      const character = css[close];
      const previous = css[close - 1];
      if (quote) {
        if (character === quote && previous !== "\\") {
          quote = null;
        }
        continue;
      }
      if (character === "\"" || character === "'") {
        quote = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
    }
    if (depth !== 0) {
      throw new Error("unclosed CSS rule");
    }

    const header = css.slice(cursor, open).trim().replace(/^.*[;}]\s*/s, "").trim();
    const body = css.slice(open + 1, close - 1);
    if (/^@(media|supports|layer|container|document)\b/i.test(header)) {
      rules.push(...cssRules(body));
    } else if (header && !header.startsWith("@")) {
      rules.push({ selectors: header.split(",").map((selector) => selector.trim()), declarations: parseDeclarations(body) });
    }
    cursor = close;
  }
  return rules;
}

function unquoteCssValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleSelector(selector) {
  let remaining = selector.trim();
  if (!remaining || remaining.includes(":")) {
    return null;
  }

  let tagName = null;
  const predicates = [];
  const tag = /^(\*|[A-Za-z][\w-]*)/.exec(remaining);
  if (tag) {
    tagName = tag[1].toLowerCase();
    remaining = remaining.slice(tag[0].length);
  }

  while (remaining.length > 0) {
    let match = /^#([\w-]+)/.exec(remaining);
    if (match) {
      predicates.push({ kind: "id", value: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }
    match = /^\.([\w-]+)/.exec(remaining);
    if (match) {
      predicates.push({ kind: "class", value: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }
    match = /^\[\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*([^\]]+))?\s*\]/.exec(remaining);
    if (match) {
      predicates.push({
        kind: "attribute",
        name: match[1].toLowerCase(),
        operator: match[2] ?? null,
        value: match[2] ? unquoteCssValue(match[3]) : null
      });
      remaining = remaining.slice(match[0].length);
      continue;
    }
    return null;
  }
  return { tagName, predicates };
}

function parseSelector(selector) {
  const normalized = selector.replace(/\s*>\s*/g, " > ").trim();
  const rawParts = normalized.split(/\s+/).filter(Boolean);
  if (
    rawParts.length === 0 ||
    rawParts[0] === ">" ||
    rawParts.at(-1) === ">" ||
    rawParts.some(
      (part, index) => part === ">" && rawParts[index - 1] === ">"
    )
  ) {
    return null;
  }
  const parts = [];
  for (const part of rawParts) {
    if (part === ">") {
      parts.push(part);
      continue;
    }
    const parsed = parseSimpleSelector(part);
    if (!parsed) {
      return null;
    }
    parts.push(parsed);
  }
  return parts;
}

function matchesSimpleSelector(node, parsed) {
  if (
    parsed.tagName &&
    parsed.tagName !== "*" &&
    node.tagName !== parsed.tagName
  ) {
    return false;
  }
  for (const predicate of parsed.predicates) {
    if (predicate.kind === "id") {
      if (node.attributes.get("id") !== predicate.value) {
        return false;
      }
      continue;
    }
    if (predicate.kind === "class") {
      const classes = (node.attributes.get("class") ?? "")
        .split(/\s+/)
        .filter(Boolean);
      if (!classes.includes(predicate.value)) {
        return false;
      }
      continue;
    }

    if (!node.attributes.has(predicate.name)) {
      return false;
    }
    if (predicate.operator) {
      const actual = node.attributes.get(predicate.name);
      const expected = predicate.value;
      const matches =
        (predicate.operator === "=" && actual === expected) ||
        (predicate.operator === "~=" && actual.split(/\s+/).includes(expected)) ||
        (predicate.operator === "|=" &&
          (actual === expected || actual.startsWith(`${expected}-`))) ||
        (predicate.operator === "^=" && actual.startsWith(expected)) ||
        (predicate.operator === "$=" && actual.endsWith(expected)) ||
        (predicate.operator === "*=" && actual.includes(expected));
      if (!matches) {
        return false;
      }
    }
  }
  return true;
}

function matchesSelector(node, selector) {
  const parts = parseSelector(selector);
  if (!parts) {
    return false;
  }

  let current = node;
  let index = parts.length - 1;
  if (!matchesSimpleSelector(current, parts[index])) {
    return false;
  }
  index -= 1;

  while (index >= 0) {
    if (parts[index] === ">") {
      index -= 1;
      current = current?.parent;
      if (!current || index < 0 || !matchesSimpleSelector(current, parts[index])) {
        return false;
      }
      index -= 1;
      continue;
    }
    let ancestor = current?.parent;
    while (ancestor && !matchesSimpleSelector(ancestor, parts[index])) {
      ancestor = ancestor.parent;
    }
    if (!ancestor) {
      return false;
    }
    current = ancestor;
    index -= 1;
  }
  return true;
}

function stylesForNode(node, rules) {
  const declarations = [];
  for (const rule of rules) {
    if (rule.selectors.some((selector) => matchesSelector(node, selector))) {
      declarations.push(rule.declarations);
    }
  }
  if (node.attributes.has("style")) {
    declarations.push(parseDeclarations(node.attributes.get("style")));
  }
  return declarations;
}

function hiddenReason(node, rules) {
  let current = node;
  while (current && current.tagName !== "#document") {
    if (current.attributes.has("hidden")) {
      return `<${current.tagName}> or an ancestor has hidden`;
    }
    if (current.attributes.has("inert")) {
      return `<${current.tagName}> or an ancestor has inert`;
    }
    if ((current.attributes.get("aria-hidden") ?? "").trim().toLowerCase() === "true") {
      return `<${current.tagName}> or an ancestor has aria-hidden=true`;
    }
    if (
      current.tagName === "input" &&
      (current.attributes.get("type") ?? "").trim().toLowerCase() === "hidden"
    ) {
      return "required input has type=hidden";
    }
    for (const declarations of stylesForNode(current, rules)) {
      const reason = hidingDeclarationReason(declarations);
      if (reason) {
        return `<${current.tagName}> or an ancestor uses ${reason}`;
      }
    }
    current = current.parent;
  }
  return null;
}

function findLabel(root, control) {
  const id = control.attributes.get("id");
  let match = null;
  walk(root, (node) => {
    if (match || node.tagName !== "label") {
      return;
    }
    if (id && node.attributes.get("for") === id) {
      match = node;
      return;
    }
    let ancestor = control.parent;
    while (ancestor) {
      if (ancestor === node) {
        match = node;
        return;
      }
      ancestor = ancestor.parent;
    }
  });
  return match;
}

function addViolation(violations, marker, code, message) {
  violations.push({ marker, code, message });
}

function countMeaningfulCharacters(text) {
  return [...normalizedText(text)].filter((character) => !/\s/.test(character)).length;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function occurrenceCount(source, needle) {
  let count = 0;
  let cursor = 0;
  while (true) {
    const found = source.indexOf(needle, cursor);
    if (found === -1) {
      return count;
    }
    count += 1;
    cursor = found + needle.length;
  }
}

function exactSourceDeltaError(source, baselineSource) {
  if (typeof baselineSource !== "string") {
    return {
      code: "invalid-baseline-source",
      message: "exact source-delta validation requires a string baselineSource"
    };
  }
  if (
    occurrenceCount(baselineSource, BASELINE_HTML_TAG) !== 1 ||
    occurrenceCount(baselineSource, PENDING_COUNT_PLACEHOLDER) !== 1
  ) {
    return {
      code: "invalid-baseline-source",
      message:
        "baselineSource must contain exactly one <html> tag and one {{pendingCount}} placeholder"
    };
  }

  const htmlVariants = [
    baselineSource,
    baselineSource.replace(BASELINE_HTML_TAG, REPAIRED_HTML_TAG)
  ];
  for (const variant of htmlVariants) {
    if (source === variant) {
      return null;
    }
    const placeholderIndex = variant.indexOf(PENDING_COUNT_PLACEHOLDER);
    const prefix = variant.slice(0, placeholderIndex);
    const suffix = variant.slice(
      placeholderIndex + PENDING_COUNT_PLACEHOLDER.length
    );
    const valueEnd = source.length - suffix.length;
    if (
      source.startsWith(prefix) &&
      source.endsWith(suffix) &&
      valueEnd >= prefix.length
    ) {
      const pendingCount = source.slice(prefix.length, valueEnd);
      if (PENDING_COUNT_PATTERN.test(pendingCount)) {
        return null;
      }
    }
  }
  return {
    code: "unexpected-source-delta",
    message:
      "final source may differ from fixture.html only by the exact <html lang=\"en\"> insertion and canonical pending-count replacement"
  };
}

function oracleShapeError(oracle) {
  if (!isPlainObject(oracle)) {
    return "preservation oracle must be an object";
  }
  if (!hasExactKeys(oracle, ORACLE_TOP_LEVEL_KEYS)) {
    return `preservation oracle must contain exactly keys ${ORACLE_TOP_LEVEL_KEYS.join(", ")}`;
  }
  if (oracle.schemaVersion !== "obedience-v1/preservation-oracle/v1") {
    return "preservation oracle schemaVersion is invalid";
  }
  if (oracle.fixturePath !== "fixture.html") {
    return "preservation oracle fixturePath must be fixture.html";
  }
  if (
    !Array.isArray(oracle.requiredFeatures) ||
    oracle.requiredFeatures.length === 0
  ) {
    return "preservation oracle must declare required features";
  }
  const seenMarkers = new Set();
  for (const requirement of oracle.requiredFeatures) {
    if (!isPlainObject(requirement)) {
      return "preservation oracle contains a malformed required feature";
    }
    const actualKeys = Object.keys(requirement);
    if (
      REQUIRED_FEATURE_KEYS.some((key) => !Object.hasOwn(requirement, key)) ||
      actualKeys.some((key) => !ALLOWED_FEATURE_KEYS.has(key))
    ) {
      return "preservation oracle required feature keys are invalid";
    }
    if (
      typeof requirement.marker !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requirement.marker)
    ) {
      return "preservation oracle feature marker is invalid";
    }
    if (seenMarkers.has(requirement.marker)) {
      return `preservation oracle feature marker ${requirement.marker} is duplicated`;
    }
    seenMarkers.add(requirement.marker);
    if (
      requirement.selector !==
      `[data-benchmark-feature="${requirement.marker}"]`
    ) {
      return `preservation oracle selector for ${requirement.marker} must be derived exactly from its marker`;
    }
    if (
      typeof requirement.tagName !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(requirement.tagName)
    ) {
      return `preservation oracle tagName for ${requirement.marker} is invalid`;
    }
    for (const key of OPTIONAL_FEATURE_STRING_KEYS) {
      if (
        Object.hasOwn(requirement, key) &&
        (typeof requirement[key] !== "string" ||
          requirement[key].trim() === "")
      ) {
        return `preservation oracle ${key} for ${requirement.marker} must be a non-empty string`;
      }
    }
    for (const key of OPTIONAL_FEATURE_INTEGER_KEYS) {
      if (
        Object.hasOwn(requirement, key) &&
        (!Number.isInteger(requirement[key]) || requirement[key] < 1)
      ) {
        return `preservation oracle ${key} for ${requirement.marker} must be a positive integer`;
      }
    }
    if (
      Object.hasOwn(requirement, "requiredText") &&
      Object.hasOwn(requirement, "requiredTextPrefix")
    ) {
      return `preservation oracle feature ${requirement.marker} may not require both exact text and a text prefix`;
    }
  }
  if (
    !isPlainObject(oracle.minimumVisibleStructure)
  ) {
    return "preservation oracle minimumVisibleStructure is malformed";
  }
  const minimumFields = [
    "minimumControlCount",
    "minimumFeatureCount",
    "minimumHeadingCount",
    "minimumImageCount",
    "minimumVisibleTextCharacters"
  ];
  const actualMinimumFields = Object.keys(
    oracle.minimumVisibleStructure
  ).sort();
  if (
    JSON.stringify(actualMinimumFields) !==
    JSON.stringify(minimumFields)
  ) {
    return "preservation oracle minimumVisibleStructure keys are invalid";
  }
  for (const field of minimumFields) {
    const minimum = oracle.minimumVisibleStructure[field];
    if (!Number.isInteger(minimum) || minimum < 1) {
      return `preservation oracle ${field} must be a positive integer`;
    }
  }
  if (
    !Array.isArray(oracle.forbiddenReplacementText) ||
    oracle.forbiddenReplacementText.length === 0 ||
    oracle.forbiddenReplacementText.some(
      (phrase) => typeof phrase !== "string" || phrase.trim() === ""
    )
  ) {
    return "preservation oracle forbiddenReplacementText is malformed";
  }
  return null;
}

export function validatePreservation({
  source,
  oracle,
  baselineSource,
  label = "final source"
}) {
  const violations = [];
  let root;
  if (typeof source !== "string") {
    return {
      ok: false,
      violations: [{ marker: null, code: "invalid-source", message: `${label} must be a string` }],
      metrics: null
    };
  }
  const oracleError = oracleShapeError(oracle);
  if (oracleError) {
    return {
      ok: false,
      violations: [{ marker: null, code: "invalid-oracle", message: oracleError }],
      metrics: null
    };
  }
  if (baselineSource !== undefined) {
    const deltaError = exactSourceDeltaError(source, baselineSource);
    if (deltaError) {
      addViolation(
        violations,
        null,
        deltaError.code,
        `${label}: ${deltaError.message}`
      );
    }
  }

  try {
    root = parseHtml(source);
  } catch (error) {
    return {
      ok: false,
      violations: [
        ...violations,
        {
          marker: null,
          code: "invalid-html",
          message: `${label}: ${error.message}`
        }
      ],
      metrics: null
    };
  }

  const allNodes = descendants(root);
  if (allNodes.some((node) => node.tagName === "script")) {
    addViolation(
      violations,
      null,
      "script-content-not-allowed",
      `${label} may not include executable script content`
    );
  }
  if (
    allNodes.some(
      (node) =>
        node.tagName === "link" &&
        (node.attributes.get("rel") ?? "")
          .toLowerCase()
          .split(/\s+/)
          .includes("stylesheet")
    )
  ) {
    addViolation(
      violations,
      null,
      "external-stylesheet-not-allowed",
      `${label} may not load an external stylesheet`
    );
  }
  const styleText = allNodes
    .filter((node) => node.tagName === "style")
    .map((node) => node.textParts.join(""))
    .join("\n");
  for (const [pattern, description] of [
    [/@import\b/i, "@import"],
    [/@scope\b/i, "@scope"],
    [/(?:--[a-z0-9_-]+\s*:|\bvar\s*\()/i, "CSS custom properties/var()"]
  ]) {
    if (pattern.test(styleText)) {
      addViolation(
        violations,
        null,
        "unsupported-css-feature",
        `${label} uses unsupported ${description} stylesheet syntax`
      );
    }
  }
  let rules;
  try {
    rules = cssRules(styleText);
  } catch (error) {
    addViolation(
      violations,
      null,
      "invalid-css",
      `${label}: ${error.message}`
    );
    rules = [];
  }
  for (const rule of rules) {
    const hidingReason = hidingDeclarationReason(rule.declarations);
    if (!hidingReason) {
      continue;
    }
    for (const selector of rule.selectors) {
      if (!parseSelector(selector)) {
        addViolation(
          violations,
          null,
          "unsupported-hiding-selector",
          `${label} uses unsupported selector ${JSON.stringify(selector)} with ${hidingReason}`
        );
      }
    }
  }
  const featureNodes = allNodes.filter((node) => node.attributes.has("data-benchmark-feature"));
  const featureByMarker = new Map();
  for (const node of featureNodes) {
    const marker = node.attributes.get("data-benchmark-feature");
    const matches = featureByMarker.get(marker) ?? [];
    matches.push(node);
    featureByMarker.set(marker, matches);
  }

  const visibleRequiredNodes = [];
  for (const requirement of oracle.requiredFeatures) {
    const marker = requirement.marker;
    const matches = featureByMarker.get(marker) ?? [];
    if (matches.length === 0) {
      addViolation(violations, marker, "missing-feature", `required feature ${marker} is missing`);
      continue;
    }
    if (matches.length !== 1) {
      addViolation(
        violations,
        marker,
        "duplicate-feature",
        `required feature ${marker} appears ${matches.length} times`
      );
      continue;
    }

    const node = matches[0];
    if (node.tagName !== requirement.tagName.toLowerCase()) {
      addViolation(
        violations,
        marker,
        "wrong-tag",
        `required feature ${marker} must remain <${requirement.tagName}>`
      );
    }

    const reason = hiddenReason(node, rules);
    if (reason) {
      addViolation(violations, marker, "hidden-feature", `${marker}: ${reason}`);
    } else {
      visibleRequiredNodes.push(node);
    }

    const text = visibleText(node, rules);
    if (requirement.requiredText !== undefined && text !== requirement.requiredText) {
      addViolation(
        violations,
        marker,
        "required-text-changed",
        `${marker} must retain its required meaningful text`
      );
    }
    if (
      requirement.requiredTextPrefix !== undefined &&
      !text.startsWith(requirement.requiredTextPrefix)
    ) {
      addViolation(
        violations,
        marker,
        "required-text-prefix-changed",
        `${marker} must retain its required text prefix`
      );
    }
    if (
      requirement.minimumVisibleTextCharacters !== undefined &&
      countMeaningfulCharacters(text) < requirement.minimumVisibleTextCharacters
    ) {
      addViolation(
        violations,
        marker,
        "insufficient-text",
        `${marker} has too little meaningful visible text`
      );
    }
    if (
      requirement.requiredTextPrefix !== undefined &&
      normalizedText(text.slice(requirement.requiredTextPrefix.length)).length === 0
    ) {
      addViolation(
        violations,
        marker,
        "empty-status-value",
        `${marker} must retain meaningful content after its required prefix`
      );
    }
    if (
      requirement.accessibleName !== undefined &&
      normalizedText(node.attributes.get("aria-label") ?? "") !== requirement.accessibleName
    ) {
      addViolation(
        violations,
        marker,
        "accessible-name-changed",
        `${marker} must retain its accessible name`
      );
    }
    if (
      requirement.requiredType !== undefined &&
      (node.attributes.get("type") ?? "").toLowerCase() !== requirement.requiredType.toLowerCase()
    ) {
      addViolation(violations, marker, "control-type-changed", `${marker} must retain its control type`);
    }
    if (
      requirement.requiredRole !== undefined &&
      (node.attributes.get("role") ?? "").toLowerCase() !== requirement.requiredRole.toLowerCase()
    ) {
      addViolation(violations, marker, "role-changed", `${marker} must retain its required role`);
    }
    if (
      requirement.requiredAlt !== undefined &&
      normalizedText(node.attributes.get("alt") ?? "") !== requirement.requiredAlt
    ) {
      addViolation(
        violations,
        marker,
        "alternative-text-changed",
        `${marker} must retain meaningful alternative text`
      );
    }
    if (requirement.requiredLabelText !== undefined) {
      const labelNode = findLabel(root, node);
      if (!labelNode || visibleText(labelNode, rules) !== requirement.requiredLabelText) {
        addViolation(
          violations,
          marker,
          "label-relationship-changed",
          `${marker} must retain its required visible label relationship`
        );
      }
    }
    if (requirement.minimumOptionCount !== undefined) {
      const optionCount = descendants(node).filter((child) => child.tagName === "option").length;
      if (optionCount < requirement.minimumOptionCount) {
        addViolation(
          violations,
          marker,
          "options-deleted",
          `${marker} must retain at least ${requirement.minimumOptionCount} options`
        );
      }
    }
  }

  for (const marker of featureByMarker.keys()) {
    if (!oracle.requiredFeatures.some((requirement) => requirement.marker === marker)) {
      addViolation(
        violations,
        marker,
        "unknown-feature",
        `undeclared data-benchmark-feature marker ${marker} was introduced`
      );
    }
  }

  const allVisibleText = visibleText(root, rules);
  const visibleFeatureCount = visibleRequiredNodes.length;
  const visibleHeadingCount = visibleRequiredNodes.filter((node) =>
    /^h[1-6]$/.test(node.tagName)
  ).length;
  const visibleControlCount = visibleRequiredNodes.filter((node) =>
    ["button", "input", "select", "textarea"].includes(node.tagName)
  ).length;
  const visibleImageCount = visibleRequiredNodes.filter((node) => node.tagName === "img").length;
  const visibleTextCharacters = countMeaningfulCharacters(allVisibleText);
  const minimums = oracle.minimumVisibleStructure ?? {};

  for (const [actual, minimum, code, description] of [
    [
      visibleFeatureCount,
      minimums.minimumFeatureCount,
      "insufficient-feature-structure",
      "visible marked features"
    ],
    [
      visibleHeadingCount,
      minimums.minimumHeadingCount,
      "insufficient-heading-structure",
      "visible headings"
    ],
    [
      visibleControlCount,
      minimums.minimumControlCount,
      "insufficient-control-structure",
      "visible controls"
    ],
    [
      visibleImageCount,
      minimums.minimumImageCount,
      "insufficient-image-structure",
      "visible images"
    ],
    [
      visibleTextCharacters,
      minimums.minimumVisibleTextCharacters,
      "insufficient-text-structure",
      "meaningful visible text characters"
    ]
  ]) {
    if (Number.isInteger(minimum) && actual < minimum) {
      addViolation(
        violations,
        null,
        code,
        `${label} has ${actual} ${description}; at least ${minimum} are required`
      );
    }
  }

  const compactVisibleText = normalizedText(allVisibleText).toLowerCase();
  for (const phrase of oracle.forbiddenReplacementText ?? []) {
    const normalizedPhrase = normalizedText(phrase).toLowerCase();
    if (
      compactVisibleText === normalizedPhrase ||
      (compactVisibleText.length <= 64 && compactVisibleText.includes(normalizedPhrase))
    ) {
      addViolation(
        violations,
        null,
        "static-result-replacement",
        `${label} appears to be a static audit/success replacement`
      );
    }
  }

  const metrics = {
    requiredFeatureCount: oracle.requiredFeatures.length,
    visibleFeatureCount,
    visibleHeadingCount,
    visibleControlCount,
    visibleImageCount,
    visibleTextCharacters
  };
  return { ok: violations.length === 0, violations, metrics };
}
