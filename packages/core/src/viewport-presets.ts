import type { ViewportPreset } from "./types.js";

export const DEFAULT_VIEWPORT_PRESETS: ViewportPreset[] = [
  {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false
  },
  {
    name: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true
  }
];
