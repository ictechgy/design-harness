# GitHub Actions Recipe

Design Harness works best in CI when the workflow treats it as an artifact generator:

1. build the app,
2. start a local preview server,
3. wait for the URL to respond,
4. run `design-harness audit`,
5. upload the generated `runs/<name>/` directory.

The harness does not start your app for you because every frontend stack has a different preview command.

This repository's own CI workflow is the maintainable reference scaffold:

- `.github/workflows/ci.yml` runs `pnpm release:check`.
- The `example-smoke` job runs the fixture audit through `pnpm smoke:example`.
- The generated `runs/example-smoke` directory is uploaded as the `design-harness-example-smoke` artifact, even when the smoke job fails.
- `pnpm check:github-actions` verifies that the artifact step stays wired into CI.

## App Repository Example

This example assumes the app already depends on `@design-harness/cli` and exposes a local preview command.

```yaml
name: Design Harness

on:
  pull_request:

permissions:
  contents: read
  issues: write
  pull-requests: read

jobs:
  ui-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.7.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build

      - name: Start preview
        run: pnpm preview --host 127.0.0.1 --port 4173 &

      - name: Wait for preview
        run: |
          for attempt in {1..60}; do
            if curl -fsS http://127.0.0.1:4173 >/dev/null; then
              exit 0
            fi
            sleep 2
          done
          exit 1

      - name: Audit UI
        run: pnpm exec design-harness audit --url http://127.0.0.1:4173 --out runs/design-harness

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: design-harness-report
          path: runs/design-harness
```

## Optional Pull Request Comment

Keep the first version simple: post a compact pointer to the artifact and the top of the report. For noisy repositories, replace this with a sticky-comment action later.

```yaml
      - uses: actions/github-script@v7
        if: always() && github.event_name == 'pull_request'
        with:
          script: |
            const fs = require("node:fs");
            const reportPath = "runs/design-harness/report.md";
            if (!fs.existsSync(reportPath)) return;

            const report = fs.readFileSync(reportPath, "utf8");
            const preview = report.length > 5000 ? `${report.slice(0, 5000)}\n\n...` : report;
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Design Harness\n\nFull artifacts are attached to the workflow run.\n\n${preview}`
            });
```

## Exit Codes

- `0`: audit completed.
- `1`: command, browser, URL, or runtime failure.
- `2`: partial audit artifacts were written, but `--allow-partial` was not set.

Use `--allow-partial` only when you want CI to preserve debugging artifacts without blocking the pull request.
