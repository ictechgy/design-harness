# @design-harness/copy-audit

Capture-neutral, parser-free copy checks for Design Harness.

The package accepts rendered text inventory produced by a capture adapter and a
validated `CopyStyle`. It returns source-backed findings without importing a
browser or capture engine.

```ts
import { analyzeCopy } from "@design-harness/copy-audit";

const findings = analyzeCopy(
  {
    viewport: "desktop",
    evidenceRef: "text-inventory-desktop",
    items: [{ selector: "main > p", text: "TODO" }]
  },
  { schemaVersion: "0.2", locale: "ko-KR" }
);
```

Repository: https://github.com/ictechgy/design-harness
