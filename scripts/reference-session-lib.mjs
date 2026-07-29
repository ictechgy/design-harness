import { createHash } from "node:crypto";
import { extname } from "node:path";

export const REFERENCE_SESSION_FORMAT = "reference-session-inventory-v1";
export const REFERENCE_SESSION_LIMITS = Object.freeze({
  maxAssets: 32,
  maxAssetBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxReadBytes: 1024 * 1024,
  maxInventoryBytes: 64 * 1024
});

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UNSAFE_NAME_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069/\\]/u;
const UNSAFE_NAME_REPLACEMENT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069/\\]/gu;
const MEDIA_TYPES = Object.freeze({
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
});
const INVENTORY_KEYS = Object.freeze(["format", "assets"]);
const ASSET_KEYS = Object.freeze(["basename", "mediaType", "bytes", "sha256"]);

export class ReferenceSessionError extends Error {
  constructor(phase, detail, basename) {
    super(detail);
    this.name = "ReferenceSessionError";
    this.phase = phase;
    this.basename = basename;
  }
}

export function parseSessionSlug(value) {
  if (typeof value !== "string" || !SLUG_PATTERN.test(value)) {
    throw new ReferenceSessionError(
      "arguments",
      "session must be a lowercase slug containing only letters, digits, and single hyphens"
    );
  }
  return value;
}

export function validateAssetBasename(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value === "."
    || value === ".."
    || UNSAFE_NAME_PATTERN.test(value)
    || value.startsWith(".reference-session-stage-")
  ) {
    throw new ReferenceSessionError("inventory", "unsafe asset basename", safeBasename(value));
  }
  const extension = extname(value);
  if (!(extension in MEDIA_TYPES)) {
    throw new ReferenceSessionError(
      "inventory",
      "asset extension must be lowercase .png, .jpg, .jpeg, or .webp",
      value
    );
  }
  return {
    basename: value,
    normalizedBasename: value.normalize("NFC"),
    expectedMediaType: MEDIA_TYPES[extension]
  };
}

export function mediaTypeFromSignature(basename, header) {
  const { expectedMediaType } = validateAssetBasename(basename);
  const detectedMediaType = detectMediaType(header);
  if (detectedMediaType !== expectedMediaType) {
    throw new ReferenceSessionError(
      "inventory",
      "asset extension and container signature do not match",
      basename
    );
  }
  return detectedMediaType;
}

export function enforceAssetCaps(assets, limits = REFERENCE_SESSION_LIMITS) {
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new ReferenceSessionError("inventory", "session must contain at least one image asset");
  }
  if (assets.length > limits.maxAssets) {
    throw new ReferenceSessionError(
      "inventory",
      `session exceeds the ${limits.maxAssets}-asset limit`
    );
  }

  let totalBytes = 0;
  for (const asset of assets) {
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1) {
      throw new ReferenceSessionError("inventory", "asset byte count must be a positive safe integer", asset.basename);
    }
    if (asset.bytes > limits.maxAssetBytes) {
      throw new ReferenceSessionError(
        "inventory",
        `asset exceeds the ${limits.maxAssetBytes}-byte limit`,
        asset.basename
      );
    }
    totalBytes += asset.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new ReferenceSessionError(
        "inventory",
        `session exceeds the ${limits.maxTotalBytes}-byte total limit`
      );
    }
  }
  return totalBytes;
}

export function canonicalizeAssets(assets) {
  const normalizedNames = new Set();
  const canonical = assets.map((asset) => {
    const validated = validateAssetBasename(asset.basename);
    if (normalizedNames.has(validated.normalizedBasename)) {
      throw new ReferenceSessionError(
        "inventory",
        "asset basenames collide after Unicode normalization",
        asset.basename
      );
    }
    normalizedNames.add(validated.normalizedBasename);
    if (
      asset.mediaType !== validated.expectedMediaType
      || !Number.isSafeInteger(asset.bytes)
      || asset.bytes < 1
      || typeof asset.sha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(asset.sha256)
    ) {
      throw new ReferenceSessionError("inventory", "asset record is invalid", asset.basename);
    }
    return {
      basename: asset.basename,
      mediaType: asset.mediaType,
      bytes: asset.bytes,
      sha256: asset.sha256,
      normalizedBasename: validated.normalizedBasename
    };
  });

  enforceAssetCaps(canonical);
  canonical.sort((left, right) => (
    Buffer.compare(
      Buffer.from(left.normalizedBasename, "utf8"),
      Buffer.from(right.normalizedBasename, "utf8")
    )
  ));
  return canonical.map(({ normalizedBasename: _normalizedBasename, ...asset }) => asset);
}

export function renderInventory(assets) {
  const inventory = {
    format: REFERENCE_SESSION_FORMAT,
    assets: canonicalizeAssets(assets)
  };
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export function parseCanonicalInventory(source) {
  if (typeof source !== "string") {
    throw new ReferenceSessionError("validate", "inventory must be UTF-8 text");
  }

  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ReferenceSessionError("validate", "inventory is not valid JSON");
  }
  assertExactObjectKeys(value, INVENTORY_KEYS, "inventory");
  if (value.format !== REFERENCE_SESSION_FORMAT || !Array.isArray(value.assets)) {
    throw new ReferenceSessionError("validate", "inventory format or assets are invalid");
  }
  for (const asset of value.assets) {
    assertExactObjectKeys(asset, ASSET_KEYS, "asset record");
  }

  const assets = canonicalizeAssets(value.assets);
  if (renderInventory(assets) !== source) {
    throw new ReferenceSessionError("validate", "inventory is not in canonical form");
  }
  return assets;
}

export function renderWorksheet(assets, inventorySource) {
  const canonicalAssets = canonicalizeAssets(assets);
  const inventoryHash = sha256Hex(Buffer.from(inventorySource, "utf8"));
  const rows = canonicalAssets
    .map(({ basename }) => `| ${escapeTableCell(basename)} |  |  |  |  |`)
    .join("\n");

  return `# Local reference-session worksheet

> LOCAL AND IGNORED: keep this worksheet and every referenced image out of git.

Inventory format: \`${REFERENCE_SESSION_FORMAT}\`
Inventory SHA-256: \`${inventoryHash}\`

Image pixels do not prove a token, accessibility result, color harmony, font
identity, exact spacing, density budget, or design quality. Record observations,
candidate project choices, and owner decisions separately.

| Asset | Observed cue | Candidate project choice | Owner decision | Rationale and validation |
| --- | --- | --- | --- | --- |
${rows}

## Local verification

- [ ] Rights basis and confidentiality were reviewed by the owner.
- [ ] Retained choices were authored separately in the existing project guide.
- [ ] The project guide compiled and a second guide check performed zero writes.
- [ ] A representative rendered surface was audited separately.
- [ ] Audit findings were not treated as facts recovered from these images.

## Owner usefulness verdict

Pending human decision.
`;
}

export function compareInventories(expectedAssets, actualAssets) {
  const expected = new Map(canonicalizeAssets(expectedAssets).map((asset) => [asset.basename, asset]));
  const actual = new Map(canonicalizeAssets(actualAssets).map((asset) => [asset.basename, asset]));
  const diagnostics = [];

  for (const basename of sortBasenames(new Set([...expected.keys(), ...actual.keys()]))) {
    const before = expected.get(basename);
    const after = actual.get(basename);
    if (!before) {
      diagnostics.push({ basename, kind: "added" });
    } else if (!after) {
      diagnostics.push({ basename, kind: "missing" });
    } else if (
      before.mediaType !== after.mediaType
      || before.bytes !== after.bytes
      || before.sha256 !== after.sha256
    ) {
      diagnostics.push({ basename, kind: "changed" });
    }
  }
  return diagnostics;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function detectMediaType(header) {
  if (!Buffer.isBuffer(header)) {
    return undefined;
  }
  if (
    header.length >= 8
    && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    header.length >= 12
    && header.subarray(0, 4).toString("ascii") === "RIFF"
    && header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function assertExactObjectKeys(value, expectedKeys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReferenceSessionError("validate", `${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ReferenceSessionError("validate", `${label} has unknown or missing keys`);
  }
}

function sortBasenames(values) {
  return [...values].sort((left, right) => (
    Buffer.compare(Buffer.from(left.normalize("NFC"), "utf8"), Buffer.from(right.normalize("NFC"), "utf8"))
  ));
}

function escapeTableCell(value) {
  return value.replaceAll("|", "\\|");
}

function safeBasename(value) {
  return typeof value === "string" && value.length > 0
    ? value.replace(UNSAFE_NAME_REPLACEMENT_PATTERN, "?")
    : undefined;
}
