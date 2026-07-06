# Pull Request Comment Bot

The v0.3 comment bot is a checkout-local renderer, not a hosted service or npm-shipped command surface. CI runs an audit, uploads the full artifact directory, then uses `scripts/render-pr-comment.mjs` to create a compact Markdown summary for a pull request comment.

```bash
pnpm comment:pr -- --run-dir runs/design-harness --out runs/design-harness/pr-comment.md
```

The generated comment includes:

- audit status and advisory score,
- deterministic, heuristic, and subjective finding counts,
- the first findings with criterion IDs when available,
- a truncated report preview,
- a pointer to the uploaded artifact directory.

The renderer expects `audit.json` and `report.md` to exist in the run directory. In CI, guard the render step when the audit command did not produce artifacts.

Use the generated Markdown with `actions/github-script`, `gh pr comment`, or any CI system that can post an issue comment.

## GitHub Actions Shape

```yaml
      - name: Render Design Harness PR comment
        if: always() && github.event_name == 'pull_request'
        run: pnpm comment:pr -- --run-dir runs/design-harness --out runs/design-harness/pr-comment.md

      - uses: actions/github-script@v7
        if: always() && github.event_name == 'pull_request'
        with:
          script: |
            const fs = require("node:fs");
            const body = fs.readFileSync("runs/design-harness/pr-comment.md", "utf8");
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body
            });
```

For noisy repositories, pair this with a sticky-comment action so repeated pushes update one Design Harness comment instead of adding a new one each run.
