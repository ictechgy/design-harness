# Korean register evidence calibration

This is a browserless evidence-calibration corpus, not a shipped detector or a
four-register UI benchmark.

The two subtrees have different provenance and licenses:

- `cdla-sharing-1.0/` is the exact IWSLT 2023 EN-KO formality test projection
  copied from Amazon Science's `contrastive-controlled-mt` repository at commit
  `441e23a7c41beeac6329ffdb27d47024eb71b829`. Its source data and upstream
  README are governed by CDLA-Sharing-1.0.
- `apache-2.0-synthetic/` contains small project-authored UI controls governed
  by Apache-2.0. They test the evidence bucketing code and are not derived from
  IWSLT.

The upstream README describes 600 EN-KO test segments. The five files pinned
here each contain 597 rows, so this calibration accounts for 597 source rows
and 1,194 Korean references. The binary upstream labels remain `formal` and
`informal`; they are never converted into Design Harness's four project
registers.

The committed observation under `docs/calibration/korean-register-v1/` contains
aggregate counts and provenance only. It contains no source sentence and does
not establish UI precision, real-product false-positive behavior, four-way
register accuracy, or detector readiness.
