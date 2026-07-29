# Korean register evidence calibration v1

> Aggregate-only browserless observation complete.

This record measures offline Kiwi token/POS evidence for the pinned IWSLT
2023 EN-KO binary formality references. It is not a product detector.

## Scope

- Calibration ID: `korean-register-evidence-v1`
- Pinned source rows: 597
- Korean references: 1194
- Upstream task-page description: 600 test pairs
- Labels preserved: `formal`, `informal`
- Real offline model loaded: true
- Independent normalized runs: 3
- Byte-identical aggregate SHA-256: `58eabfc1141841f883f542776819523cfaa0aa5fa9dc5fcb96bd8004c8dba42f`

The official task page and pinned artifact disagree on row count: the page
describes 600 test pairs, while every pinned EN-KO file contains 597 rows.

## Aggregate evidence buckets

| Bucket | Formal | Informal | Total |
|---|---:|---:|---:|
| `single-terminal-ef` | 141 | 146 | 287 |
| `multiple-ef` | 424 | 409 | 833 |
| `nonterminal-ef` | 24 | 26 | 50 |
| `noun-form-fragment` | 1 | 2 | 3 |
| `no-ef-other` | 7 | 14 | 21 |
| `empty-analysis` | 0 | 0 | 0 |
| `invalid-token-offset` | 0 | 0 | 0 |

All 1194 references are accounted for; invalid token offsets: 0.
Kiwi zero-length inserted morpheme tokens retained: 367.

## Limitations

- Binary translation-formality labels are not Design Harness four-register labels.
- The corpus contains translated speech-task references, not real product UI copy.
- POS evidence buckets are descriptive measurements, not correctness predictions.
- No owner-labelled real-product precision or false-positive corpus was measured.
- The observation does not authorize a register detector, product finding, score, or CLI surface.

No four-way accuracy, UI precision, real-product false-positive, causal,
ranking, or detector-readiness claim is supported by this observation.
