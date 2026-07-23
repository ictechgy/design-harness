# Contributing

Thanks for helping improve Design Harness. The best contributions keep the core local-audit path reliable before expanding integrations.

## Development Setup

```bash
pnpm install
pnpm build
pnpm test
```

The required local-audit path must work without a hosted model provider.

## Scope Rules

- Keep deterministic audit findings separate from subjective critique.
- Keep the existing Open Design and MCP material as specs/checkout-local scaffolding only. Do not expand either integration unless the owner explicitly reopens its cut-list item.
- Every persisted JSON artifact must include `schemaVersion` and `harnessVersion`.
- Every finding must include severity, confidence, viewport, category, evidence references, and a recommendation.

## Pull Requests

Please include:

- what changed
- how it was tested
- any schema or output contract changes
- screenshots or sample artifacts for visual-audit changes when relevant

## Local Artifacts

Generated audit runs belong under `runs/` and are ignored by git. Committed examples should live under `examples/`.
