# Contributing

Thanks for helping improve Design Harness. The project is early, so the best contributions keep the v0.1 golden path reliable before expanding integrations.

## Development Setup

```bash
pnpm install
pnpm build
pnpm test
```

The required v0.1 path should work without a hosted model provider.

## Scope Rules

- Keep deterministic audit findings separate from subjective critique.
- Keep Open Design and MCP work as specs unless an implementation is explicitly verified.
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
