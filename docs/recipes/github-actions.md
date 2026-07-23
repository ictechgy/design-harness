# GitHub Actions Recipe

Design Harness works best in CI when the workflow treats it as an artifact generator:

1. build the app,
2. start a local preview server,
3. wait for the URL to respond,
4. run `design-harness audit`,
5. upload the generated `runs/<name>/` directory.

The harness does not start your app for you because every frontend stack has a different preview command.

This repository's own CI workflow is the maintainable reference scaffold:

- `.github/workflows/ci.yml` runs for every pull request, pushes to `main`,
  and manual dispatch. Feature-branch pushes do not also run CI because the
  pull request is the branch-validation boundary.
- The `verify` job runs the browserless `pnpm release:check`.
- The browser-equipped `example-smoke` job runs `pnpm smoke:example`,
  `pnpm smoke:copy`, the workspace `pnpm smoke:loop`, the installed-tarball
  `pnpm smoke:packed-loop`, and the six-fixture
  `pnpm calibrate:fixtures` TP/FP/FN drift gate.
- The generated `runs/example-smoke`, `runs/copy-smoke`, `runs/loop-smoke`,
  `runs/packed-loop`, and `runs/calibration` directories are uploaded as the
  `design-harness-example-smoke` artifact, even when the smoke job fails. The
  packed-loop consumer, fixture, and helper are temporary; its validated loop
  artifacts remain for upload.
- `pnpm check:github-actions` locks the event policy, browser/build ordering,
  required smoke commands, and artifact upload.

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

Use the v0.3 comment renderer (`scripts/render-pr-comment.mjs`, exposed as `pnpm comment:pr`) to post a compact pointer to the artifact, finding counts, and a short report preview. For noisy repositories, replace this with a sticky-comment action later.

```yaml
      - name: Render Design Harness PR comment
        if: always() && github.event_name == 'pull_request'
        run: |
          if [ -f runs/design-harness/audit.json ] && [ -f runs/design-harness/report.md ]; then
            pnpm comment:pr -- --run-dir runs/design-harness --out runs/design-harness/pr-comment.md
          fi

      - uses: actions/github-script@v7
        if: always() && github.event_name == 'pull_request'
        with:
          script: |
            const fs = require("node:fs");
            if (!fs.existsSync("runs/design-harness/pr-comment.md")) return;
            const body = fs.readFileSync("runs/design-harness/pr-comment.md", "utf8");
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body
            });
```

## Exit Codes

- `0`: audit completed.
- `1`: command, browser, URL, or runtime failure.
- `2`: partial audit artifacts were written, but `--allow-partial` was not set.

Use `--allow-partial` only when you want CI to preserve debugging artifacts without blocking the pull request.
