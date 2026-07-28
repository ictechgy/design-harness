# @design-harness/copy-audit

Capture-neutral copy checks for Design Harness.

The package accepts rendered text inventory produced by a capture adapter and a
validated `CopyStyle`. It returns source-backed findings without importing a
browser or capture engine. The default `analyzeCopy()` API remains synchronous
and parser-free.

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

Korean morphology is a separate asynchronous opt-in:

```ts
import { prepareKiwiMorphologyAnalyzer } from "@design-harness/copy-audit";

const analyzeMorphology = await prepareKiwiMorphologyAnalyzer(
  "/absolute/path/to/kiwi-0.23.0-cong"
);
const result = await analyzeMorphology([renderedInventory]);
```

Preparation verifies an offline Kiwi `0.23.0` `cong` profile before returning
the analyzer. The directory must contain exactly these non-symlink regular
files; names, byte lengths, and SHA-256 digests are fixed:

| File | Bytes | SHA-256 |
|---|---:|---|
| `combiningRule.txt` | 3,584 | `3d864f76eade67b250d37f4ee83de848b04fb14d0cd6ed36c36d0b210ad38ebc` |
| `cong.mdl` | 75,667,563 | `bd9ca89ee1b72e750c8e2166a17c80a0fe3fabd828c78b1f0928486a6b1833a7` |
| `extract.mdl` | 17,370 | `a0c92ffc051e43ae497845cdb8d4c8b9e2f359893cb55c67279c76d1d531ee17` |
| `nounchr.mdl` | 9,734,234 | `4b687e36836dd60dcb7addcfcf369ac082b339bab76549574ac1ce2b7ccd6836` |
| `sj.morph` | 8,462,892 | `5e3dab2def6d2cc079e21d5477bd610a391c69045d08caf1e0bbeabda8db8d1b` |

The package never downloads, discovers, or vendors model files. It re-verifies
the prepared profile inside one worker, analyzes the complete rendered batch,
and terminates that worker before returning. Runtime failure produces one
non-failing notice and no morphology finding or provenance.

The initial detector, `josa-batchim-mismatch`, covers only `은/는`, `이/가`,
`을/를`, and `과/와`. It requires exact raw offsets, a Kiwi `J*` token, one
unambiguous preceding noun token, and a precomposed Hangul final syllable.
Ambiguous, digit-, Latin-, symbol-, or non-noun cases are skipped. Its findings
are low-confidence heuristic risks that recommend human review; they are never
deterministic failures.

`kiwi-nlp@0.23.0` is an exact, lazy-loaded dependency. Its npm metadata declares
LGPL-2.1-or-later while the upstream README describes LGPL v3; consumers should
review both notices for their distribution context. Design Harness does not
statically vendor Kiwi or its model data.

After building the workspace, maintainers with the exact local profile can run
the optional offline repeatability smoke:

```bash
pnpm smoke:kiwi-real-model -- --model-dir /absolute/path/to/kiwi-0.23.0-cong
```

Repository: https://github.com/ictechgy/design-harness
