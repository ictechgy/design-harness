# @design-harness/cli

Command-line entry point for Design Harness.

```bash
design-harness audit --url http://localhost:3000 --out runs/demo
```

The CLI captures desktop and mobile screenshots, writes `audit.json`, renders `report.md`, and includes an iteration prompt scaffold for AI coding agents.

Parser-free rendered-copy checks are explicit opt-in through a local, schema-validated YAML file:

```bash
design-harness audit \
  --url http://localhost:3000 \
  --out runs/demo \
  --copy ./copy-style.yaml
```

Without `--copy`, the CLI does not discover a config or run copy analysis. The supported checks are `placeholder-leak`, `josa-hedge`, `glossary-banned-term`, `glossary-use-carefully-term`, and `banned-phrase`. Morphology, register, spelling, and model-judged checks are not enabled by this flag.

Repository: https://github.com/ictechgy/design-harness
