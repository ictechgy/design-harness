import type {
  CopySurfaceResolution,
  FindingRegion
} from "@design-harness/core";

export interface CopyTextNode {
  readonly selector: string;
  readonly text: string;
  readonly truncated?: true;
  readonly region?: Readonly<FindingRegion>;
  readonly copySurface?: Readonly<CopySurfaceResolution>;
}

export interface CopyInventory {
  readonly viewport: string;
  readonly evidenceRef: string;
  readonly items: readonly CopyTextNode[];
}
