# MCP Spec

This is a retained v0.1 contract only. It does not implement a production MCP server or commit the project to one; that surface is cut from the current roadmap unless the owner explicitly reopens it.

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
  "explanation": "Scores are advisory and use evidence-tier-weighted findings."
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
