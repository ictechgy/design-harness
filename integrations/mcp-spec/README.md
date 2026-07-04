# MCP Spec

This is a v0.1 contract only. It does not claim a production MCP server exists yet.

## Tool: design_audit

Input:

```json
{
  "url": "http://localhost:3000",
  "outDir": "runs/demo",
  "timeoutMs": 15000
}
```

Output:

```json
{
  "metadataPath": "runs/demo/metadata.json",
  "auditPath": "runs/demo/audit.json",
  "reportPath": "runs/demo/report.md",
  "screenshotPaths": [
    "runs/demo/screenshots/desktop.png",
    "runs/demo/screenshots/mobile.png"
  ]
}
```

## Tool: score_ui

Input:

```json
{
  "auditPath": "runs/demo/audit.json"
}
```

Output:

```json
{
  "value": 90,
  "max": 100,
  "band": "strong",
  "explanation": "Scores are advisory and derived from deterministic findings."
}
```

## Tool: propose_iteration

Input:

```json
{
  "auditPath": "runs/demo/audit.json",
  "reportPath": "runs/demo/report.md"
}
```

Output:

```json
{
  "prompt": "Model-neutral iteration prompt scaffold"
}
```
