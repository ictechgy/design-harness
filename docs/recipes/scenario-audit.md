# Scenario Audit

Scenario audit is a checkout-local recipe that runs the same local harness against several local URLs. It is useful when a product has separate states such as empty, loaded, error, mobile-preview, or admin screens.

Create a `design-harness-scenarios/v1` file:

```json
{
  "schemaVersion": "design-harness-scenarios/v1",
  "name": "merchant-dashboard",
  "scenarios": [
    {
      "id": "dashboard-home",
      "url": "http://127.0.0.1:4173/",
      "timeoutMs": 15000
    }
  ]
}
```

Run it after building the CLI and starting your preview server:

```bash
pnpm build
pnpm example:serve
pnpm scenario:audit -- --config examples/scenarios/merchant-dashboard.scenarios.json --out runs/scenarios/merchant-dashboard
```

Outputs:

- `scenario-summary.json`: machine-readable scenario status, exit codes, finding counts, and artifact paths.
- `scenario-report.md`: compact Markdown table for reviewers.
- one full Design Harness run directory per scenario.

Scenario URLs are restricted to local `http` or `https` hosts: `localhost`, `.localhost` subdomains, `127.0.0.1`, or bracketed IPv6 loopback such as `[::1]`. Credentials in URLs are rejected.
